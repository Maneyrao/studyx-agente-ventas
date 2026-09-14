import { describe, expect, it, vi } from 'vitest';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { AgentABrainError } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import type {
  AgentAContextV1,
  AgentATurnProposalV1,
} from '../../../botpress-agent/src/schemas/agent-a-brain';

const NAME_FACT = 'offering:maquillaje-profesional:name:v1';
const DURATION_FACT = 'offering:maquillaje-profesional:duration:v1';
const AVAILABLE_NAME_FACT = 'offering:fotografia-profesional:name:v1';
const ENGLISH_1_NAME_FACT = 'offering:ingles-1:name:v1';
const ENGLISH_2_NAME_FACT = 'offering:ingles-2:name:v1';
const ENGLISH_3_NAME_FACT = 'offering:ingles-3:name:v1';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: {
      batch_messages: [{ id: 'm1', text: '¿Cuánto dura la formación?' }],
      recent_turns: [],
    },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'maquillaje-profesional', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false,
    },
    obligations: { stage: 'course_selected', owes: [], not_yet: [] },
    catalog: {
      available_offerings: [],
      selected_offering: {
        code: 'maquillaje-profesional', display_name: 'Maquillaje Profesional',
        area_code: 'moda-belleza',
        facts: [
          { id: NAME_FACT, kind: 'offering_name', value: 'Maquillaje Profesional' },
          { id: DURATION_FACT, kind: 'offering_duration', value: '38 clases' },
        ],
      },
      areas: [], candidate_offerings: [], payment_plans: [],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: true,
      may_present_payment_options: true, may_send_payment_link: false,
      authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
    },
  };
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
      course_reference: 'Maquillaje Profesional', confidence: 1,
    },
    response: { messages: ['La formación tiene 38 clases.'], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: [NAME_FACT, DURATION_FACT],
    used_memory_ids: [], memory_candidates: [], repair_of: null,
    ...overrides,
  } as AgentATurnProposalV1;
}

function generated(value: AgentATurnProposalV1) {
  return {
    proposal: value,
    provider: 'deepseek-direct' as const,
    model: 'deepseek-v4-flash', latency_ms: 100, attempt_count: 1 as const,
  };
}

describe('resolveAgentAPlannerlessProposalV2', () => {
  it('does not count an omitted optional call_offer as another call solicitation', async () => {
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: ['¿Querés que te prepare el enlace para avanzar?'] } })),
      context: context(), repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.evidence.rejection_codes).toEqual([]);
    expect(result.effective.proposal.response.messages).toEqual(['¿Querés que te prepare el enlace para avanzar?']);
  });

  it('keeps model-authored message boundaries even when the call invitation format is imperfect', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    const repair = vi.fn();
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: {
          messages: ['Maquillaje Profesional.', 'La formación tiene 38 clases.'],
          call_offer: 'Si querés, puedo llamarte para orientarte.',
        },
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response).toEqual({
      messages: ['Maquillaje Profesional.', 'La formación tiene 38 clases.'],
      call_offer: 'Si querés, puedo llamarte para orientarte.',
    });
    expect(result.evidence).toMatchObject({
      rejection_codes: [],
      repair_attempted: false,
      repaired: false,
    });
  });

  it('preserves every model-authored message before an authorized call reminder', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Contame en detalle qué voy a aprender y cómo se cursa.';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.call_offer_count = 1;
    current.capabilities.may_offer_call = true;
    const messages: [string, string, string] = [
      `Primera parte. ${'a'.repeat(175)}`,
      `Segunda parte. ${'b'.repeat(175)}`,
      'Tercera parte con el próximo paso elegido por DeepSeek.',
    ];
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: {
          messages,
          call_offer: 'Recordá que puedo llamarte y explicarte más, si querés.',
        },
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response).toEqual({
      messages,
      call_offer: 'Recordá que puedo llamarte y explicarte más, si querés.',
    });
  });

  it('does not spend a repair merely to add or reformat a recommended call offer', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal()), context: current, repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-000000000001',
      repair: async () => generated(proposal({
        response: {
          messages: ['Maquillaje Profesional.', 'La formación tiene 38 clases.'],
          call_offer: 'Si querés, puedo llamarte para orientarte.',
        },
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      })),
    });
    expect(result.effective.proposal.response).toEqual(proposal().response);
    expect(result.evidence).toMatchObject({ repair_attempted: false, repaired: false });
  });

  it('reports the terminal repair schema rejection instead of only the initial missing call', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: { messages: ['No necesitás experiencia previa.'], call_offer: null },
      })), context: current, repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-000000000001',
      repair: async () => generated(proposal({
        response: { messages: [] as never, call_offer: null },
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      })),
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:PROPOSAL_SCHEMA_INVALID:response.messages');
  });

  it('records the terminal provider-parser rejection when repair cannot form a proposal', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: { messages: ['No necesitás experiencia previa.'], call_offer: null },
      })), context: current, repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-000000000001',
      repair: async () => { throw new AgentABrainError('BRAIN_INVALID_SCHEMA', null, 'response.messages:invalid_union'); },
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:PROPOSAL_SCHEMA_INVALID:response.messages');
  });

  it('never replaces DeepSeek copy with a hardcoded catalog answer when the only repair is malformed', async () => {
    const current = context();
    current.customer.display_name = 'Julia';
    current.turn.batch_messages = [{ id: 'm2', text: 'Sigo sin decidirme: cuál me conviene para conseguir clientes?' }];
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: 'Estás entre Marketing Digital y Community Manager.',
    }];
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.catalog.selected_offering = null;
    current.catalog.candidate_offerings = [
      {
        code: 'marketing_digital',
        fact_id: 'offering:marketing_digital:name:v1',
        display_name: 'Marketing Digital',
        area_code: 'marketing',
      },
      {
        code: 'community_manager',
        fact_id: 'offering:community_manager:name:v1',
        display_name: 'Community Manager',
        area_code: 'marketing',
      },
    ];
    current.capabilities.may_offer_call = true;
    const callOffer = 'Si prefieres, lo vemos en una llamada breve y te ayudo a decidir.';

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.72,
        },
        response: {
          messages: ['Los dos sirven, pero uno apunta a campañas y el otro a manejar una comunidad.'],
          call_offer: callOffer,
        },
        used_fact_ids: [
          'offering:marketing_digital:name:v1',
          'offering:community_manager:name:v1',
        ],
      })),
      context: current,
      repair_enabled: true,
      repair: async () => {
        throw new AgentABrainError('BRAIN_INVALID_SCHEMA', null, 'move:invalid_type');
      },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.effective.proposal.response.messages).toEqual([
      'Los dos sirven, pero uno apunta a campañas y el otro a manejar una comunidad.',
    ]);
    expect(result.effective.proposal.response.messages.join(' ')).not.toContain('Para orientarte entre');
    expect(result.effective.proposal.response.call_offer).toBe(callOffer);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: false });
  });

  it('preserves a confirmed call action and its model-authored acknowledgement after an offer', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Sí, llamame ahora.' }];
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Perfecto, te llamo ahora.'], call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      })),
      context: current, repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response.messages).toEqual(['Perfecto, te llamo ahora.']);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'request_call_now', reason: 'accepted_offer' });
  });

  it('preserves requested information embedded with an unsolicited pending-call reminder', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: {
        messages: ['La formación tiene 38 clases. Si querés, coordinamos una llamada.'], call_offer: null,
      } })),
      context: current, repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response).toEqual({
      messages: ['La formación tiene 38 clases. Si querés, coordinamos una llamada.'], call_offer: null,
    });
  });

  it.each(['initial', 'repair'] as const)('preserves information inside a suppressed declared offer in the %s proposal', async (phase) => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const value = proposal({ response: {
      messages: ['Maquillaje Profesional.'],
      call_offer: 'La formación tiene 38 clases. Si querés, coordinamos una llamada.',
    } });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(phase === 'initial' ? value : proposal({ response: { messages: [] as never, call_offer: null } })),
      context: current, repair_enabled: true,
      repair: async () => generated({ ...value,
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      }),
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response).toEqual(value.response);
    expect(result.evidence.repaired).toBe(phase === 'repair');
  });

  it.each(['initial', 'repair'] as const)('keeps an imperfect information and invitation mix in the %s declared offer', async (phase) => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const value = proposal({ response: {
      messages: ['Maquillaje Profesional.'],
      call_offer: 'Si querés coordinamos una llamada, la formación tiene 38 clases.',
    } });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(phase === 'initial' ? value : proposal({ response: { messages: [] as never, call_offer: null } })),
      context: current, repair_enabled: true,
      repair: async () => generated({ ...value,
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      }),
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response).toEqual(value.response);
    expect(result.evidence.repaired).toBe(phase === 'repair');
  });

  it.each(['initial', 'repair'] as const)('preserves information when demoting an unresolved-course offer in the %s proposal', async (phase) => {
    const current = context();
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.catalog.selected_offering = null;
    current.catalog.areas = [{ code: 'tecnologia', display_name: 'Tecnología', fact_id: 'area:tecnologia:name:v1' }];
    current.capabilities.may_offer_call = true;
    const value = proposal({
      move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
      response: {
        messages: ['¿Buscás algo de tecnología o ya tenés un curso en mente?'],
        call_offer: 'El área es Tecnología. Si querés, coordinamos una llamada.',
      },
      used_fact_ids: ['area:tecnologia:name:v1'],
    });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(phase === 'initial' ? value : proposal({ response: { messages: [] as never, call_offer: null } })),
      context: current, repair_enabled: true,
      repair: async () => generated({ ...value,
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      }),
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response).toEqual(value.response);
    expect(result.evidence.repaired).toBe(phase === 'repair');
  });

  it('rejects a malformed declared offer instead of throwing during suppression', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.awaiting_reply = 'call_or_chat';
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: ['La formación tiene 38 clases.'], call_offer: 123 as never } })),
      context: current, repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:PROPOSAL_SCHEMA_INVALID:response.call_offer');
  });

  it('keeps a mixed information/reminder sentence and records the quality warning', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    current.capabilities.may_offer_call = true;
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: {
        messages: ['Si querés coordinamos una llamada, la formación tiene 38 clases.'], call_offer: null,
      } })),
      context: current, repair_enabled: true,
      repair: async () => generated(proposal({
        response: { messages: ['La formación tiene 38 clases.'], call_offer: null },
        repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
      })),
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response.messages).toEqual([
      'Si querés coordinamos una llamada, la formación tiene 38 clases.',
    ]);
    expect(result.evidence.repaired).toBe(false);
  });

  it.each([{ messages: [] }, { messages: [' '] }])('rejects an empty proposal rather than accepting a typed but invalid object $messages', async ({ messages }) => {
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: messages as never, call_offer: null } })),
      context: context(), repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PROPOSAL_SCHEMA_INVALID:response.messages');
  });

  it('does not turn an imperfect offer-only response into silence', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: {
        messages: ['Si querés, coordinamos una llamada.'], call_offer: null,
      } })),
      context: current, repair_enabled: false,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.effective.proposal.response.messages).toEqual(['Si querés, coordinamos una llamada.']);
  });

  it('does not rewrite a model-authored embedded initial invitation', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    current.catalog.selected_offering = null;
    current.catalog.available_offerings = [{
      code: 'fotografia-profesional', fact_id: AVAILABLE_NAME_FACT,
      display_name: 'Fotografía Profesional', area_code: 'fotografia',
    }];
    const repair = vi.fn();
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
        response: {
          messages: [
            'Tenemos Fotografía Profesional. Si querés, podemos coordinar una llamada breve para orientarte.',
          ],
          call_offer: null,
        },
        used_fact_ids: [AVAILABLE_NAME_FACT],
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response).toEqual({
      messages: ['Tenemos Fotografía Profesional. Si querés, podemos coordinar una llamada breve para orientarte.'],
      call_offer: null,
    });
    expect(result.evidence).toMatchObject({
      rejection_codes: ['CALL_OFFER_MESSAGE_BOUNDARY_INVALID'], repair_attempted: false,
    });
  });

  it('keeps one separate call invitation when the model duplicates it across fields', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: {
          messages: [
            'Maquillaje Profesional tiene 38 clases.',
            'Si querés, podemos coordinar una llamada breve.',
          ],
          call_offer: 'Si querés, puedo llamarte para orientarte.',
        },
      })),
      context: current,
      repair_enabled: true,
      repair: async () => { throw new Error('REPAIR_MUST_NOT_RUN'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.effective.proposal.response).toEqual({
      messages: ['Maquillaje Profesional tiene 38 clases.'],
      call_offer: 'Si querés, puedo llamarte para orientarte.',
    });
  });

  it('keeps an unsolicited follow-up offer as model-owned copy', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: {
        messages: ['Fotografía Profesional tiene 41 clases online.'],
        call_offer: 'Si preferís, podemos coordinar una llamada breve.',
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true,
      repair: async () => { throw new Error('REPAIR_MUST_NOT_RUN'); },
      rejection_id: '00000000-0000-4000-8000-000000000002',
    });

    expect(resolved.effective.proposal.response.call_offer)
      .toBe('Si preferís, podemos coordinar una llamada breve.');
    expect(resolved.effective.proposal.response.messages)
      .toEqual(['Fotografía Profesional tiene 41 clases online.']);
  });

  it('does not block a response that repeats an offer before the customer answers', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: {
        messages: [
          'Fotografía Profesional tiene 41 clases online.',
          'Si preferís, podemos coordinar una llamada breve.',
        ],
        call_offer: null,
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true,
      repair: async () => { throw new Error('REPAIR_MUST_NOT_RUN'); },
      rejection_id: '00000000-0000-4000-8000-000000000002',
    });

    expect(resolved.effective.proposal.response.call_offer).toBeNull();
    expect(resolved.effective.proposal.response.messages)
      .toEqual(['Fotografía Profesional tiene 41 clases online.', 'Si preferís, podemos coordinar una llamada breve.']);
  });

  it('records but does not strip a reoffered call when the explanation repeats', async () => {
    const current = context();
    current.commercial_state.call_offer_count = 1;
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    current.turn.recent_turns = [{
      id: 'prior-agent', direction: 'outbound',
      content: 'Fotografía Profesional tiene 41 clases online.\n\nSi preferís, podemos coordinar una llamada breve.',
    }];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: {
        messages: ['Fotografía Profesional tiene 41 clases online.'],
        call_offer: 'Si preferís, podemos coordinar una llamada breve.',
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true,
      repair: async () => { throw new Error('REPAIR_MUST_NOT_RUN'); },
      rejection_id: '00000000-0000-4000-8000-000000000002',
    });

    expect(resolved.effective.proposal.response.call_offer)
      .toBe('Si preferís, podemos coordinar una llamada breve.');
    expect(resolved.effective.proposal.response.messages)
      .toEqual(['Fotografía Profesional tiene 41 clases online.']);
  });

  it('accepts an explicit payment deferral during pending intake without consuming a repair', async () => {
      const current = context();
      current.turn.batch_messages[0].text = 'Todavía no, prefiero pagar más adelante.';
      current.commercial_state.awaiting_reply = 'contact_details';
      current.commercial_state.selected_payment_plan = 'monthly_6';
      current.capabilities.intake_missing = ['nombre', 'apellido', 'correo', 'telefono'];
      const initial = generated(proposal({
        move: { schema_version: 1, move: 'defer_payment', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Está bien, podés retomar cuando te quede cómodo.'], call_offer: null },
      }));
      const result = await resolveAgentAPlannerlessProposalV2({
        initial, context: current, repair_enabled: false,
        repair: async () => { throw new Error('Unexpected repair'); },
        rejection_id: '00000000-0000-4000-8000-000000000001',
      });
      expect(result.effective.proposal.response).toEqual(initial.proposal.response);
      expect(result.evidence).toMatchObject({ rejection_codes: [], repair_attempted: false });
  });

  it('keeps a fabricated deferral visible without mutating or repairing it', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Inés';
    current.commercial_state.awaiting_reply = 'contact_details';
    current.commercial_state.selected_payment_plan = 'one_time';
    current.capabilities.intake_missing = ['apellido', 'correo', 'telefono'];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'defer_payment', secondary_moves: [],
        vetoes: ['payment_link'], confidence: 0.91,
      },
      response: { messages: ['¡Gracias, Inés!'], call_offer: null },
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['MISSING_INTAKE'], repair_attempted: false, repaired: false,
    });
  });

  it('accepts valid model-owned copy without invoking a planner or repair', async () => {
    const repair = vi.fn();
    const initial = generated(proposal());

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toEqual({
      rejection_codes: [], repair_attempted: false, repaired: false,
      proposal_generation_calls: 1,
    });
  });

  it('authorizes a cited offering name from the complete visible catalog', async () => {
    const current = context();
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.catalog.selected_offering = null;
    current.catalog.available_offerings = [{
      code: 'fotografia-profesional',
      fact_id: AVAILABLE_NAME_FACT,
      display_name: 'Fotografía Profesional',
      area_code: 'fotografia',
    }];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: {
        messages: ['Tenemos Fotografía Profesional. ¿Querés conocerla mejor?'],
        call_offer: null,
      },
      used_fact_ids: [AVAILABLE_NAME_FACT],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({
      rejection_codes: [], repair_attempted: false, proposal_generation_calls: 1,
    });
  });

  it('preserves a call offer after naming a backend-confirmed unresolved family', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Estoy averiguando inglés y todavía no sé qué nivel elegir. ¿Cuáles son los cursos disponibles?';
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.catalog.selected_offering = null;
    current.catalog.available_offerings = [
      { code: 'ingles-1', fact_id: ENGLISH_1_NAME_FACT, display_name: 'Inglés 1', area_code: 'idiomas' },
      { code: 'ingles-2', fact_id: ENGLISH_2_NAME_FACT, display_name: 'Inglés 2', area_code: 'idiomas' },
      { code: 'ingles-3', fact_id: ENGLISH_3_NAME_FACT, display_name: 'Inglés 3', area_code: 'idiomas' },
    ];
    current.capabilities.may_offer_call = true;
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: {
        messages: [
          'Para inglés tenemos Inglés 1, Inglés 2 e Inglés 3. ¿Te cuento en qué se diferencia cada uno para ayudarte a elegir?',
        ],
        call_offer: 'Si querés, podemos coordinar una llamada breve para orientarte mejor.',
      },
      used_fact_ids: [ENGLISH_1_NAME_FACT, ENGLISH_2_NAME_FACT, ENGLISH_3_NAME_FACT],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response).toEqual(initial.proposal.response);
    expect(result.evidence).toEqual({
      rejection_codes: [],
      repair_attempted: false,
      repaired: false,
      proposal_generation_calls: 1,
    });
  });

  it('treats a missing recommended call offer as guidance and never blocks the useful reply', async () => {
    const current = context();
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.catalog.selected_offering = null;
    current.catalog.available_offerings = [{
      code: 'fotografia-profesional',
      fact_id: AVAILABLE_NAME_FACT,
      display_name: 'Fotografía Profesional',
      area_code: 'fotografia',
    }];
    current.capabilities.may_offer_call = true;
    const initial = generated(proposal({
      move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Tenemos Fotografía Profesional. ¿Querés conocerla mejor?'], call_offer: null },
      used_fact_ids: [AVAILABLE_NAME_FACT],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: false, repair,
      rejection_id: '00000000-0000-4000-8000-000000000002',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['CALL_OFFER_REQUIRED'], repair_attempted: false, repaired: false,
    });
  });

  it('returns an uncited canonical value to DeepSeek once and accepts its cited rewrite', async () => {
    const initial = generated(proposal({
      response: { messages: ['La formación sale USD 480.'], call_offer: null },
      used_fact_ids: [NAME_FACT],
    }));
    const repaired = generated(proposal({
      response: { messages: ['Dura 38 clases.'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['FACT_VALUE_MISMATCH'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
  });

  // El `throw` dejó de ser el resultado de un hecho no autorizado: eso ahora
  // degrada al backend, que veta la oración. La invariante que este test
  // protege —una sola reparación, nunca dos— se verifica sobre el caso que
  // sigue siendo un rechazo duro: una propuesta que afirma un efecto que no
  // ocurrió.
  it('never requests a second rewrite when the only rewrite remains invalid', async () => {
    const lying = () => proposal({
      response: { messages: ['Listo, ya te mando el link de pago.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'monthly_12',
      },
      used_fact_ids: [NAME_FACT],
    });
    const repair = vi.fn().mockResolvedValue(generated({
      ...lying(),
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    } as never));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(lying()), context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');

    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('records a repeated prior question without rewriting the model response', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Prefiero seguir por chat';
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: '¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
    }];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: {
        messages: [
          'Perfecto, seguimos por chat.',
          '¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
        ],
        call_offer: null,
      },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(initial.proposal.response.messages);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'],
      repair_attempted: false,
      proposal_generation_calls: 1,
    });
  });

  it('records a repeated greeting without blocking or rewriting the response', async () => {
    const current = context();
    current.customer.display_name = 'Thiago';
    current.turn.batch_messages[0].text = 'Thiago me llamo';
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: '¡Buenas tardes! Soy el asistente virtual de StudyX. ¿Cómo te llamás?',
    }];
    const initial = generated(proposal({
      response: {
        messages: [
          '¡Buenas tardes, Thiago! Soy el asistente virtual de StudyX. La formación tiene 38 clases.',
        ],
        call_offer: null,
      },
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000003',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(initial.proposal.response.messages);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'],
      repair_attempted: false,
      proposal_generation_calls: 1,
    });
  });

  it.each([
    {
      draft: '¡Perfecto, seguimos por acá sin problema! 😊 Para contarte bien cómo funciona el curso, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
      retained: '¡Perfecto, seguimos por acá sin problema!',
    },
    {
      draft: 'De acuerdo, seguimos por escrito. La formación tiene 38 clases. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
      retained: 'De acuerdo, seguimos por escrito. La formación tiene 38 clases.',
    },
  ])('records the repeated question inside one compound message: $retained', async ({ draft }) => {
    const current = context();
    current.turn.batch_messages[0].text = 'No quiero que me llamen, prefiero por chat';
    current.turn.recent_turns = [{
      id: 'prior-agent', direction: 'outbound',
      content: 'Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
    }];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'],
        confidence: 1,
      },
      response: { messages: [draft], call_offer: null },
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual([draft]);
    expect(result.effective.proposal.move).toEqual(initial.proposal.move);
    expect(result.effective.proposal.proposed_action).toEqual(initial.proposal.proposed_action);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'], repair_attempted: false,
      repaired: false, proposal_generation_calls: 1,
    });
  });

  it('demotes a payment action that the current conversational move did not request', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Soy Matía Damonte, matia@example.test';
    current.commercial_state.awaiting_reply = 'payment_confirmation';
    current.commercial_state.selected_payment_plan = 'monthly_6';
    current.capabilities.may_send_payment_link = true;
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['Gracias por los datos.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal).toMatchObject({
      response: initial.proposal.response,
      proposed_action: { type: 'none' },
    });
  });

  it('accepts a link action when the same explicit move selects its canonical plan', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Elijo 6 cuotas y pasame el link';
    current.commercial_state.selected_payment_plan = null;
    current.capabilities.may_send_payment_link = true;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'select_payment_plan',
        secondary_moves: ['request_payment_link'], vetoes: [],
        payment_plan: 'monthly_6', confidence: 1,
      },
      response: { messages: ['Perfecto, te comparto el link seguro.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.rejection).toBeNull();
  });

  it('demotes an unsolicited payment action while preserving safe model-owned acknowledgement', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Soy Tomás Quiroga, tomas@example.test';
    current.commercial_state.awaiting_reply = 'payment_confirmation';
    current.commercial_state.selected_payment_plan = 'monthly_6';
    current.capabilities.may_send_payment_link = false;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: {
        messages: ['Gracias por pasarme tus datos. Cuando quieras avanzar, pedime el link.'],
        call_offer: null,
      },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.effective.proposal.response.messages).toEqual(initial.proposal.response.messages);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['ACTION_NOT_AUTHORIZED'], repair_attempted: false,
      repaired: false, proposal_generation_calls: 1,
    });
  });

  it('demotes a premature payment action while contact intake is still incomplete', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Soy Nadia Ferrer';
    current.commercial_state.awaiting_reply = 'contact_details';
    current.commercial_state.selected_payment_plan = 'monthly_12';
    current.capabilities.may_send_payment_link = true;
    current.capabilities.intake_missing = ['correo'];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['Gracias, Nadia. Todavía me falta tu correo.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_12',
      },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({
      rejection_codes: ['MISSING_INTAKE'], repair_attempted: false,
      proposal_generation_calls: 1,
    });
  });

  it('does not demote an unsolicited action when the prose falsely claims the link was sent', async () => {
    const current = context();
    current.commercial_state.awaiting_reply = 'payment_confirmation';
    current.commercial_state.selected_payment_plan = 'monthly_6';
    current.capabilities.may_send_payment_link = false;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['Perfecto, ahora te comparto el link de pago.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
      used_fact_ids: [],
    }));
    const repaired = generated(proposal({
      move: initial.proposal.move,
      response: { messages: ['Gracias por pasarme tus datos. Avisame cuando quieras avanzar.'], call_offer: null },
      proposed_action: { type: 'none' }, used_fact_ids: [],
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
  });
});

/**
 * Un rechazo de hecho ya no puede matar el turno.
 *
 * Con la reparación apagada, cualquier rechazo tiraba
 * `PLANNERLESS_PROPOSAL_REJECTED` y el cliente recibía el piso técnico. Hoy la
 * frontera autoritativa es el backend, que veta la ORACIÓN culpable y entrega
 * el resto: dejar pasar la propuesta es estrictamente más seguro que borrarla,
 * porque el hecho falso no sobrevive igual y la conversación sí.
 *
 * Lo que sigue siendo intolerable es afirmar un efecto que no ocurrió.
 */
describe('degradado en vez de rechazo duro', () => {
  const rejectedByPrice = () => generated(proposal({
    response: { messages: ['La formación sale USD 480.'], call_offer: null },
    used_fact_ids: [NAME_FACT],
  }));

  it('entrega la propuesta al backend cuando la reparación está apagada', async () => {
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: rejectedByPrice(), context: context(), repair_enabled: false,
      repair: vi.fn(), rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.evidence.rejection_codes).toEqual(['FACT_VALUE_MISMATCH']);
    expect(result.evidence.repaired).toBe(false);
    expect(result.effective.proposal.response.messages).toEqual(['La formación sale USD 480.']);
  });

  it('entrega la propuesta cuando la única reparación sigue siendo inválida', async () => {
    const repair = vi.fn().mockResolvedValue(generated(proposal({
      response: { messages: ['La formación sale USD 480.'], call_offer: null },
      used_fact_ids: [NAME_FACT],
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    })));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: rejectedByPrice(), context: context(), repair_enabled: true,
      repair, rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal.response.messages).toEqual(['La formación sale USD 480.']);
  });

  it('sigue rechazando una propuesta que afirma haber mandado el link de pago', async () => {
    const lying = generated(proposal({
      response: { messages: ['Listo, ya te mando el link de pago.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'monthly_12',
      },
      used_fact_ids: [NAME_FACT],
    }));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial: lying, context: context(), repair_enabled: false,
      repair: vi.fn(), rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:send_payment_link');
  });
});

/**
 * Un turno mudo es peor que un turno recortado.
 *
 * Cuando el modelo afirma que manda el link y la acción no está autorizada, la
 * frontera exige la reparación del modelo — bien, porque la oración entera es
 * la mentira y el egress no puede podarla. Pero si esa única reparación
 * también falla, la ruta lanzaba `PLANNERLESS_PROPOSAL_REJECTED`, el workflow
 * lo clasificaba como cerebro caído y el turno salía en silencio.
 *
 * Observado por el arnés de workflow (`wf_03_plan_postergacion_link`): la
 * persona escribió "Ya está, mandame el link. Soy Lucía Ferrer, ...", entregó
 * los cuatro datos y no recibió NADA, con
 * `reason_code = BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK` y 2046 ms de cerebro.
 * El gate `zero_accidental_silence` del runner viejo daba verde igual.
 *
 * La salida correcta es la misma que ya se usa para la pregunta repetida:
 * quitar la oración ofensiva y entregar lo que queda, si lo que queda es
 * verdadero y suficiente. La afirmación falsa nunca se manda.
 */
describe('afirmar un link no autorizado no puede terminar en silencio', () => {
  const contextoSinLink = (): AgentAContextV1 => ({
    ...context(),
    capabilities: { ...context().capabilities, may_send_payment_link: false },
  });

  it('entrega el resto del turno en vez de callarse', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          // Sin importes ni afirmaciones de estado: lo que se prueba es que
          // sobreviva la parte verdadera, no el guard de hechos.
          'Gracias, Lucía.',
          'Te mando el link de pago ahora mismo.',
        ],
        call_offer: null,
      },
      proposed_action: {
        type: 'send_payment_link',
        offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: contextoSinLink(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000aa',
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
    });

    const mensajes = resolved.effective.proposal.response.messages;
    expect(mensajes.length).toBeGreaterThan(0);
    expect(mensajes.join(' ')).not.toMatch(/link/iu);
    expect(resolved.effective.proposal.proposed_action.type).toBe('none');
  });

  it('si no queda nada verdadero que decir, sigue siendo un rechazo duro', async () => {
    const initial = generated(proposal({
      response: { messages: ['Te mando el link de pago ahora mismo.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link',
        offering_code: 'maquillaje-profesional',
        payment_plan: 'monthly_6',
      },
    }));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial,
      context: contextoSinLink(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ab',
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
  });
});

/**
 * La afirmación de prerequisitos sin respaldo no puede llegar al cliente.
 *
 * El catálogo no tiene el hecho —lo verifiqué en el manual del dueño y en el
 * seed— así que el guard la rechaza. Se quitó también del prompt canónico (v4),
 * donde la biblioteca de objeciones la ordenaba. Pero el modelo la sigue
 * produciendo por su cuenta, y como `FACT_VALUE_MISMATCH` degrada a la frontera
 * del backend, la oración se entregaba igual.
 *
 * Marcarla y dejarla pasar hace que el guard sea decorativo. Se poda la oración
 * y se entrega el resto, que es el mismo criterio de la pregunta repetida y del
 * link no autorizado.
 */
describe('prerequisitos sin respaldo se podan, no se entregan', () => {
  it('quita la oración y conserva el resto del turno', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'Para arrancar no necesitás experiencia previa ni conocimientos de maquillaje.',
          'La formación tiene 38 clases.',
        ],
        call_offer: null,
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ac',
      repair: vi.fn(),
    });

    const mensajes = resolved.effective.proposal.response.messages;
    expect(mensajes.length).toBeGreaterThan(0);
    expect(mensajes.join(' ')).not.toMatch(/no necesit[aá]s experiencia/iu);
    expect(mensajes.join(' ')).toMatch(/38 clases/u);
  });

  it('preserves a valid course selection while removing an unsupported prerequisite clause', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'Inglés 1 es el punto de partida para quienes no tienen conocimientos previos.',
        ],
        call_offer: null,
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ae',
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
    });

    expect(resolved.effective.proposal.response.messages.join(' ')).toContain('Inglés 1');
    expect(resolved.effective.proposal.response.messages.join(' '))
      .not.toMatch(/no tienen conocimientos previos/iu);
  });

  it('una pregunta de diagnóstico no se poda: no afirma nada', async () => {
    const initial = generated(proposal({
      response: {
        messages: ['¿Tenés conocimientos previos o partís desde cero?'],
        call_offer: null,
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ad',
      repair: async () => { throw new Error('NO_DEBERIA_REPARARSE'); },
    });

    expect(resolved.effective.proposal.response.messages)
      .toEqual(['¿Tenés conocimientos previos o partís desde cero?']);
  });
});

describe('flexibilidad de cursada sin respaldo se poda, no se entrega', () => {
  it('conserva las partes seguras cuando la reparación repite la inferencia', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'La formación tiene 38 clases.',
          'Al ser online, podés avanzar a tu ritmo desde donde estés. ¿Querés conocer el contenido?',
        ],
        call_offer: null,
      },
    }));

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000af',
      repair: vi.fn(async () => generated({
        ...initial.proposal,
        repair_of: {
          rejection_id: '00000000-0000-4000-8000-0000000000af', attempt: 1,
        },
      })),
    });

    expect(resolved.effective.proposal.response.messages).toEqual([
      'La formación tiene 38 clases.',
      '¿Querés conocer el contenido?',
    ]);
    expect(resolved.effective.proposal.response.messages.join(' '))
      .not.toMatch(/a tu ritmo|desde donde est[eé]s/iu);
  });
});
