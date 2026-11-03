import { bindCustomerCallInterpretationV1 } from '../../../botpress-agent/src/lib/conversation/customer-call-interpretation';
import { continueAgentAAfterActionFeedbackV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { TurnRejectionV1 } from '../../../botpress-agent/src/schemas/turn-rejection';
import { describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import type { GeneratedAgentATurnProposalV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { preserveRuleTriggerEvidenceV1 } from '../../../botpress-agent/src/lib/conversation/preserve-bonus-evidence';

const paid = 'introduccion_ecommerce';
const rejectionId = '00000000-0000-4000-8000-000000000010';

function context(call = false): AgentAContextV1 {
  return {
    schema_version: 1, identity: null,
    turn: { batch_messages: [{ id: 'current', text: 'me sigue pareciendo caro' }],
      recent_turns: call ? [{ id: 'previous', direction: 'outbound', content: 'Contame qué buscás.' }] : [] },
    customer: { display_name: null, memories: [] },
    commercial_state: { selected_offering_code: paid, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false },
    catalog: { selected_offering: { code: paid, display_name: 'Introducción al Ecommerce',
      area_code: 'marketing', facts: [{ id: `offering:${paid}:name:v1`, kind: 'offering_name', value: 'Introducción al Ecommerce' }] },
      available_offerings: [
        { code: paid, display_name: 'Introducción al Ecommerce', area_code: 'marketing', fact_id: `offering:${paid}:name:v1` },
      ], candidate_offerings: [], areas: [], payment_plans: [] },
    capabilities: { may_reply: true, may_offer_call: call, may_request_call_now: false,
      may_present_payment_options: false, may_send_payment_link: false, authorized_payment_plan: null,
      intake_status: 'unknown', intake_missing: [] },
  };
}

function draft(overrides: Partial<AgentATurnProposalV1> = {}): GeneratedAgentATurnProposalV1 {
  return { provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    proposal: { schema_version: 1,
      move: { schema_version: 1, move: 'ask_course_information', course_reference: paid,
        secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Te cuento las opciones.'], call_offer: null },
      proposed_action: { type: 'none' }, course_mentions: [], confirmed_phone: null,
      profile_updates: [], profile_requests: [], used_fact_ids: [], used_memory_ids: [], repair_of: null,
      memory_candidates: [],
      ...overrides } };
}

describe('call correction after a rejected action (consent stays with the customer)', () => {
  it('permits a model correction unknown → request_call grounded in the current explicit request, leaving backend permissions intact', async () => {
    const current = context(true);
    current.turn.batch_messages = [{ id: 'current', text: 'Por favor llamame ahora' }];
    current.capabilities.may_request_call_now = true;
    current.capabilities.intake_status = 'known';
    const initial = draft({ memory_candidates: [] });
    initial.proposal.move.move = 'unknown';
    const corrected = draft({ memory_candidates: [], proposed_action: { type: 'request_call_now', reason: 'direct_request' } });
    corrected.proposal.move.move = 'request_call';
    const repair = vi.fn(async () => corrected);
    const rejection: TurnRejectionV1 = { schema_version: 1, rejection_id: rejectionId, attempt: 1,
      rejections: [{ code: 'ACTION_NOT_AUTHORIZED', subject: 'request_call_now' }],
      authorized_alternatives: { actions: ['none', 'request_call_now'], fact_ids: [], missing_information: [] } };
    const continued = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      customer_call_interpretation: initial.proposal.move, effects_allowed: true,
      apiKey: 'fixture', signal: new AbortController().signal, model: 'deepseek-v4-flash', generate: repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(continued.proposal.move.move).toBe('request_call');
    const bound = bindCustomerCallInterpretationV1(initial.proposal.move, continued.proposal, current);
    const authorize = (allowed: boolean) => authorizeAgentTurnV2({ proposal: bound,
      state: { ...createDefaultConversationStateV1({ workspace_id: rejectionId, conversation_id: rejectionId, contact_id: rejectionId }),
        selected_offering_code: paid, stage: 'course_selected' },
      offerings: [{ code: paid, display_name: 'Introducción al Ecommerce' }], facts: [],
      current_customer_messages: ['Por favor llamame ahora'],
      contact_intake: { nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.com', telefono: '+5491112345678' },
      call_policy: { may_offer_call: true, may_request_call_now: allowed } });
    expect(authorize(true)).toMatchObject({ ok: true, action: { type: 'request_call_now' } });
    expect(authorize(false)).toMatchObject({ ok: false });
    expect(continued.proposal.response.call_offer).toBeNull();
  });
});

describe('evidence preserved across the bounded rewrite', () => {
  const batch = ['Me sigue pareciendo caro. No gracias.'];
  const memory = (key: string, type: 'objection' | 'constraint', source_quote: string) => ({ type, key, value: 'x', source_quote, confidence: 1 });
  it('keeps the quoted price objection, price-only barrier and purchase decline the rewrite dropped', () => {
    const original = draft({ memory_candidates: [memory('price_objection', 'objection', 'caro'),
      memory('price_only_barrier', 'constraint', 'caro'), memory('purchase_decline', 'objection', 'No gracias')] }).proposal;
    const kept = preserveRuleTriggerEvidenceV1(original, draft().proposal, batch);
    expect(kept.memory_candidates.map(candidate => candidate.key)).toEqual(['price_objection', 'price_only_barrier', 'purchase_decline']);
  });
  it('never preserves a quote that is not literal customer text', () => {
    const original = draft({ memory_candidates: [memory('price_objection', 'objection', 'carísimo'),
      memory('purchase_decline', 'objection', 'no quiero')] }).proposal;
    expect(preserveRuleTriggerEvidenceV1(original, draft().proposal, batch).memory_candidates).toEqual([]);
  });
  it('does not duplicate what the rewrite already carries', () => {
    const original = draft({ memory_candidates: [memory('purchase_decline', 'objection', 'No gracias')] }).proposal;
    expect(preserveRuleTriggerEvidenceV1(original, original, batch).memory_candidates).toHaveLength(1);
  });
});
