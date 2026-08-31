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
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

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
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none',
    },
    catalog: {
      selected_offering: {
        code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
      candidate_offerings: [],
      payment_plans: [{ code: 'monthly_12', label: '12 pagos mensuales de USD 30' }],
    },
    capabilities: {
      may_reply: true, may_offer_call: true, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false, authorized_payment_plan: null,
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
  it('parses a natural multi-message proposal against authorized facts and memories', () => {
    expect(parseAgentATurnProposalV1(proposal(), context()).response.messages).toHaveLength(2);
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
      course_reference: 'Redes Informáticas',
    });
    expect(parsed.move).not.toHaveProperty('area_reference');
    expect(parsed.move).not.toHaveProperty('payment_plan');
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

  it('preserves ordinary sales language for backend egress validation instead of replacing it early', () => {
    const natural = 'Sí, tenemos varias opciones y te ayudo a encontrar la que mejor encaje con tu objetivo.';
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

  it('preserves natural prose and delegates commercial validation to the backend', () => {
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
      opening: 'Podemos estudiar de forma virtual.',
      explanation: 'Podemos revisar juntos lo que más te importa.',
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
        commercial_state: { ...context().commercial_state, call_offer_count: 1 },
      },
      response_goal: 'explain_selected_course',
      planned_fact_ids: [],
    });
    const chatContinuation = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: {
        ...context(),
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
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'monthly_12' as const,
      },
      capabilities: {
        ...context().capabilities,
        may_send_payment_link: true,
        authorized_payment_plan: 'monthly_12' as const,
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

  it('uses bounded backend-owned copy for an authorized payment-link response', () => {
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

    expect(composition.narrative).toEqual({
      opening: 'Para inscribirte necesito nombre completo, correo, ciudad, estado y ZIP.',
      explanation: null,
      next_question: null,
    });
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
    expect(body.instructions).toContain('<canonical_sales_behavior');
    expect(body.input).toContain('JSON');
    const moveProperties = body.text.format.schema.properties.move.properties;
    expect(moveProperties.secondary_moves.items.enum).not.toContain('greeting');
    expect(moveProperties.secondary_moves.items.enum).not.toContain('unknown');
    expect(moveProperties.vetoes.description).toContain('current customer message explicitly refuses');
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
