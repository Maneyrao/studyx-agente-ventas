import { describe, expect, it, vi } from 'vitest';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { AgentABrainError, parseAgentATurnProposalV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
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
      areas: [], candidate_offerings: [], payment_plans: [
        { code: 'monthly_12', fact_id: 'payment:maquillaje-profesional:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' },
        { code: 'monthly_6', fact_id: 'payment:maquillaje-profesional:monthly_6:label:v1', label: '6 pagos mensuales de USD 60' },
        { code: 'one_time', fact_id: 'payment:maquillaje-profesional:one_time:label:v1', label: '1 pago de USD 360' },
      ],
    },
    capabilities: {
      may_reply: true, may_offer_call: true, may_request_call_now: true,
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
  it('accepts the authorized test amount with decimal dot when its source uses a decimal comma', async () => {
    const current = context();
    current.catalog.test_payment_options = [{ code: 'stripe_verification_050',
      fact_id: 'payment-test:stripe_verification_050:label:v1', label: 'Prueba temporal de pago de USD 0,50', action: 'send_test_payment_link' }];
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: ['La prueba temporal es de USD 0.50.'], call_offer: null },
        used_fact_ids: ['payment-test:stripe_verification_050:label:v1'] })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-000000000098', repair: vi.fn(),
    });
    expect(result.effective.proposal.response.messages).toEqual(['La prueba temporal es de USD 0.50.']);
  });

  it('retains a factually safe A draft when the single style repair still repeats instead of silencing the conversation', async () => {
    const current = context();
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: 'La formación tiene 38 clases.' }];
    const initial = generated(proposal());
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: true, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000097',
      repair: async rejection => generated(proposal({ repair_of: { rejection_id: rejection.rejection_id, attempt: 1 } })),
    });
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: false, proposal_generation_calls: 2 });
  });

  it('preserves the exact repair suspension instead of returning or pruning the prior draft', async () => {
    const current = context();
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: 'La formación tiene 38 clases.' }];
    const suspension = { [Symbol.for('StepSignal')]: true };
    const repair = vi.fn().mockRejectedValue(suspension);
    await expect(resolveAgentAPlannerlessProposalV2({ initial: generated(proposal()), context: current,
      repair_enabled: true, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-000000000090', repair,
    })).rejects.toBe(suspension);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Para completar el registro solo me falta tu teléfono. Me lo pasas con el código de tu país?',
    'El registro está incompleto; todavía necesito tu teléfono.',
  ])('allows a missing-field question without treating the noun registro as a completed effect: %s', async text => {
    const current = context();
    current.customer.contact_intake = { nombre: 'Luz María', apellido: 'van der Velde', correo: 'luz@example.test', telefono: null };
    current.capabilities.intake_missing = ['telefono'];
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: [text], call_offer: null } })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-000000000096', repair: vi.fn(),
    });
    expect(result.effective.proposal.response.messages).toEqual([text]);
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it.each([
    'No ofrecemos dos pagos de USD 180. Puedes elegir 12 pagos de USD 30.',
    'Te refieres a dos cuotas de USD 180?',
  ])('allows A to clarify or deny a price without asserting its availability: %s', async text => {
    const current = context();
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: [text], call_offer: null },
        used_fact_ids: current.catalog.payment_plans.map(plan => plan.fact_id) })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-000000000094', repair: vi.fn(),
    });
    expect(result.effective.proposal.response.messages).toEqual([text]);
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('preserves an exact repetition explicitly requested by the customer', async () => {
    const current = context();
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: 'La formación tiene 38 clases.' }];
    current.turn.batch_messages = [{ id: 'm1', text: 'Repíteme lo que dijiste, por favor.' }];
    const result = await resolveAgentAPlannerlessProposalV2({ initial: generated(proposal()), context: current,
      repair_enabled: false, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000095', repair: vi.fn() });
    expect(result.effective.proposal.response.messages).toEqual(['La formación tiene 38 clases.']);
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('repairs invented commercial amounts even when conversational guidance is advisory', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dos pagos, puede ser?' }];
    const initial = generated(proposal({
      move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Se puede en dos pagos de USD 180.'], call_offer: null },
      used_fact_ids: current.catalog.payment_plans.map(plan => plan.fact_id),
    }));
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: true, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000091',
      repair: async rejection => generated(proposal({
        move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Esa opción no está disponible. Puedes elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.'], call_offer: null },
        used_fact_ids: current.catalog.payment_plans.map(plan => plan.fact_id),
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      })),
    });
    expect(result.effective.proposal.response.messages).toEqual([
      'Esa opción no está disponible. Puedes elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.',
    ]);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true, proposal_generation_calls: 2 });
  });

  it('never releases a second invented price after the only permitted repair', async () => {
    const initial = generated(proposal({ response: { messages: ['Son USD 180 por pago.'], call_offer: null } }));
    await expect(resolveAgentAPlannerlessProposalV2({ initial, context: context(),
      repair_enabled: true, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000091',
      repair: async rejection => generated(proposal({
        response: { messages: ['Puedes pagar USD 47.'], call_offer: null },
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      })),
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:price');
  });

  it('returns a repeated unanswered assistant question to A without rewriting it in the orchestrator', async () => {
    const current = context();
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: 'La formación tiene 38 clases.' }];
    const result = await resolveAgentAPlannerlessProposalV2({ initial: generated(proposal()), context: current,
      repair_enabled: true, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000092',
      repair: async rejection => generated(proposal({
        response: { messages: ['Las 38 clases corresponden al programa completo. Qué parte quieres conocer?'], call_offer: null },
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      })),
    });
    expect(result.effective.proposal.response.messages).toEqual(['Las 38 clases corresponden al programa completo. Qué parte quieres conocer?']);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
  });

  it('asks A to remove a second invitation from the same answer without changing the chosen wording itself', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: {
        messages: ['La formación tiene 38 clases. Prefieres una llamada para orientarte?'],
        call_offer: 'Si te resulta cómodo, puedo llamarte para explicarlo.',
      } })), context: current, repair_enabled: true, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000093',
      repair: async rejection => generated(proposal({
        response: { messages: ['La formación tiene 38 clases.'], call_offer: 'Si te resulta cómodo, puedo llamarte para explicarlo.' },
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      })),
    });
    expect(result.effective.proposal.response).toEqual({
      messages: ['La formación tiene 38 clases.'], call_offer: 'Si te resulta cómodo, puedo llamarte para explicarlo.',
    });
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
  });

  it('does not let call-offer guidance block a canonical payment requested after the final intake field', async () => {
    const current = context();
    current.customer.display_name = 'Ana María Pérez';
    current.customer.contact_intake = { nombre: 'Ana María', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+15551234567' };
    current.continuity = { assistant_has_spoken: true, first_name_status: 'known', last_agent_reply: 'Me pasás el teléfono?' };
    current.turn.batch_messages = [{ id: 'm1', text: '+15551234567' }];
    current.commercial_state = { ...current.commercial_state, selected_payment_plan: 'monthly_12', call_offer_status: 'not_offered',
      payment_link_request: { status: 'pending', offering_code: 'maquillaje-profesional', payment_plan: 'monthly_12' } };
    current.capabilities.may_send_payment_link = true;
    const initial = generated(proposal({
      move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Ya tengo tus datos. Te comparto el enlace para pagar en 12 cuotas.'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'monthly_12' },
      used_fact_ids: ['payment:maquillaje-profesional:monthly_12:label:v1'],
    }));
    const repair = vi.fn().mockRejectedValue(new Error('Unexpected semantic repair'));
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: true, semantic_rejections: 'advisory', repair, rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual(initial.proposal.proposed_action);
  });

  it.each([
    ['pago 1', 'select_payment_plan', null, 'one_time'],
    ['12 pagos 30', 'select_payment_plan', null, 'monthly_12'],
    ['si', 'select_course', 'one_time', 'one_time'],
    ['si', 'ask_current_state', 'one_time', 'one_time'],
  ] as const)('accepts the explicit canonical payment tool request without a duplicate move label: %s / %s', async (text, kind, durablePlan, plan) => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text }];
    current.commercial_state = { ...current.commercial_state,
      selected_offering_code: 'ingles_1', selected_payment_plan: durablePlan, stage: 'handoff' };
    current.catalog.selected_offering = { code: 'ingles_1', display_name: 'Inglés 1', area_code: 'idiomas',
      facts: [{ id: 'offering:ingles_1:name:v1', kind: 'offering_name', value: 'Inglés 1' }] };
    current.catalog.payment_plans = [
      { code: 'one_time', fact_id: 'payment:ingles_1:one_time:label:v1', label: '1 pago de USD 360' },
      { code: 'monthly_12', fact_id: 'payment:ingles_1:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' },
    ];
    current.capabilities.may_send_payment_link = true;
    const initial = generated(proposal({
      move: { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 1,
        ...(kind === 'select_payment_plan' ? { payment_plan: plan } : {}),
        ...(kind === 'select_course' ? { course_reference: 'ingles_1' } : {}) },
      response: { messages: [kind === 'select_course'
        ? 'Perfecto, Thiago. Entonces queda Inglés 1 con el pago único de USD 360. Te dejo el enlace de pago enseguida.'
        : 'Perfecto, te comparto el enlace seguro.'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: plan },
      used_fact_ids: ['offering:ingles_1:name:v1', `payment:ingles_1:${plan}:label:v1`],
    }));
    const repair = vi.fn().mockRejectedValue(new Error('Unexpected repair'));
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: true, semantic_rejections: 'advisory', repair, rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(result.effective).toBe(initial);
    expect(result.rejection).toBeNull();
    expect(result.evidence).toMatchObject({ repair_attempted: false, proposal_generation_calls: 1 });
    expect(repair).not.toHaveBeenCalled();
  });

  it.each(['unavailable plan', 'unknown course', 'unknown intake', 'paid purchase', 'payment veto'])(
    'does not authorize a same-turn payment effect with %s', async condition => {
      const current = context();
      current.commercial_state.selected_payment_plan = 'monthly_6';
      current.capabilities.may_send_payment_link = true;
      if (condition === 'unavailable plan') current.catalog.payment_plans = [];
      if (condition === 'unknown course') current.catalog.selected_offering = null;
      if (condition === 'unknown intake') current.capabilities.intake_status = 'unknown';
      if (condition === 'paid purchase') current.commercial_state.payment_verification = {
        status: 'paid', offering_code: 'maquillaje-profesional', plan_code: 'monthly_6', paid_at: '2026-10-13T12:00:00Z',
      };
      const initial = generated(proposal({
        move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: [],
          vetoes: condition === 'payment veto' ? ['payment_link'] : [], payment_plan: 'monthly_6', confidence: 1 },
        response: { messages: ['Perfecto, te comparto el enlace seguro.'], call_offer: null },
        proposed_action: { type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'monthly_6' },
        used_fact_ids: [],
      }));
      await expect(resolveAgentAPlannerlessProposalV2({ initial, context: current,
        repair_enabled: false, semantic_rejections: 'advisory', rejection_id: '00000000-0000-4000-8000-000000000001',
        repair: async () => { throw new Error('Unexpected repair'); },
      })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:send_payment_link');
    },
  );

  it('accepts a canonical course confirmation and explicit link without requiring the course name in prose', async () => {
    const current = context();
    current.commercial_state.selected_payment_plan = 'one_time';
    current.capabilities.may_send_payment_link = true;
    const initial = generated(proposal({
      move: { schema_version: 1, move: 'select_course', course_reference: 'maquillaje-profesional',
        secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Perfecto, te dejo el enlace.'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'one_time' },
      used_fact_ids: [],
    }));
    const repair = vi.fn();
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: true, semantic_rejections: 'advisory', repair, rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(result.effective).toBe(initial);
    expect(result.rejection).toBeNull();
    expect(repair).not.toHaveBeenCalled();
  });

  it('rejects an unknown course selection even if the explicit tool names the previous canonical purchase', async () => {
    const current = context();
    current.commercial_state.selected_payment_plan = 'one_time';
    current.capabilities.may_send_payment_link = true;
    await expect(resolveAgentAPlannerlessProposalV2({ context: current,
      initial: generated(proposal({
        move: { schema_version: 1, move: 'select_course', course_reference: 'unknown_course',
          secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Perfecto, te comparto el enlace.'], call_offer: null },
        proposed_action: { type: 'send_payment_link', offering_code: 'maquillaje-profesional', payment_plan: 'one_time' }, used_fact_ids: [],
      })), repair_enabled: false, semantic_rejections: 'advisory', repair: vi.fn(),
      rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('ACTION_NOT_AUTHORIZED:send_payment_link');
  });

  it.each(['primary', 'secondary'] as const)('preserves unresolved %s course selection through parse, resolver and backend without reusing the previous purchase', async position => {
    const current = context();
    current.commercial_state = { ...current.commercial_state, selected_offering_code: 'python', selected_payment_plan: 'one_time' };
    current.catalog.selected_offering = { code: 'python', display_name: 'Python', area_code: 'tecnologia', facts: [] };
    current.catalog.payment_plans = [{ code: 'one_time', fact_id: 'payment:python:one_time:label:v1', label: '1 pago de USD 360' }];
    current.capabilities.may_send_payment_link = true;
    const messages = ['Seguimos por aquí.'];
    const parsed = parseAgentATurnProposalV1(proposal({
      move: { schema_version: 1, move: position === 'primary' ? 'select_course' : 'ask_current_state',
        course_reference: 'desconocido', secondary_moves: position === 'secondary' ? ['select_course'] : [],
        vetoes: [], confidence: 1 }, response: { messages, call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'python', payment_plan: 'one_time' }, used_fact_ids: [],
    }), current);
    const result = await resolveAgentAPlannerlessProposalV2({ initial: generated(parsed), context: current,
      repair_enabled: false, semantic_rejections: 'advisory', repair: vi.fn(),
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(result.effective.proposal.response.messages).toEqual(messages);
    expect(result.action_rejection).toMatchObject({ action: 'send_payment_link', codes: ['ACTION_NOT_AUTHORIZED'] });
    const authority = authorizeAgentTurnV2({ proposal: result.effective.proposal,
      state: { ...createDefaultConversationStateV1({ workspace_id: 'w', conversation_id: 'c', contact_id: 'u' }),
        selected_offering_code: 'python', selected_payment_plan: 'one_time' },
      offerings: [{ code: 'python', display_name: 'Python' }],
      facts: [{ id: 'payment:python:one_time:label:v1', kind: 'payment_plan_label', source: 'business_snapshot',
        value: '1 pago de USD 360', offering_code: 'python', payment_plan: 'one_time' }],
      contact_intake: { nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+5491112345678' },
      semantic_rejections: 'advisory', call_policy: { may_offer_call: false, may_request_call_now: false },
    });
    expect(authority).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_offering_code: 'python', selected_payment_plan: 'one_time', payment_link_request: null,
    } });
  });

  it('keeps a plan selection with none action free of implicit payment requests', async () => {
    const current = context();
    current.capabilities.may_send_payment_link = true;
    const initial = generated(proposal({
      move: { schema_version: 1, move: 'select_payment_plan', payment_plan: 'one_time',
        secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Perfecto, seguimos con esa opción.'], call_offer: null }, used_fact_ids: [],
    }));
    const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
      repair_enabled: false, semantic_rejections: 'advisory', repair: vi.fn(),
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
  });

  it.each(['requested', 'provider_accepted', 'in_progress'])(
    'keeps a factual registration confirmation backed by an active %s call', async status => {
      const current = context();
      current.turn.batch_messages = [{ id: 'm1', text: '¿Ya pediste la llamada?' }];
      current.commercial_state.active_call = { call_id: '00000000-0000-4000-8000-0000000000c1', status };
      current.capabilities.may_request_call_now = false;
      const messages = ['Sí, la llamada ya quedó registrada.'];
      const result = await resolveAgentAPlannerlessProposalV2({
        initial: generated(proposal({ response: { messages, call_offer: null } })),
        context: current, repair_enabled: false, semantic_rejections: 'advisory',
        rejection_id: '00000000-0000-4000-8000-0000000000e7',
        repair: async () => { throw new Error('Unexpected repair'); },
      });
      expect(result.effective.proposal.response.messages).toEqual(messages);
      expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
      expect(result.evidence.repair_attempted).toBe(false);
    },
  );

  it.each([
    ['provider_accepted', 'Te llamo ahora.'],
    ['failed', 'Sí, la llamada ya quedó registrada.'],
    ['completed', 'Sí, la llamada ya quedó registrada.'],
    ['dispatch_ambiguous', 'Sí, la llamada ya quedó registrada.'],
  ])('rejects an unsupported confirmation with prior status %s: %s', async (status, message) => {
    const current = context();
    current.commercial_state.active_call = { call_id: '00000000-0000-4000-8000-0000000000c1', status };
    current.capabilities.may_request_call_now = false;
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: [message], call_offer: null } })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e8',
      repair: async () => { throw new Error('Unexpected repair'); },
    })).rejects.toThrow('UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation');
  });

  it.each([
    'No te preocupes, te llamo ahora.',
    'Te llamo ahora y podemos hablar del curso.',
    '¿Te parece bien? Te llamo ahora.',
    'Perfecto, te llamo ahora, ¿de acuerdo?',
    'Sí, la llamada ya quedó registrada, ¿te parece bien?',
  ])('rejects an unbacked call claim despite unrelated wording: %s', async message => {
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: [message], call_offer: null } })),
      context: context(), repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e5',
      repair: async () => { throw new Error('Unexpected repair'); },
    })).rejects.toThrow('UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation');
  });

  it.each([
    'Si estás disponible, te llamo.',
    'Si puedes atender, te llamo ahora.',
    'Te llamo si estás disponible.',
    'No te llamo hasta que me confirmes.',
    '¿Te llamo ahora?',
    '¿La llamada ya quedó registrada?',
  ])('preserves a conditional or negated call without inventing an action: %s', async message => {
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({ response: { messages: [message], call_offer: null } })),
      context: context(), repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e6',
      repair: async () => { throw new Error('Unexpected repair'); },
    });
    expect(result.effective.proposal.response.messages).toEqual([message]);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('preserves a natural missing-data request for an accepted call even when A classifies the noisy input as unknown', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'te paso mis datos?' }];
    current.customer.contact_intake = {
      nombre: null, apellido: null, correo: null, telefono: '+5491169004497',
    };
    current.commercial_state.call_preference = 'call';
    current.commercial_state.call_offer_status = 'accepted';
    current.commercial_state.awaiting_reply = 'contact_details';
    current.capabilities.intake_status = 'unknown';
    current.capabilities.intake_missing = ['nombre', 'apellido'];
    const message = 'Sí, pasame tu nombre y apellido y te llamo.';
    const initial = proposal({
      move: {
        schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages: [message], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    });

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(initial), context: current,
      repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e9',
      repair: async () => { throw new Error('Unexpected repair'); },
    });

    expect(result.effective.proposal.response.messages).toEqual([message]);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('still rejects the same call promise when no call collection is in progress', async () => {
    const current = context();
    current.capabilities.intake_status = 'unknown';
    current.capabilities.intake_missing = ['nombre', 'apellido'];
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: {
          schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: { messages: ['Pasame tu nombre y apellido y te llamo.'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [],
      })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000ea',
      repair: async () => { throw new Error('Unexpected repair'); },
    })).rejects.toThrow('UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation');
  });

  it.each(['none', 'unavailable'] as const)('repairs a call announcement with %s action in production advisory mode', async (actionCase) => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dale, llamame' }];
    current.commercial_state.call_preference = 'call';
    current.commercial_state.call_offer_status = 'accepted';
    current.capabilities.may_request_call_now = actionCase !== 'unavailable';
    const initial = proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Perfecto, te llamo ahora.'], call_offer: null },
      proposed_action: actionCase === 'none'
        ? { type: 'none' } : { type: 'request_call_now', reason: 'direct_request' },
      used_fact_ids: [],
    });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(initial), context: current, repair_enabled: true, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e1',
      repair: async rejection => generated({
        ...initial,
        response: { messages: ['Perfecto. Puedes atender ahora?'], call_offer: null },
        proposed_action: { type: 'none' },
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      }),
    });
    expect(result.effective.proposal.response.messages).toEqual(['Perfecto. Puedes atender ahora?']);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
  });

  it('does not carry a stale action rejection after Agent A repairs the prose and keeps an authorized call', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Me llamas? Soy Ana Costa.' }];
    current.customer.contact_intake = {
      nombre: 'Ana', apellido: 'Costa', correo: 'ana@example.test', telefono: '+15551234070',
    };
    current.commercial_state.call_preference = 'call';
    current.commercial_state.call_offer_status = 'accepted';
    const initial = proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Me falta tu teléfono para coordinar la llamada.'], call_offer: null },
      proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      profile_requests: [{ message_index: 0, fields: ['telefono'], purpose: 'call', mode: 'collect' }],
      used_fact_ids: [],
    });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(initial), context: current, repair_enabled: true, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e5',
      repair: async rejection => generated({
        ...initial,
        response: { messages: ['Gracias, Ana. Te llamo ahora.'], call_offer: null },
        profile_requests: [],
        repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      }),
    });

    expect(result.effective.proposal.proposed_action).toEqual({
      type: 'request_call_now', reason: 'direct_request',
    });
    expect(result.action_rejection).toBeNull();
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
  });

  it.each(['disabled', 'transport_failure', 'still_false'] as const)(
    'never publishes a false call announcement when repair is %s in advisory mode', async repairOutcome => {
      const current = context();
      current.turn.batch_messages = [{ id: 'm1', text: 'Dale, llamame' }];
      const initial = proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Perfecto, te llamo ahora.'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [],
      });
      await expect(resolveAgentAPlannerlessProposalV2({
        initial: generated(initial), context: current,
        repair_enabled: repairOutcome !== 'disabled', semantic_rejections: 'advisory',
        rejection_id: '00000000-0000-4000-8000-0000000000e2',
        repair: async rejection => {
          if (repairOutcome === 'transport_failure') throw new Error('BRAIN_DEEPSEEK_TIMEOUT');
          return generated({ ...initial, repair_of: { rejection_id: rejection.rejection_id, attempt: 1 } });
        },
      })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation');
    },
  );

  it('rejects a false dispatch claim in the separate call bubble in advisory mode', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dale, llamame' }];
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Claro.'], call_offer: 'Te llamo ahora.' },
        proposed_action: { type: 'none' }, used_fact_ids: [],
      })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e3',
      repair: async () => { throw new Error('Unexpected repair'); },
    })).rejects.toThrow('UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation');
  });

  it('keeps unrelated semantic guidance advisory during an authorized call', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Sí, llamame ahora' }];
    current.commercial_state.call_preference = 'call';
    current.commercial_state.call_offer_status = 'accepted';
    const messages = ['Perfecto, te llamo ahora.'];
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages, call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: ['offering:unknown:name:v1'],
      })),
      context: current, repair_enabled: false, semantic_rejections: 'advisory',
      rejection_id: '00000000-0000-4000-8000-0000000000e4',
      repair: async () => { throw new Error('Unexpected repair'); },
    });
    expect(result.effective.proposal.response.messages).toEqual(messages);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'request_call_now', reason: 'direct_request' });
    expect(result.evidence).toMatchObject({ repair_attempted: false, rejection_codes: ['FACT_NOT_AUTHORIZED'] });
  });

  it('repairs an empty delivery announcement even with advisory semantics', async () => {
    const current = context();
    const repair = vi.fn(async (rejection) => generated(proposal({
      response: { messages: ['No pude enviarte el enlace. Lo revisamos.'] },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
      used_fact_ids: [],
    })));
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Ahí va. El enlace es de Stripe.'] }, used_fact_ids: [],
      })), context: current, repair_enabled: true, semantic_rejections: 'advisory',
      rejection_id: '11111111-1111-4111-8111-111111111111', repair,
    });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal.response.messages.join(' ')).not.toContain('Ahí va');
  });
  it('keeps first-offer timing advisory and never inserts commercial copy', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm2', text: 'Mmm no lo sé' }];
    current.turn.recent_turns = [{
      id: 'prior-agent', direction: 'outbound',
      content: 'Hola, soy el asistente virtual de StudyX. Qué te gustaría aprender?',
    }];
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.capabilities.may_offer_call = true;
    const initial = generated(proposal({
      response: { messages: ['Puedo mostrarte algunas opciones para que elijas.'], call_offer: null },
    }));
    const repaired = generated(proposal({
      response: {
        messages: ['Puedo mostrarte algunas opciones para que elijas.'],
        call_offer: 'Si prefieres, puedo llamarte y orientarte por teléfono 🙂',
      },
      repair_of: { rejection_id: '00000000-0000-4000-8000-0000000000b1', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-0000000000b1',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.call_offer).toBeNull();
    expect(result.evidence).toMatchObject({ repair_attempted: false, repaired: false });
  });

  it('keeps a grounded English-level follow-up instead of showing a technical fallback', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm2', text: 'Contame' }];
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: 'Tenemos Inglés 1 e Inglés 2. Cuéntame qué nivel buscas.' }];
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.catalog.selected_offering = null;
    current.catalog.candidate_offerings = [
      {
        code: 'ingles-1', fact_id: ENGLISH_1_NAME_FACT, display_name: 'Inglés 1', area_code: 'idiomas',
        facts: [
          { id: ENGLISH_1_NAME_FACT, kind: 'offering_name', value: 'Inglés 1' },
          { id: 'offering:ingles-1:description:v1', kind: 'offering_description', value: 'Lectura de materiales teóricos aplicados en la práctica.' },
        ],
      },
      {
        code: 'ingles-2', fact_id: ENGLISH_2_NAME_FACT, display_name: 'Inglés 2', area_code: 'idiomas',
        facts: [
          { id: ENGLISH_2_NAME_FACT, kind: 'offering_name', value: 'Inglés 2' },
          { id: 'offering:ingles-2:description:v1', kind: 'offering_description', value: 'Aprenderás cómo entablar una conversación en inglés.' },
        ],
      },
    ];
    const response = [
      'Dale. En Inglés 1 se trabaja lectura y práctica; Inglés 2 aborda cómo entablar una conversación.',
      'Qué te gustaría poder hacer en inglés?',
    ];
    const repair = vi.fn();
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: response, call_offer: null },
        used_fact_ids: [ENGLISH_1_NAME_FACT, ENGLISH_2_NAME_FACT, 'offering:ingles-1:description:v1', 'offering:ingles-2:description:v1'],
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(response);
  });

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

  it('preserves both model-authored messages before an authorized call reminder', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Contame en detalle qué voy a aprender y cómo se cursa.';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.call_offer_count = 1;
    current.capabilities.may_offer_call = true;
    const messages: [string, string] = [
      `Primera parte. ${'a'.repeat(175)}`,
      `Segunda parte. ${'b'.repeat(175)} Tercera parte con el próximo paso elegido por DeepSeek.`,
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

  it('does not relocate or rewrite a model-authored CTA', async () => {
    const current = context();
    current.turn.recent_turns = [{
      id: 'prior-agent', direction: 'outbound',
      content: 'Hola, soy la asesora virtual de StudyX. Qué te gustaría aprender?',
    }];
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.capabilities.may_offer_call = true;
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        response: {
          messages: ['Tenemos cursos de oficios, marketing y diseño.'],
          call_offer: 'Cuéntame qué te gustaría aprender y te recomiendo una opción.',
        },
      })),
      context: current,
      repair_enabled: false,
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000b3',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual([
      'Tenemos cursos de oficios, marketing y diseño.',
    ]);
    expect(result.effective.proposal.response.call_offer)
      .toBe('Cuéntame qué te gustaría aprender y te recomiendo una opción.');
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

  it('records candidate comparison guidance without making a malformed repair block the reply', async () => {
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

    const repair = vi.fn(async () => {
      throw new AgentABrainError('BRAIN_INVALID_SCHEMA', null, 'move:invalid_type');
    });
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
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual([
      'Los dos sirven, pero uno apunta a campañas y el otro a manejar una comunidad.',
    ]);
    expect(result.evidence.rejection_codes).toEqual([
      'FACT_VALUE_MISMATCH',
      'COURSE_NOT_RESOLVED',
    ]);
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

  it('repairs an unavailable call once without replacing model-owned wording', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dsle llamame' }];
    current.capabilities.may_request_call_now = false;
    current.capabilities.intake_missing = ['telefono'];
    const initial = proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Coordino la llamada.'], call_offer: null },
      proposed_action: { type: 'request_call_now', reason: 'direct_request' },
    });
    const repair = vi.fn(async rejection => generated({ ...initial,
      response: { messages: ['A qué número con código de país y área puedo llamarte?'] },
      proposed_action: { type: 'none' as const },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    }));
    const result = await resolveAgentAPlannerlessProposalV2({ initial: generated(initial), context: current,
      repair_enabled: true, repair, rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal.response.messages).toEqual(['A qué número con código de país y área puedo llamarte?']);
    expect(result.effective.proposal.move.move).toBe('request_call');
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.action_rejection).toEqual({
      action: 'request_call_now',
      status: 'needs_input',
      code: 'ACTION_NOT_AUTHORIZED',
      codes: ['ACTION_NOT_AUTHORIZED'],
      missing_fields: ['telefono'],
      canonical_data: { offering_code: 'maquillaje-profesional', payment_plan: null },
      retryable: false,
    });
  });

  it('keeps the exact model-authored intake question when only the call action is unavailable', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dale, llamame' }];
    current.capabilities.may_request_call_now = false;
    current.capabilities.intake_missing = ['telefono'];
    const exactMessage = 'Dale, pásame tu número completo con código de país y área 🙂';
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages: [exactMessage], call_offer: null },
      proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      used_fact_ids: [],
    }));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: current,
      repair_enabled: true,
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
      rejection_id: '00000000-0000-4000-8000-0000000000c4',
    });

    expect(result.effective.proposal.response.messages).toEqual([exactMessage]);
    expect(result.effective.proposal.response.call_offer).toBeNull();
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.action_rejection).toMatchObject({
      action: 'request_call_now', missing_fields: ['telefono'],
    });
  });

  it('repairs a call acknowledgement that omitted the missing phone request', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Prefiero que me llames' }];
    current.capabilities.may_request_call_now = false;
    current.capabilities.intake_missing = ['telefono'];
    const initial = proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Claro, te llamo y te oriento con calma.'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    });
    const repair = vi.fn(async rejection => generated({
      ...initial,
      response: { messages: ['Dale, pásame tu número completo con código de país y área 🙂'], call_offer: null },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    }));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(initial),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
    expect(result.effective.proposal.response.messages).toEqual([
      'Dale, pásame tu número completo con código de país y área 🙂',
    ]);
  });

  it('repairs a requested call that omitted missing name and surname', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Dale, llamame' }];
    current.capabilities.may_request_call_now = false;
    current.capabilities.intake_missing = ['nombre', 'apellido'];
    const initial = proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Perfecto, te llamo ahora.'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    });
    const repair = vi.fn(async rejection => generated({
      ...initial,
      response: { messages: ['Antes de llamarte, dime tu nombre y apellido.'], call_offer: null },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    }));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(initial),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000c3',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal.response.messages).toEqual([
      'Antes de llamarte, dime tu nombre y apellido.',
    ]);
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
      rejection_codes: [], repair_attempted: false,
    });
  });

  it('repairs a duplicated call invitation without dropping useful course information', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.capabilities.may_offer_call = true;
    const initial = generated(proposal({
        response: {
          messages: [
            'Maquillaje Profesional tiene 38 clases.',
            'Si querés, podemos coordinar una llamada breve.',
          ],
          call_offer: 'Si querés, puedo llamarte para orientarte.',
        },
      }));
    const repair = vi.fn().mockResolvedValue(generated(proposal({
      response: {
        messages: ['Maquillaje Profesional tiene 38 clases.'],
        call_offer: 'Si querés, puedo llamarte para orientarte.',
      },
      repair_of: {
        rejection_id: '00000000-0000-4000-8000-000000000001',
        attempt: 1,
      },
    })));
    const result = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledOnce();
    expect(result.effective.proposal.response).toEqual({
      messages: ['Maquillaje Profesional tiene 38 clases.'],
      call_offer: 'Si querés, puedo llamarte para orientarte.',
    });
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: true });
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

  it('retains the model-authored repair of a repeated explanation and call offer', async () => {
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
    const repaired = generated(proposal({
      ...initial.proposal,
      response: { messages: ['Qué parte de la formación quieres conocer?'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000002', attempt: 1 },
    }));
    const repair = vi.fn(async () => repaired);

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000002',
    });

    expect(resolved.effective.proposal).toEqual(repaired.proposal);
    expect(resolved.effective.proposal.response).toEqual({
      messages: ['Qué parte de la formación quieres conocer?'], call_offer: null,
    });
    expect(resolved.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(resolved.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
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
      rejection_codes: [], repair_attempted: false, repaired: false,
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

  it('retains the model-authored replacement of a repeated prior question', async () => {
    const current = context();
    current.capabilities.may_offer_call = false;
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
    const repaired = generated(proposal({
      ...initial.proposal,
      response: { messages: ['Seguimos por chat. Qué te gustaría saber de la formación?'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn(async () => repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal).toEqual(repaired.proposal);
    expect(result.effective.proposal.response.messages).toEqual(['Seguimos por chat. Qué te gustaría saber de la formación?']);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'],
      repair_attempted: true, repaired: true,
      proposal_generation_calls: 2,
    });
  });

  it('accepts a progressive intake question when the customer supplied only one requested field', async () => {
    const current = context();
    current.capabilities.may_offer_call = false;
    current.capabilities.intake_missing = ['apellido', 'correo', 'telefono'];
    current.customer.contact_intake = {
      nombre: 'Inés', apellido: null, correo: null, telefono: null,
    };
    current.turn.batch_messages = [{ id: 'm2', text: 'Inés' }];
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: 'Para dejarlo registrado necesito tu nombre, apellido, correo electrónico y teléfono. ¿Me los pasás?',
    }];
    const messages = [
      '¡Gracias, Inés! Me falta tu apellido, tu correo electrónico y tu teléfono para dejarlo registrado. ¿Me los pasás?',
    ];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages, call_offer: null },
      profile_updates: [{
        field: 'nombre',
        value: 'Inés',
        operation: 'set',
        source_message_id: '00000000-0000-4000-8000-000000000002',
        source_quote: 'Inés',
      }],
      profile_requests: [{
        message_index: 0,
        fields: ['apellido', 'correo', 'telefono'],
        purpose: 'payment',
        mode: 'collect',
      }],
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(messages);
    expect(result.evidence).toMatchObject({
      rejection_codes: [], repair_attempted: false, proposal_generation_calls: 1,
    });
  });

  it('retains the model-authored replacement of a repeated greeting', async () => {
    const current = context();
    current.capabilities.may_offer_call = false;
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
    const repaired = generated(proposal({
      ...initial.proposal,
      response: { messages: ['Thiago, la formación tiene 38 clases y puedo orientarte con tus dudas.'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000003', attempt: 1 },
    }));
    const repair = vi.fn(async () => repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000003',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal).toEqual(repaired.proposal);
    expect(result.effective.proposal.response.messages).toEqual([
      'Thiago, la formación tiene 38 clases y puedo orientarte con tus dudas.',
    ]);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'],
      repair_attempted: true, repaired: true,
      proposal_generation_calls: 2,
    });
  });

  it('repairs the repeated greeting while keeping candidate wording as conversational guidance', async () => {
    const current = context();
    current.customer.display_name = 'Thiago';
    current.turn.batch_messages = [
      { id: 'm2', text: 'Buenas' },
      { id: 'm3', text: 'Me contás respecto a los cursos?' },
    ];
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: 'Hola, Thiago. Soy Emma, administrativa de StudyX.',
    }];
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
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
    const messages = [
      'Hola de nuevo, Thiago. Marketing Digital sirve para trabajar campañas y Community Manager para gestionar comunidades.',
      'Contame qué te gustaría lograr y te recomiendo por cuál empezar.',
    ];
    const repairedMessages = [
      'Podemos comparar Marketing Digital para trabajar campañas y Community Manager para gestionar comunidades.',
      'Contame qué te gustaría lograr y te recomiendo por cuál empezar.',
    ];
    const repaired = generated(proposal({
      move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9 },
      response: { messages: repairedMessages, call_offer: null },
      used_fact_ids: ['offering:marketing_digital:name:v1', 'offering:community_manager:name:v1'],
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000004', attempt: 1 },
    }));
    const repair = vi.fn(async () => repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: {
          schema_version: 1,
          move: 'browse_catalog',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.9,
        },
        response: { messages, call_offer: null },
        used_fact_ids: [
          'offering:marketing_digital:name:v1',
          'offering:community_manager:name:v1',
        ],
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000004',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal).toEqual(repaired.proposal);
    expect(result.effective.proposal.response.messages).toEqual(repairedMessages);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({
      rejection_codes: [
        'REPEATED_AGENT_REPLY',
        'FACT_VALUE_MISMATCH',
      ],
      repair_attempted: true, repaired: true,
      proposal_generation_calls: 2,
    });
  });

  it.each([
    {
      draft: '¡Perfecto, seguimos por acá sin problema! 😊 Para contarte bien cómo funciona el curso, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
      authored: 'Podemos seguir por chat. La formación tiene 38 clases; dime qué necesitas saber.',
    },
    {
      draft: 'De acuerdo, seguimos por escrito. La formación tiene 38 clases. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
      authored: 'Te explico por aquí: el programa completo tiene 38 clases.',
    },
  ])('retains the model-authored repair of a repeated question inside one compound message: $authored', async ({ draft, authored }) => {
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
    const repaired = generated(proposal({
      ...initial.proposal,
      response: { messages: [authored], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn(async () => repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal).toEqual(repaired.proposal);
    expect(result.effective.proposal.response.messages).toEqual([authored]);
    expect(result.effective.proposal.move).toEqual(initial.proposal.move);
    expect(result.effective.proposal.proposed_action).toEqual(initial.proposal.proposed_action);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['REPEATED_AGENT_REPLY'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
  });

  it('accepts an explicit canonical tool request alongside contact details without duplicating its move label', async () => {
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
    const repaired = generated(proposal({
      move: initial.proposal.move,
      response: initial.proposal.response,
      proposed_action: { type: 'none' },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({ repair_attempted: false, repaired: false, proposal_generation_calls: 1 });
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

  it('materializes the authorized payment action when the model requests the link but omits the redundant action field', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Está correcto, pásame el link';
    current.commercial_state.selected_payment_plan = 'monthly_6';
    current.commercial_state.awaiting_reply = 'contact_details';
    current.capabilities.may_send_payment_link = true;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['De acuerdo, te comparto el enlace seguro.'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual({
      type: 'send_payment_link',
      offering_code: 'maquillaje-profesional',
      payment_plan: 'monthly_6',
    });
  });

  it('requires the agent to ask for a payment plan when a link is requested without one', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Dale, mandame el link';
    current.commercial_state.selected_payment_plan = null;
    current.capabilities.may_send_payment_link = true;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages: ['Sí, claro.'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    }));
    const repair = vi.fn(async rejection => generated(proposal({
      move: {
        schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages: ['Prefieres 12 cuotas, 6 cuotas o un solo pago?'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
    })));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.evidence.rejection_codes).toContain('PLAN_NOT_SELECTED');
    expect(result.effective.proposal.response.messages).toEqual([
      'Prefieres 12 cuotas, 6 cuotas o un solo pago?',
    ]);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
  });

  it('preserves the original safe reply when payment-plan repair repeats the structural link request', async () => {
    const current = context();
    current.turn.batch_messages = [
      { id: 'm1', text: 'buenas' },
      { id: 'm2', text: 'me das el pago' },
      { id: 'm3', text: 'cual me recomendas entonces?' },
    ];
    current.commercial_state.selected_payment_plan = null;
    current.capabilities.may_send_payment_link = true;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: {
        messages: ['Por lo que me contás, primero comparemos las opciones y elegimos la que mejor te quede.'],
        call_offer: null,
      },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    }));
    const repair = vi.fn(async rejection => generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: {
        messages: ['Te recomiendo revisar primero las alternativas de pago para elegir bien.'],
        call_offer: null,
      },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
    })));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['PLAN_NOT_SELECTED'], repair_attempted: true, repaired: false,
    });
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
  });

  it('never synthesizes a call action when Agent A keeps the request conversational', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Che, me podes llamar?' }];
    current.commercial_state.call_preference = 'call';
    current.commercial_state.call_offer_status = 'accepted';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    current.capabilities.may_request_call_now = true;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages: ['Sí, claro.'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    }));

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true,
      repair: async () => { throw new Error('Unexpected repair'); },
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('keeps the production missing-identity call reply under advisory semantics', async () => {
    const current = context();
    current.turn.batch_messages = [
      { id: 'm1', text: 'buenas' },
      { id: 'm2', text: 'me podes llamar?' },
      { id: 'm3', text: 'entonces' },
    ];
    current.customer.contact_intake = {
      nombre: null, apellido: null, correo: null, telefono: '+5491169004497',
    };
    current.capabilities.intake_missing = ['nombre', 'apellido', 'correo'];
    current.capabilities.may_request_call_now = false;
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'offered';
    current.commercial_state.awaiting_reply = 'call_or_chat';
    current.catalog.selected_offering = null;
    const messages = [
      'Claro, te llamo. Para agendarla necesito tu nombre y apellido.',
    ];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1,
      },
      response: { messages, call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
    }));
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: false, semantic_rejections: 'advisory', repair,
      rejection_id: '00000000-0000-4000-8000-000000000449',
    });

    expect(result.effective).toBe(initial);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence.repair_attempted).toBe(false);
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs an unsolicited payment action instead of silently deleting it', async () => {
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
    const repaired = generated(proposal({
      move: initial.proposal.move,
      response: initial.proposal.response,
      proposed_action: { type: 'none' },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['ACTION_NOT_AUTHORIZED'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
  });

  it('repairs a premature payment action while contact intake is still incomplete', async () => {
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
    const repaired = generated(proposal({
      move: initial.proposal.move,
      response: initial.proposal.response,
      proposed_action: { type: 'none' },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['MISSING_INTAKE'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
  });

  it('repairs a premature temporary test-link action while contact intake is incomplete', async () => {
    const current = context();
    current.turn.batch_messages[0].text = 'Mandame el link de prueba de 0,50';
    current.commercial_state.awaiting_reply = 'contact_details';
    current.capabilities.intake_missing = ['correo'];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['Antes del link, ¿cuál es tu correo?'], call_offer: null },
      proposed_action: {
        type: 'send_test_payment_link', offering_code: 'maquillaje-profesional',
      },
      used_fact_ids: [],
    }));
    const repaired = generated(proposal({
      move: initial.proposal.move,
      response: initial.proposal.response,
      proposed_action: { type: 'none' },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['MISSING_INTAKE'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
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

  it('asks the model to choose a plan instead of authorizing a link from an invented same-turn plan', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm2', text: 'Buenas, me pasas el link de pago?' }];
    current.commercial_state.selected_payment_plan = null;
    current.commercial_state.awaiting_reply = 'call_or_chat';
    current.capabilities.may_send_payment_link = false;
    current.capabilities.authorized_payment_plan = null;
    current.capabilities.intake_missing = [];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
        payment_plan: 'one_time', confidence: 1,
      },
      response: { messages: ['Perfecto, te comparto el link de pago único.'], call_offer: null },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'maquillaje-profesional',
        payment_plan: 'one_time',
      },
      used_fact_ids: [],
    }));
    const repaired = generated(proposal({
      move: {
        schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
        confidence: 1,
      },
      response: { messages: ['Claro. Cuál de los tres planes prefieres?'], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
      repair_of: { rejection_id: '00000000-0000-4000-8000-0000000000f1', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: current, repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-0000000000f1',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(repaired);
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
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
describe('rechazo completo sin reescritura del backend', () => {
  const rejectedByPrice = () => generated(proposal({
    response: { messages: ['La formación sale USD 480.'], call_offer: null },
    used_fact_ids: [NAME_FACT],
  }));

  it('never replaces a valid DeepSeek conversation because semantic controls disagree with its wording', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm2', text: 'Hay descuento por comprar dos cursos?' }];
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.catalog.selected_offering = null;
    current.catalog.candidate_offerings = [
      {
        code: 'ingles-2', fact_id: ENGLISH_2_NAME_FACT, display_name: 'Inglés 2', area_code: 'idiomas',
      },
      {
        code: 'ingles-3', fact_id: ENGLISH_3_NAME_FACT, display_name: 'Inglés 3', area_code: 'idiomas',
      },
    ];
    const messages = [
      'Podés sumar Inglés 2 e Inglés 3. El total de cada curso es USD 360.',
      'Si querés, vemos cuál te conviene empezar primero.',
    ];
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages, call_offer: null },
        used_fact_ids: [ENGLISH_2_NAME_FACT, ENGLISH_3_NAME_FACT],
      })),
      context: current,
      repair_enabled: true,
      semantic_rejections: 'advisory',
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000d1',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(messages);
    expect(result.evidence.rejection_codes).not.toContain('FACT_VALUE_MISMATCH');
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.evidence).toMatchObject({ repair_attempted: false, proposal_generation_calls: 1 });
  });

  it('preserves the conversation and reports only the unavailable effect for the production double rejection', async () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'm2', text: 'Hay descuento por comprar dos cursos?' }];
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.catalog.selected_offering = null;
    current.capabilities.may_request_call_now = false;
    current.catalog.candidate_offerings = [{
      code: 'ingles-2', fact_id: ENGLISH_2_NAME_FACT, display_name: 'Inglés 2', area_code: 'idiomas',
    }];
    const messages = ['Podés sumar Inglés 2 y otro curso. Te ayudo a elegir el orden.'];
    const repair = vi.fn();

    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages, call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [ENGLISH_2_NAME_FACT],
      })),
      context: current,
      repair_enabled: true,
      semantic_rejections: 'advisory',
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000d2',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(messages);
    expect(result.action_rejection).toMatchObject({
      action: 'request_call_now',
      codes: ['ACTION_NOT_AUTHORIZED'],
    });
  });

  it('rechaza la propuesta intacta cuando la reparación está apagada', async () => {
    await expect(resolveAgentAPlannerlessProposalV2({
      initial: rejectedByPrice(), context: context(), repair_enabled: false,
      repair: vi.fn(), rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:price');
  });

  it('rechaza cuando la única reparación sigue siendo inválida', async () => {
    const repair = vi.fn().mockResolvedValue(generated(proposal({
      response: { messages: ['La formación sale USD 480.'], call_offer: null },
      used_fact_ids: [NAME_FACT],
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    })));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial: rejectedByPrice(), context: context(), repair_enabled: true,
      repair, rejection_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:price');

    expect(repair).toHaveBeenCalledTimes(1);
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

  it('rechaza el turno completo en vez de podar la afirmación falsa', async () => {
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

    await expect(resolveAgentAPlannerlessProposalV2({
      initial,
      context: contextoSinLink(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000aa',
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
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
describe('la conversación sobre candidatos no se confunde con autoridad comercial', () => {
  it('removes an unsupported candidate detail and a rejected call effect while preserving safe prose', async () => {
    const current = context();
    current.turn.batch_messages = [{
      id: 'm2',
      text: 'Estoy entre Fotografía Profesional e Inglés 1. Quiero que me llamen.',
    }];
    current.catalog.selected_offering = null;
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.capabilities.may_request_call_now = false;
    current.catalog.candidate_offerings = [{
      code: 'fotografia-profesional',
      fact_id: AVAILABLE_NAME_FACT,
      display_name: 'Fotografía Profesional',
      area_code: 'fotografia',
      facts: [{
        id: 'offering:fotografia-profesional:description:v1',
        kind: 'offering_description',
        value: 'Curso de fotografía con práctica y edición de imágenes.',
      }],
    }, {
      code: 'ingles-1',
      fact_id: ENGLISH_1_NAME_FACT,
      display_name: 'Inglés 1',
      area_code: 'idiomas',
      facts: [{
        id: 'offering:ingles-1:description:v1',
        kind: 'offering_description',
        value: 'Curso inicial de inglés con lectura y práctica.',
      }],
    }];

    const repair = vi.fn(async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: {
          schema_version: 1,
          move: 'browse_catalog',
          secondary_moves: ['request_call'],
          vetoes: [],
          confidence: 0.9,
        },
        response: {
          messages: [
            'Fotografía Profesional es ideal para empezar desde cero y editar imágenes.',
            'Pásame un número con código de país y coordinamos la llamada.',
          ],
          call_offer: null,
        },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [AVAILABLE_NAME_FACT, ENGLISH_1_NAME_FACT],
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000b5',
      semantic_rejections: 'advisory',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.effective.proposal.response.messages).toEqual([
      'Pásame un número con código de país y coordinamos la llamada.',
    ]);
    expect(result.action_rejection).toMatchObject({ action: 'request_call_now' });
  });

  it('keeps candidate guidance when the missing call offer is only advisory', async () => {
    const current = context();
    current.customer.display_name = 'Thiago';
    current.turn.batch_messages = [
      { id: 'm2', text: '¿Cómo funciona la llamada?' },
    ];
    current.turn.recent_turns = [{
      id: 'prior-agent',
      direction: 'outbound',
      content: 'Cuéntame qué curso te interesa y te asesoro.',
    }];
    current.catalog.selected_offering = null;
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.catalog.candidate_offerings = [
      {
        code: 'fotografia-profesional',
        fact_id: AVAILABLE_NAME_FACT,
        display_name: 'Fotografía Profesional',
        area_code: 'fotografia',
      },
      {
        code: 'ingles-1',
        fact_id: ENGLISH_1_NAME_FACT,
        display_name: 'Inglés 1',
        area_code: 'idiomas',
      },
    ];
    current.capabilities.may_offer_call = true;

    const repair = vi.fn(async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: generated(proposal({
        move: {
          schema_version: 1,
          move: 'browse_catalog',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.9,
        },
        response: {
          messages: [
            'La llamada es breve y sirve para orientarte según lo que buscas.',
            'Fotografía Profesional es ideal para empezar desde cero y editar imágenes.',
          ],
          call_offer: null,
        },
        used_fact_ids: [AVAILABLE_NAME_FACT, ENGLISH_1_NAME_FACT],
      })),
      context: current,
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-0000000000b4',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual([
      'La llamada es breve y sirve para orientarte según lo que buscas.',
      'Fotografía Profesional es ideal para empezar desde cero y editar imágenes.',
    ]);
  });

  it('keeps the catalog explanation and list in the model-authored form', async () => {
    const current = context();
    current.turn.batch_messages = [
      { id: 'm2', text: 'Me gustaría Photoshop, pero no estoy seguro' },
    ];
    current.catalog.selected_offering = null;
    current.commercial_state.selected_offering_code = null;
    current.commercial_state.stage = 'exploring';
    current.catalog.candidate_offerings = [
      {
        code: 'photoshop', fact_id: 'offering:photoshop:name:v1',
        display_name: 'Diseño Gráfico con Photoshop', area_code: 'diseno',
      },
      {
        code: 'illustrator', fact_id: 'offering:illustrator:name:v1',
        display_name: 'Diseño Gráfico con Illustrator', area_code: 'diseno',
      },
    ];
    const initial = generated(proposal({
      move: {
        schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9,
      },
      response: {
        messages: [
          'Diseño Gráfico con Photoshop es ideal para empezar desde cero y editar imágenes.',
          'Te puedo ofrecer:\n- Diseño Gráfico con Photoshop\n- Diseño Gráfico con Illustrator\n¿Cuál te interesa más?',
        ],
        call_offer: null,
      },
      used_fact_ids: [
        'offering:photoshop:name:v1',
        'offering:illustrator:name:v1',
      ],
    }));

    const repair = vi.fn(async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); });
    const result = await resolveAgentAPlannerlessProposalV2({
      initial,
      context: current,
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000b2',
      repair,
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.response.messages).toEqual(initial.proposal.response.messages);
  });

  it('rechaza la respuesta completa sin quitar una oración', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'Para arrancar no necesitás experiencia previa ni conocimientos de maquillaje.',
          'La formación tiene 38 clases.',
        ],
        call_offer: null,
      },
    }));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ac',
      repair: vi.fn(),
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
  });

  it('rejects an unsupported prerequisite clause without altering it', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'Inglés 1 es el punto de partida para quienes no tienen conocimientos previos.',
        ],
        call_offer: null,
      },
    }));

    await expect(resolveAgentAPlannerlessProposalV2({
      initial,
      context: context(),
      repair_enabled: true,
      rejection_id: '00000000-0000-4000-8000-0000000000ae',
      repair: async () => { throw new Error('BRAIN_DEEPSEEK_TIMEOUT'); },
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
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

describe('flexibilidad de cursada sin respaldo se devuelve al agente', () => {
  it('rechaza sin podar cuando la reparación repite la inferencia', async () => {
    const initial = generated(proposal({
      response: {
        messages: [
          'La formación tiene 38 clases.',
          'Al ser online, podés avanzar a tu ritmo desde donde estés. ¿Querés conocer el contenido?',
        ],
        call_offer: null,
      },
    }));

    await expect(resolveAgentAPlannerlessProposalV2({
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
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
  });
});

it.each(['narrative', 'dedicated'] as const)('repairs a third invitation in %s without backend-authored copy', async location => {
  const current = context();
  current.commercial_state.call_offer_count = 2;
  current.capabilities.may_offer_call = false;
  const invitation = 'Si quieres, puedo llamarte para orientarte.';
  const initial = generated(proposal({ response: location === 'narrative'
    ? { messages: ['La formación tiene 38 clases. '+invitation] }
    : { messages: ['La formación tiene 38 clases.'], call_offer: invitation } }));
  const repair = vi.fn(async rejection => generated(proposal({
    response: { messages: ['La formación tiene 38 clases.'] },
    repair_of: { rejection_id: rejection.rejection_id, attempt: 1 },
  })));
  const result = await resolveAgentAPlannerlessProposalV2({ initial, context: current,
    repair_enabled: true, repair, rejection_id: '00000000-0000-4000-8000-000000000001' });
  expect(repair).toHaveBeenCalledOnce();
  expect(result.effective.proposal.response.messages).toEqual(['La formación tiene 38 clases.']);
  expect(result.evidence.rejection_codes).toContain('CALL_BUDGET_EXHAUSTED');
});

it('does not downgrade an unrepaired third invitation into advisory guidance', async () => {
  const current = context();
  current.commercial_state.call_offer_count = 2;
  current.capabilities.may_offer_call = false;
  const value = proposal({ response: { messages: ['La formación tiene 38 clases.'],
    call_offer: 'Si quieres, puedo llamarte para orientarte.' } });
  await expect(resolveAgentAPlannerlessProposalV2({ initial: generated(value), context: current,
    repair_enabled: true,
    repair: async rejection => generated({ ...value, repair_of: { rejection_id: rejection.rejection_id, attempt: 1 } }),
    rejection_id: '00000000-0000-4000-8000-000000000001',
  })).rejects.toThrow('CALL_BUDGET_EXHAUSTED');
});
