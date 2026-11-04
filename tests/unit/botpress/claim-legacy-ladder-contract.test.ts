import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema,
  CourseBonusLadderV1Schema,
} from '../../../botpress-agent/src/schemas/agent-a-brain';
import { ClaimResponseSchema, ClaimedTurnSchema } from '../../../botpress-agent/src/schemas/contracts';

const claimCapability = ClaimedTurnSchema.shape.course_bonus_capability;
const paid = 'introduccion_ecommerce';
const legacyLadder = {
  eligible: false,
  observed_price_objection_count: 2,
  required_price_objection_count: 3,
  call_invitation_status: 'not_offered',
  call_offer_count: 0,
  may_offer_call: true,
  missing_steps: ['recorded_price_objections', 'call_invitation'],
};

function capability(ladder: unknown, overrides: Record<string, unknown> = {}) {
  return {
    status: 'not_eligible', enabled: true, may_offer_bonus: false,
    max_bonus_courses: 3, may_schedule_checkin: false, may_request_review: false,
    may_accept_offer: false, may_send_promoted_payment: false,
    promotion_code: null, interest_offering_code: paid, bonus_offerings: [],
    ladder, ...overrides,
  };
}

function contextWithCapability(courseBonus: unknown) {
  return {
    schema_version: 1, identity: null,
    turn: { batch_messages: [{ id: 'current', text: 'Me sigue pareciendo caro.' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    commercial_state: { selected_offering_code: paid, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false },
    catalog: { selected_offering: null, available_offerings: [], candidate_offerings: [],
      areas: [], payment_plans: [] },
    capabilities: { may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: false, may_send_payment_link: false,
      authorized_payment_plan: null, intake_status: 'unknown', intake_missing: [],
      course_bonus: courseBonus },
  };
}

const canonical = { eligible: false, price_evidence: false, retention_decline: false, retention_used: false,
  missing_steps: ['price_evidence'] };

describe('claim-only legacy bonus ladder compatibility', () => {
  it('decodes the raw claim response and remains canonical on the workflow second parse', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const now = '2026-11-02T15:00:00.000Z';
    const raw = {
      outcome: 'claimed', trace_id: id, turn_id: id,
      batch: { id, claim_token: id, conversation_id: id, contact_id: id,
        lease_until: now, hard_deadline_at: now, message_count: 1, stolen: false },
      policy: { may_respond: true, allowed_response_types: ['commercial_reply'], reason: null },
      contact: { id, status: 'prospecto', name: null, blocked: false,
        consent_status: 'allowed', opted_in_at: now },
      context: { batch_messages: [], recent_turns: [], summary: { text: null, version: 0, updated_at: null },
        selected_memories: [], long_term_memory_available: false,
        knowledge_base: [], knowledge_base_available: false },
      sales_context: { mode: 'advising', course_of_interest: null, open_call_offer: null,
        active_call: null, allowed_actions: [], last_call_result: null },
      course_bonus_capability: capability(legacyLadder),
    };
    const decoded = ClaimResponseSchema.parse(raw);
    expect(decoded.outcome).toBe('claimed');
    if (decoded.outcome !== 'claimed') throw new Error('CLAIM_FIXTURE_NOT_CLAIMED');
    expect(decoded.course_bonus_capability?.ladder).toEqual({ ...canonical, eligible: true, price_evidence: true, missing_steps: [] });
    expect(ClaimedTurnSchema.parse(decoded)).toEqual(decoded);
    expect(raw.course_bonus_capability.ladder).toEqual(legacyLadder);
  });

  it('passes the canonical ladder and all existing capability values through unchanged', () => {
    const ladder = { ...canonical, eligible: true, price_evidence: true, missing_steps: [] };
    const input = capability(ladder, { enabled: false, may_offer_bonus: false,
      rule_bonus: { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce',
        bonus_offering_code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 } });
    const before = structuredClone(input);
    expect(claimCapability.parse(input)).toEqual(input);
    expect(input).toEqual(before);
  });

  it('maps a legacy count to price evidence only; thresholds, call fields and instant triggers grant nothing', () => {
    expect(claimCapability.parse(capability({ ...legacyLadder, observed_price_objection_count: 0, eligible: true,
      instant_trigger: true }))?.ladder).toEqual(canonical);
    expect(claimCapability.parse(capability({ ...legacyLadder, observed_price_objection_count: 1,
      required_price_objection_count: 2 }))?.ladder).toEqual({ ...canonical, eligible: true, price_evidence: true, missing_steps: [] });
    expect(claimCapability.parse(capability({ ...legacyLadder, observed_price_objection_count: 0,
      price_only_barrier_confirmed: true }))?.ladder).toMatchObject({ eligible: true, price_evidence: true });
  });

  it.each([false, true])('never changes enabled=%s or a denied bonus permission and cannot invent candidates', enabled => {
    const decoded = claimCapability.parse(capability(legacyLadder, { enabled }));
    expect(decoded).toMatchObject({ enabled, may_offer_bonus: false });
    expect(decoded).not.toHaveProperty('rule_bonus');
    expect(decoded).not.toHaveProperty('bonus_candidates');
    expect(AgentAContextV1Schema.safeParse(contextWithCapability(decoded)).success).toBe(true);
  });

  it('preserves a supplied permission and rule_bonus instead of manufacturing either during normalization', () => {
    const rule = { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce',
      bonus_offering_code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 };
    expect(claimCapability.parse(capability(legacyLadder, {
      enabled: true, may_offer_bonus: true, rule_bonus: rule,
    }))).toMatchObject({ enabled: true, may_offer_bonus: true, rule_bonus: rule });
  });

  it('rejects threshold 4 rather than interpreting another business rule', () => {
    expect(claimCapability.safeParse(capability({ ...legacyLadder, required_price_objection_count: 4 })).success).toBe(false);
  });

  it.each([
    { observed_price_objection_count: -1 },
    { observed_price_objection_count: 1.5 },
    { call_offer_count: -1 },
    { call_invitation_status: 'unavailable' },
    { missing_steps: ['sales_copy'] },
    { prescribed_response: 'texto fijo' },
    { may_offer_bonus: true },
  ])('rejects malformed or extended legacy ladders: %j', invalid => {
    expect(claimCapability.safeParse(capability({ ...legacyLadder, ...invalid })).success).toBe(false);
  });

  it('keeps the legacy ladder forbidden at the canonical brain boundary', () => {
    expect(CourseBonusLadderV1Schema.safeParse(legacyLadder).success).toBe(false);
    expect(AgentAContextV1Schema.safeParse(contextWithCapability(capability(legacyLadder))).success).toBe(false);
    expect(AgentAContextV1Schema.safeParse(contextWithCapability(claimCapability.parse(capability(legacyLadder)))).success).toBe(true);
  });
});

describe('H4: claim parsing tolerates the pre-model-owned sales_flow shape', () => {
  it('accepts price_probe / gift_request_pending_probe in the claim', () => {
    const parsed = claimCapability.parse(capability(undefined, {
      sales_flow: { price_probe: 'asked', retention_used: false, promo_expires_at: null, gift_request_pending_probe: null },
    }));
    expect(parsed?.sales_flow).toMatchObject({ retention_used: false, promo_expires_at: null });
  });
  it('still rejects unknown sales_flow keys', () => {
    expect(() => claimCapability.parse(capability(undefined, {
      sales_flow: { retention_used: false, promo_expires_at: null, surprise: 1 } }))).toThrow();
  });
});
