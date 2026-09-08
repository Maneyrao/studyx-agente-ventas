import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import * as agentABrainModule from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import {
  AGENT_A_BRAIN_DEADLINE_MS,
  AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS,
  AgentABrainError,
  buildSafeAgentABrainCompositionV1,
  generateDeepSeekAgentATurnProposalV1,
  generateAgentATurnProposalV1,
  generateOpenAIAgentATurnProposalV1,
  parseAgentATurnProposalV1,
  validateAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { buildAgentABrainInstructionsV1 } from '../../../botpress-agent/src/prompts/agent-a-brain-v1';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'message-1', text: 'Contame sobre Redes' }], recent_turns: [] },
    customer: {
      display_name: null,
      memories: [{
        id: 'memory-1', type: 'study_goal', key: 'career_goal', value: 'busca trabajo', confidence: 0.9,
      }],
    },
    identity: null,
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false,
    },
    obligations: { stage: 'course_selected', owes: [], not_yet: [] },
    catalog: {
      selected_offering: {
        code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      available_offerings: [],
      areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
      candidate_offerings: [],
      payment_plans: [{ code: 'monthly_12', fact_id: 'payment:redes-informaticas:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' }],
    },
    capabilities: {
      may_reply: true, may_offer_call: true, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false, authorized_payment_plan: null,
      intake_status: 'known' as const,
      intake_missing: [],
    },
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
      course_reference: 'Redes Informáticas', confidence: 0.95,
    },
    response: { messages: ['Te cuento sobre el curso.', '¿Lo buscás para trabajar o para formación personal?'] },
    proposed_action: { type: 'none' },
    used_fact_ids: ['offering:redes-informaticas:name:v1'],
    used_memory_ids: ['memory-1'],
    memory_candidates: [],
    ...overrides,
  };
}

function providerResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function successBody(value: unknown) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] };
}

function responsesSuccessBody(value: unknown) {
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Agent A Brain V1', () => {
  it('requires a separate initial call offer after any canonical catalog recommendation', () => {
    expect(buildAgentABrainInstructionsV1(context())).toContain(
      'When you name one or more canonical courses while browsing the catalog',
    );
  });

  it('does not renew a call invitation merely because the customer changes course', () => {
    expect(buildAgentABrainInstructionsV1(context())).toContain(
      'A course switch by itself does not renew a previous call invitation',
    );
  });

  it.each(['USD 360', 'USD 360.0', 'USD 360.00'])(
    'accepts equivalent zero cents without rejecting an authorized total: %s', (total) => {
      const ctx = context();
      ctx.capabilities.may_offer_call = false; // Monetary normalization, no call capability.
      const priceId = 'payment:redes-informaticas:monthly_12:price:v1';
      ctx.catalog.selected_offering!.facts.push({ id: priceId, kind: 'payment_plan_price', value: 'USD 360.00' });
      const parsed = parseAgentATurnProposalV1(proposal({
        response: { messages: [`Son 12 pagos mensuales de USD 30, total ${total}.`] },
        used_fact_ids: [priceId, ctx.catalog.payment_plans[0].fact_id],
      }), ctx);
      expect(validateAgentATurnProposalV1({
        proposal: parsed, context: ctx, planned_fact_ids: parsed.used_fact_ids,
        rejection_id: '00000000-0000-4000-8000-000000000001',
      })).toBeNull();
    },
  );

  it.each(['USD 361', 'USD 360.01', 'EUR 360', 'USD 36000', 'USD 360.000',
    'USD 360,00', 'USD 360,000', 'USD 360,001', 'no cuesta USD 360'])(
    'still rejects a different amount, currency or negated price: %s', (total) => {
      const ctx = context();
      const priceId = 'payment:redes-informaticas:monthly_12:price:v1';
      ctx.catalog.selected_offering!.facts.push({ id: priceId, kind: 'payment_plan_price', value: 'USD 360.00' });
      const parsed = parseAgentATurnProposalV1(proposal({
        response: { messages: [`Total: ${total}.`] }, used_fact_ids: [priceId],
      }), ctx);
      expect(validateAgentATurnProposalV1({
        proposal: parsed, context: ctx, planned_fact_ids: parsed.used_fact_ids,
        rejection_id: '00000000-0000-4000-8000-000000000001',
      })?.rejections).toContainEqual({ code: 'FACT_VALUE_MISMATCH', subject: 'price' });
    },
  );

  it('parses a natural multi-message proposal against authorized facts and memories', () => {
    expect(parseAgentATurnProposalV1(proposal(), context()).response.messages).toHaveLength(2);
  });

  it('pone la orden de reparación después del contexto y prohíbe repetir valores rechazados', () => {
    const instructions = buildAgentABrainInstructionsV1({
      ...context(),
      turn_rejection: {
        schema_version: 1,
        rejection_id: '00000000-0000-4000-8000-000000000001',
        attempt: 1,
        rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'price' }],
        authorized_alternatives: {
          fact_ids: [],
          actions: ['none'],
          missing_information: ['course_selection'],
        },
      },
    });
    const repairDirective = 'FACT_VALUE_MISMATCH means the VALUE you stated does not match the canonical record';

    expect(instructions).toContain(repairDirective);
    expect(instructions.lastIndexOf(repairDirective))
      .toBeGreaterThan(instructions.lastIndexOf('</authorized_context>'));
    expect(instructions).toContain('Correct it to a\nvalue present in authorized_alternatives.fact_ids');
  });

  it('reports only the safe schema path and issue code for a root contract failure', () => {
    expect(() => parseAgentATurnProposalV1(proposal({ unexpected: true }), context()))
      .toThrowError(expect.objectContaining({
        code: 'BRAIN_INVALID_SCHEMA',
        detail: 'root:unrecognized_keys',
      }));
  });

  it('drops semantically inapplicable optional references emitted by the structured provider', () => {
    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'select_course',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'Redes Informáticas',
        area_reference: 'Tecnología',
        payment_plan: null,
        confidence: 0.95,
      },
    }), context());

    expect(parsed.move).toMatchObject({
      move: 'select_course',
      course_reference: 'redes-informaticas',
    });
    expect(parsed.move).not.toHaveProperty('area_reference');
    expect(parsed.move).not.toHaveProperty('payment_plan');
  });

  it('normalizes an exact visible display name to its canonical code and authorizes its name fact', () => {
    const ctx = context() as AgentAContextV1 & {
      catalog: AgentAContextV1['catalog'] & {
        available_offerings: Array<{
          code: string;
          fact_id: string;
          display_name: string;
          area_code: string | null;
        }>;
      };
    };
    ctx.catalog.selected_offering = null;
    ctx.catalog.candidate_offerings = [];
    ctx.catalog.available_offerings = [{
      code: 'fotografia_profesional',
      fact_id: 'offering:fotografia_profesional:name:v1',
      display_name: 'Fotografía Profesional',
      area_code: 'emprendedores',
    }];

    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'select_course',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'Fotografía Profesional',
        confidence: 0.99,
      },
      used_fact_ids: ['offering:fotografia_profesional:name:v1'],
    }), ctx);

    expect(parsed.move.course_reference).toBe('fotografia_profesional');
    expect(parsed.used_fact_ids).toEqual(['offering:fotografia_profesional:name:v1']);
  });

  it('rejects a course reference that is absent from the complete visible catalog', () => {
    const ctx = context() as AgentAContextV1 & {
      catalog: AgentAContextV1['catalog'] & {
        available_offerings: Array<{
          code: string;
          fact_id: string;
          display_name: string;
          area_code: string | null;
        }>;
      };
    };
    ctx.catalog.selected_offering = null;
    ctx.catalog.candidate_offerings = [];
    ctx.catalog.available_offerings = [{
      code: 'ingles_1',
      fact_id: 'offering:ingles_1:name:v1',
      display_name: 'Inglés 1',
      area_code: 'idiomas',
    }];

    expect(() => parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'select_course',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'Medicina',
        confidence: 0.99,
      },
      used_fact_ids: [],
    }), ctx)).toThrowError(expect.objectContaining({ code: 'BRAIN_UNKNOWN_COURSE_REFERENCE' }));
  });

  it('removes duplicate secondary moves and vetoes without adding authority', () => {
    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'ask_course_information',
        secondary_moves: ['ask_course_information', 'continue_by_chat', 'continue_by_chat'],
        vetoes: ['call', 'call'],
        course_reference: 'Redes Informáticas',
        confidence: 0.95,
      },
    }), context());

    expect(parsed.move.secondary_moves).toEqual(['continue_by_chat']);
    expect(parsed.move.vetoes).toEqual(['call']);
  });

  it('normalizes only a known compact move enum into the closed move contract', () => {
    const parsed = parseAgentATurnProposalV1(proposal({ move: 'ask_payment_options' }), context());

    expect(parsed.move).toEqual({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    });
    expect(() => parseAgentATurnProposalV1(proposal({ move: 'invented_move' }), context()))
      .toThrowError(expect.objectContaining({ code: 'BRAIN_INVALID_SCHEMA' }));
  });

  it('preserves natural sales prose when every commercial value cites an authorized fact', () => {
    const natural = 'Podés estudiar Redes Informáticas con nosotros. Te acompaño a ver si encaja con lo que buscás.';
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: { messages: [natural, '¿Querés que te cuente cómo se cursa?'] },
        used_fact_ids: ['offering:redes-informaticas:name:v1'],
      }), context()),
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
    });

    expect(composition.narrative).toEqual({
      opening: natural,
      explanation: '¿Querés que te cuente cómo se cursa?',
      next_question: null,
    });
    expect(composition.used_fact_ids).toEqual(['offering:redes-informaticas:name:v1']);
  });

  it('keeps a natural call invitation separate so the authoritative planner can allow it', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: ['Redes Informáticas puede ser una buena opción para lo que buscás.'],
          call_offer: 'Si te sirve, podemos coordinar una llamada breve; si no, seguimos por acá.',
        },
      }), context()),
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
    });

    expect(composition.narrative.opening).toContain('buena opción');
    expect(composition.call_offer).toContain('seguimos por acá');
  });

  it('preserves ordinary sales help without making an unsupported availability claim', () => {
    const natural = 'Puedo ayudarte a encontrar la opción que mejor encaje con tu objetivo.';
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.95,
        },
        response: { messages: [natural] },
        used_fact_ids: [],
      }), context()),
      context: context(),
      response_goal: 'guide_area_choice',
      planned_fact_ids: [],
    });

    expect(composition.narrative.opening).toBe(natural);
  });

  // Antes se exigía rechazar esta frase. El backend, en cambio, ya la
  // autorizaba como guía genérica de catálogo: el ADK era MÁS estricto que la
  // frontera autoritativa y mataba lenguaje de venta corriente. Con la verdad
  // comercial verificada por valor en el backend, orientar sin afirmar un
  // hecho del catálogo es exactamente lo que el modelo debe poder hacer.
  it('allows generic guidance that orients without asserting a catalog fact', () => {
    const genericAvailability = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.95,
      },
      response: {
        messages: ['Sí, tenemos varias opciones y te ayudo a encontrar la que mejor encaje con tu objetivo.'],
        call_offer: null,
      },
      used_fact_ids: [],
      used_memory_ids: [],
    }), context());

    expect(validateAgentATurnProposalV1({
      proposal: genericAvailability,
      context: context(),
      planned_fact_ids: [],
      rejection_id: '00000000-0000-4000-8000-000000000099',
    })).toBeNull();
  });

  it('allows an availability statement only when it names and cites the authorized course', () => {
    const authorized = parseAgentATurnProposalV1(proposal({
      response: { messages: ['Podés estudiar Redes Informáticas con nosotros.'], call_offer: null },
      used_fact_ids: ['offering:redes-informaticas:name:v1'],
    }), context());

    expect(validateAgentATurnProposalV1({
      proposal: authorized,
      context: { ...context(), capabilities: { ...context().capabilities, may_offer_call: false } },
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000098',
    })).toBeNull();
  });

  it('prunes an unauthorized commercial value while preserving the safe model prose', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: [
            'Podemos estudiar de forma virtual.',
            'Podemos revisar juntos lo que más te importa.',
          ],
        },
      }), context()),
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: [
        'offering:redes-informaticas:name:v1',
        'offering:redes-informaticas:description:v1',
      ],
    });

    expect(composition.narrative).toEqual({
      opening: 'Podemos revisar juntos lo que más te importa.',
      explanation: null,
      next_question: null,
    });
    expect(composition.used_fact_ids).toEqual(['offering:redes-informaticas:name:v1']);
  });

  it('uses contextual value-free copy when every model message is unsafe', () => {
    const unsafeProposal = parseAgentATurnProposalV1(proposal({
      response: { messages: ['Redes Informáticas dura 10 meses.'] },
    }), context());

    const firstOffer = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: [],
    });
    const secondOffer = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: {
        ...context(),
        identity: null,
    commercial_state: { ...context().commercial_state, call_offer_count: 1 },
      },
      response_goal: 'explain_selected_course',
      planned_fact_ids: [],
    });
    const chatContinuation = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: {
        ...context(),
        identity: null,
    commercial_state: {
          ...context().commercial_state,
          call_preference: 'chat',
          call_offer_status: 'declined',
          call_offer_count: 2,
        },
      },
      response_goal: 'continue_course_advice',
      planned_fact_ids: [],
    });

    expect(firstOffer.narrative.opening).not.toBe(secondOffer.narrative.opening);
    expect(secondOffer.narrative.opening).not.toBe(chatContinuation.narrative.opening);
    for (const composition of [firstOffer, secondOffer, chatContinuation]) {
      expect(composition.narrative.opening).not.toMatch(/Redes|10 meses|https?:\/\//iu);
    }
  });

  it('rejects a model URL and evidence IDs outside the supplied context', () => {
    expect(() => parseAgentATurnProposalV1(proposal({
      response: { messages: ['Pagá en https://buy.stripe.com/model-link'] },
    }), context())).toThrowError(expect.objectContaining({ code: 'BRAIN_INVALID_SCHEMA' }));
    expect(() => parseAgentATurnProposalV1(proposal({
      response: { messages: ['El próximo inicio es {{FECHA}}.'] },
    }), context())).toThrowError(expect.objectContaining({ code: 'BRAIN_INVALID_SCHEMA' }));
    expect(() => parseAgentATurnProposalV1(proposal({ used_fact_ids: ['fact-not-supplied'] }), context()))
      .toThrowError(expect.objectContaining({ code: 'BRAIN_UNKNOWN_FACT_ID' }));
    expect(() => parseAgentATurnProposalV1(proposal({ used_memory_ids: ['memory-not-supplied'] }), context()))
      .toThrowError(expect.objectContaining({ code: 'BRAIN_UNKNOWN_MEMORY_ID' }));
  });

  it('drops only an unsafe secondary message so the backend can materialize an authorized link', () => {
    const parsed = parseAgentATurnProposalV1(proposal({
      response: {
        messages: [
          'Perfecto, te comparto el paso autorizado.',
          'Usá https://example.invalid/model-authored-link',
        ],
      },
    }), context());

    expect(parsed.response.messages).toEqual([
      'Perfecto, te comparto el paso autorizado.',
    ]);
  });

  it('uses safe value-free copy when an authorized link turn contains only a model URL', () => {
    const linkContext = {
      ...context(),
      identity: null,
    commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'monthly_12' as const,
      },
      capabilities: {
        ...context().capabilities,
        may_send_payment_link: true,
        intake_status: 'known' as const,
        authorized_payment_plan: 'monthly_12' as const,
        intake_missing: [],
      },
    };
    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'request_payment_link',
        secondary_moves: [],
        vetoes: [],
        payment_plan: 'monthly_12',
        confidence: 0.98,
      },
      response: { messages: ['https://example.invalid/model-authored-link'] },
      proposed_action: {
        type: 'send_payment_link',
        offering_code: 'redes-informaticas',
        payment_plan: 'monthly_12',
      },
    }), linkContext);

    expect(parsed.response.messages).toHaveLength(1);
    expect(parsed.response.messages[0]).not.toMatch(/https?:\/\//u);
  });

  it('leaves a paraphrased payment amount to the canonical assembler', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        move: {
          schema_version: 1,
          move: 'select_payment_plan',
          secondary_moves: [],
          vetoes: [],
          payment_plan: 'monthly_12',
          confidence: 0.98,
        },
        response: {
          messages: ['Perfecto, elegiste 12 cuotas de USD 30.'],
          call_offer: null,
        },
      }), context()),
      context: context(),
      response_goal: 'confirm_selected_plan',
      planned_fact_ids: [],
    });

    expect(composition.narrative.opening).toBe(
      'Queda registrada tu elección. Avisame cuando quieras avanzar.',
    );
    expect(composition.narrative.opening).not.toMatch(/USD|30|cuotas/iu);
  });

  it('answers an unsupported prerequisite question from the absence of a canonical fact', () => {
    const prerequisiteContext = context();
    prerequisiteContext.catalog.selected_offering!.facts.push(
      { id: 'offering:redes-informaticas:duration:v1', kind: 'offering_duration', value: '16 clases' },
      { id: 'offering:redes-informaticas:modality:v1', kind: 'offering_modality', value: 'online' },
    );
    prerequisiteContext.turn.batch_messages[0] = {
      ...prerequisiteContext.turn.batch_messages[0],
      text: '¿Cuántas clases tiene y qué necesito saber antes de empezar?',
    };
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: [
            'No necesitás conocimientos previos.\n\nPodés empezar desde cero.',
            'La modalidad es online.',
          ],
          call_offer: null,
        },
        used_fact_ids: [
          'offering:redes-informaticas:name:v1',
          'offering:redes-informaticas:duration:v1',
          'offering:redes-informaticas:modality:v1',
        ],
      }), prerequisiteContext),
      context: prerequisiteContext,
      response_goal: 'explain_selected_course',
      planned_fact_ids: [
        'offering:redes-informaticas:name:v1',
        'offering:redes-informaticas:duration:v1',
        'offering:redes-informaticas:modality:v1',
      ],
    });

    expect(composition.narrative.opening).toBe(
      'Los requisitos previos no están especificados en la información confirmada.',
    );
    expect(JSON.stringify(composition)).not.toMatch(/desde cero|no necesitás/iu);
    expect(composition.used_fact_ids).toEqual([
      'offering:redes-informaticas:name:v1',
      'offering:redes-informaticas:duration:v1',
    ]);
  });

  it('answers with a concise prerequisite statement when the canonical description confirms it', () => {
    const prerequisiteContext = context();
    prerequisiteContext.catalog.selected_offering!.facts.push({
      id: 'offering:redes-informaticas:description:v1',
      kind: 'offering_description',
      value: 'Es un curso introductorio, que no requiere conocimientos previos, y explica las bases.',
    });
    prerequisiteContext.turn.batch_messages[0] = {
      ...prerequisiteContext.turn.batch_messages[0],
      text: '¿Necesito conocimientos previos?',
    };

    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: { messages: ['No requiere conocimientos previos.'], call_offer: null },
        used_fact_ids: [
          'offering:redes-informaticas:name:v1',
          'offering:redes-informaticas:description:v1',
        ],
      }), prerequisiteContext),
      context: prerequisiteContext,
      response_goal: 'explain_selected_course',
      planned_fact_ids: [
        'offering:redes-informaticas:name:v1',
        'offering:redes-informaticas:description:v1',
      ],
    });

    expect(composition.narrative.opening).toBe('No requiere conocimientos previos.');
    expect(composition.used_fact_ids).toContain(
      'offering:redes-informaticas:description:v1',
    );
  });

  it('compacts multiline model copy before canonical assembly', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: ['Para avanzar necesito:\n- Nombre completo\n- Correo electrónico'],
          call_offer: null,
        },
      }), context()),
      context: context(),
      response_goal: 'clarify_current_step',
      planned_fact_ids: [],
    });

    expect(composition.narrative.opening).toBe(
      'Para avanzar necesito: - Nombre completo - Correo electrónico',
    );
  });

  it('does not echo a customer email from model-authored copy', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: ['Quedó registrado el correo cliente@example.test.'],
          call_offer: null,
        },
      }), context()),
      context: context(),
      response_goal: 'clarify_current_step',
      planned_fact_ids: [],
    });

    expect(composition.narrative.opening).toBe('Quedó registrado el correo tu correo.');
    expect(JSON.stringify(composition)).not.toContain('cliente@example.test');
  });

  it('keeps the model wording of an authorized payment-link response free of values and links', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: [
            'Para la inscripción necesito:\n- Nombre completo\n- Correo electrónico\n- Ciudad, estado y zip code',
            'Cuando pagues, mandame una captura del comprobante.',
          ],
          call_offer: null,
        },
      }), context()),
      context: context(),
      response_goal: 'confirm_payment_link',
      planned_fact_ids: [],
    });

    // The backend owns the link and the plan; the wording of the data request
    // stays the model's, as long as it carries no URL and no commercial value.
    expect(composition.narrative.opening).toContain('Nombre completo');
    expect(composition.narrative.explanation).toContain('captura del comprobante');
    expect(JSON.stringify(composition)).not.toMatch(/https?:\/\//u);
    expect(JSON.stringify(composition)).not.toMatch(/USD/u);
  });

  it('makes one strict structured request with the required budget', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, successBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    });

    expect(result.proposal.response.messages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.temperature).toBe(0.2);
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(800);
    expect(body.response_format).toMatchObject({
      type: 'json_schema', json_schema: { name: 'studyx_agent_a_turn_proposal_v1', strict: true },
    });
  });

  it('uses OpenAI structured outputs with the complete brain prompt and no Groq-only knobs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, responsesSuccessBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateOpenAIAgentATurnProposalV1({
      context: context(), apiKey: 'openai-test-key', signal: new AbortController().signal,
      model: 'gpt-5.6-terra',
    });

    expect(result).toMatchObject({ provider: 'openai-direct', model: 'gpt-5.6-terra', attempt_count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer openai-test-key',
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'none' },
      store: false,
      max_output_tokens: 800,
      text: {
        format: { type: 'json_schema', name: 'studyx_agent_a_turn_proposal_v1', strict: true },
      },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body.input[0].content[0].text).toContain('<canonical_sales_behavior');
    expect(body.input[0].content[0].text).toContain('<authorized_context>');
  });

  it('uses DeepSeek Flash through the Responses API with strict structured output and thinking disabled', async () => {
    const generateWithDeepSeek = (agentABrainModule as unknown as {
      generateDeepSeekAgentATurnProposalV1?: (input: {
        context: AgentAContextV1;
        apiKey: string;
        signal: AbortSignal;
        model?: string;
      }) => Promise<{
        proposal: ReturnType<typeof parseAgentATurnProposalV1>;
        provider: string;
        model: string;
      }>;
    }).generateDeepSeekAgentATurnProposalV1;
    expect(generateWithDeepSeek).toBeTypeOf('function');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      200,
      {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: `\`\`\`json\n${JSON.stringify(proposal())}\n\`\`\`` }],
        }],
        usage: {
          input_tokens: 1_200,
          output_tokens: 180,
          total_tokens: 1_380,
          input_tokens_details: { cached_tokens: 200 },
        },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithDeepSeek!({
      context: context(), apiKey: 'deepseek-test-key', signal: new AbortController().signal,
      model: 'deepseek-v4-flash',
    });

    expect(result).toMatchObject({
      provider: 'deepseek-direct',
      model: 'deepseek-v4-flash',
      token_usage: {
        input_tokens: 1_200,
        cached_input_tokens: 200,
        output_tokens: 180,
        total_tokens: 1_380,
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/responses');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer deepseek-test-key',
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      reasoning: { effort: 'none' },
      max_output_tokens: 800,
      text: {
        format: { type: 'json_schema', name: 'studyx_agent_a_turn_proposal_v1' },
      },
    });
    // The provider must be able to emit the same correlation contract that
    // the resolver validates; original generations cannot claim a repair.
    expect(body.text.format.schema.properties.repair_of).toEqual({ type: 'null' });
    expect(body.text.format.schema.required).toContain('repair_of');
    expect(body.instructions).toContain('<canonical_sales_behavior');
    expect(body.input).toContain('JSON');
    expect(body.input).toContain(JSON.stringify(context().turn.batch_messages.map((message) => message.text)));
    const moveProperties = body.text.format.schema.properties.move.properties;
    const responseProperties = body.text.format.schema.properties.response.properties;
    expect(body.text.format.schema.properties.used_fact_ids.maxItems).toBe(60);
    expect(responseProperties.messages.maxItems).toBe(2);
    expect(responseProperties.messages.description).toContain(
      'when call_offer is non-null, return exactly one response message',
    );
    expect(responseProperties.call_offer.description).toContain('must not contain a question');
    expect(moveProperties.move.enum).toEqual(expect.arrayContaining([
      'report_payment',
      'ask_current_state',
      'provide_contact_details',
    ]));
    expect(moveProperties.move.description).toContain(
      'report_payment requires an explicit current-message claim that payment already happened',
    );
    expect(moveProperties.move.description).toContain(
      'select_course requires exactly one resolved canonical course_reference',
    );
    expect(moveProperties.move.description).toContain(
      'use browse_catalog when you present several courses and ask the customer to choose',
    );
    expect(body.instructions).toContain(
      'The customer may select the canonical plan and explicitly request its link in',
    );
    expect(body.instructions).toContain(
      'When turn_rejection is present',
    );
    expect(body.instructions).toContain(
      'A diagnostic question is asked at most once per course selection',
    );
    expect(body.instructions).toContain(
      'answer the current question instead of repeating the diagnostic',
    );
    expect(body.instructions).toContain(
      'ask one of the fields still present in capabilities.intake_missing',
    );
    expect(body.instructions).toContain(
      'Use at most two response.messages and at most one question in the whole turn',
    );
    expect(body.instructions).toContain(
      'Product logistics mentioned in behavioral examples are not authorized facts',
    );
    expect(moveProperties.secondary_moves.items.enum).not.toContain('greeting');
    expect(moveProperties.secondary_moves.items.enum).not.toContain('unknown');
    expect(moveProperties.vetoes.description).toContain('current customer message explicitly refuses');
  });

  it('preserves canonical course selection when DeepSeek flattens the move object at the root', async () => {
    const ctx = context();
    ctx.commercial_state.selected_offering_code = null;
    ctx.commercial_state.stage = 'exploring';
    ctx.catalog.selected_offering = null;
    ctx.catalog.available_offerings = [{
      code: 'redes-informaticas',
      fact_id: 'offering:redes-informaticas:name:v1',
      display_name: 'Redes Informáticas',
      area_code: 'tecnologia',
    }];
    ctx.catalog.payment_plans = [];
    const flattened = {
      schema_version: 1,
      move: 'select_course',
      secondary_moves: [],
      vetoes: [],
      course_reference: 'Redes Informáticas',
      area_reference: null,
      payment_plan: null,
      confidence: 0.99,
      response: {
        messages: ['Redes Informáticas es la opción que mejor encaja con lo que buscás.'],
        call_offer: 'Si te sirve, podemos coordinar una llamada breve.',
      },
      proposed_action: { type: 'none' },
      repair_of: null,
      used_fact_ids: ['offering:redes-informaticas:name:v1'],
      used_memory_ids: [],
      memory_candidates: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      200,
      responsesSuccessBody(flattened),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateDeepSeekAgentATurnProposalV1({
      context: ctx,
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.proposal.move).toMatchObject({
      move: 'select_course',
      course_reference: 'redes-informaticas',
      confidence: 0.99,
    });
  });

  it('rejects a divergent DeepSeek model before fetch or commit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      200,
      responsesSuccessBody(proposal()),
    ));
    const commit = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const run = async () => {
      const generated = await generateDeepSeekAgentATurnProposalV1({
        context: context(),
        apiKey: 'deepseek-test-key',
        signal: new AbortController().signal,
        model: 'deepseek-reasoner',
      });
      await commit(generated);
    };

    await expect(run()).rejects.toThrow('AGENT_A_DEEPSEEK_MODEL_MISMATCH');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('retries one DeepSeek schema violation inside the same bounded deadline', async () => {
    const invalidProposal = proposal({ response: { messages: [] } });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse(200, responsesSuccessBody(invalidProposal)))
      .mockResolvedValueOnce(providerResponse(200, responsesSuccessBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateDeepSeekAgentATurnProposalV1({
      context: context(),
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: 'deepseek-direct',
      attempt_count: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retryBody.input).toContain('response.messages:too_small');
    expect(retryBody.input).toContain('previous output failed validation');
  });

  it('retries one malformed DeepSeek JSON response inside the same bounded deadline', async () => {
    const malformed = {
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"schema_version":1' }] }],
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse(200, malformed))
      .mockResolvedValueOnce(providerResponse(200, responsesSuccessBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateDeepSeekAgentATurnProposalV1({
      context: context(),
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: 'deepseek-direct',
      attempt_count: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retryBody.input).toContain('root:invalid_json');
  });

  it('reassembles a structured DeepSeek response split across output_text items', async () => {
    const encoded = JSON.stringify(proposal());
    const splitAt = Math.floor(encoded.length / 2);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, {
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: encoded.slice(0, splitAt) },
          { type: 'output_text', text: encoded.slice(splitAt) },
        ],
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateDeepSeekAgentATurnProposalV1({
      context: context(),
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ attempt_count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops non-authoritative DeepSeek root metadata before strict validation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      200,
      responsesSuccessBody(proposal({ provider_commentary: 'non-authoritative' })),
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateDeepSeekAgentATurnProposalV1({
      context: context(),
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: 'deepseek-direct',
      attempt_count: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the structured repair identity emitted by DeepSeek', async () => {
    const repairOf = {
      rejection_id: '00000000-0000-4000-8000-000000000001',
      attempt: 1 as const,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      200,
      responsesSuccessBody(proposal({ repair_of: repairOf })),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateDeepSeekAgentATurnProposalV1({
      context: {
        ...context(),
        turn_rejection: {
          schema_version: 1, ...repairOf,
          rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'price' }],
          authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] },
        },
      },
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    });

    expect(result.proposal.repair_of).toEqual(repairOf);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const wireRepair = body.text.format.schema.properties.repair_of;
    expect(body.text.format.schema.required).toContain('repair_of');
    expect(wireRepair).toMatchObject({
      type: 'object', additionalProperties: false,
      required: ['rejection_id', 'attempt'],
      properties: {
        rejection_id: { type: 'string', enum: [repairOf.rejection_id] },
        attempt: { type: 'integer', enum: [1] },
      },
    });
  });

  it('allows DeepSeek ten seconds and classifies a timeout while reading the response body', async () => {
    expect(AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS).toBe(10_000);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (_url, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }),
    } as Response)));

    const pending = generateDeepSeekAgentATurnProposalV1({
      context: context(),
      apiKey: 'deepseek-test-key',
      signal: new AbortController().signal,
    });
    const timeoutAssertion = expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_DEEPSEEK_TIMEOUT' }),
    );
    await vi.advanceTimersByTimeAsync(AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS + 1);
    await timeoutAssertion;
  });

  it('fails closed with an OpenAI-specific error without exposing the provider body', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      429,
      { error: { message: 'CANARY_SECRET_PROVIDER_BODY' } },
      { 'retry-after': '3' },
    )));

    await expect(generateOpenAIAgentATurnProposalV1({
      context: context(), apiKey: 'openai-test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({
      code: 'BRAIN_OPENAI_RATE_LIMITED',
      status: 429,
      retry_after_ms: 3_000,
      detail: null,
    }));
  });

  it('can execute the same brain contract through direct Gemini when Groq is unavailable', async () => {
    const generateWithGemini = (agentABrainModule as unknown as {
      generateGeminiAgentATurnProposalV1?: (input: {
        context: AgentAContextV1;
        apiKey: string;
        signal: AbortSignal;
        model?: string;
      }) => Promise<{
        proposal: ReturnType<typeof parseAgentATurnProposalV1>;
        provider: string;
        model: string;
      }>;
    }).generateGeminiAgentATurnProposalV1;
    expect(generateWithGemini).toBeTypeOf('function');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(proposal()) }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithGemini!({
      context: context(), apiKey: 'gemini-test-key',
      signal: new AbortController().signal, model: 'gemini-2.5-flash',
    });

    expect(result.provider).toBe('google-ai-direct');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.proposal.response.messages).toEqual(proposal().response.messages);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/models/gemini-2.5-flash:generateContent');
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toContain('canonical_sales_behavior');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('classifies a 429 without retrying when Retry-After exceeds the remaining deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      429, { error: { message: 'secret provider body' } }, { 'retry-after': '10' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({
      code: 'BRAIN_RATE_LIMITED',
      retry_after_ms: 10_000,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries one transient 5xx only when Retry-After fits inside the deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse(503, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(providerResponse(200, successBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).resolves.toMatchObject({ attempt_count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies timeout and malformed provider JSON separately', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', hangingFetch);
    const pending = generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    });
    const timeoutAssertion = expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_TIMEOUT' }),
    );
    await vi.advanceTimersByTimeAsync(AGENT_A_BRAIN_DEADLINE_MS + 1);
    await timeoutAssertion;
    vi.useRealTimers();

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, {
      choices: [{ message: { content: '{not-json' } }],
    })));
    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_INVALID_JSON' }));
  });
});
