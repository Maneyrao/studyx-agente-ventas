import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema,
  CourseBonusLadderV1Schema,
} from '../../../botpress-agent/src/schemas/agent-a-brain';
import { ClaimedTurnSchema } from '../../../botpress-agent/src/schemas/contracts';

const capability = {
  status: 'not_eligible',
  may_schedule_checkin: false,
  may_request_review: false,
  may_accept_offer: false,
  may_send_promoted_payment: false,
  promotion_code: null,
  bonus_offerings: [],
};

describe('Botpress course bonus permission contract', () => {
  it.each([
    { retention_used: false, previous_turn_asked_price_question: false },
    { retention_used: true, previous_turn_asked_price_question: true },
  ])('preserves shared committed facts at both strict boundaries (%j)', ladder => {
    expect(CourseBonusLadderV1Schema.parse(ladder)).toEqual(ladder);
    for (const schema of [
      ClaimedTurnSchema.shape.course_bonus_capability,
      AgentAContextV1Schema.shape.capabilities.shape.course_bonus,
    ]) {
      expect(schema.parse({ ...capability, ladder })).toEqual({ ...capability, ladder });
      expect(schema.parse(capability)).toEqual(capability);
    }
  });

  it('carries the bonus candidates and the retention state without prescribing wording', () => {
    const extra = { bonus_candidates: [{ code: 'oratoria', display_name: 'Oratoria' }],
      sales_flow: { retention_used: false, promo_expires_at: null } };
    for (const schema of [
      ClaimedTurnSchema.shape.course_bonus_capability,
      AgentAContextV1Schema.shape.capabilities.shape.course_bonus,
    ]) expect(schema.parse({ ...capability, ...extra })).toEqual({ ...capability, ...extra });
  });

  it('rejects malformed ladder facts instead of silently dropping them', () => {
    const ladder = { retention_used: false, previous_turn_asked_price_question: false };
    for (const invalid of [
      { required_price_objection_count: 2 },
      { instant_trigger: true },
      { retention_used: 'yes' },
      { price_evidence: true },
      { missing_steps: ['sales_copy'] },
      { prescribed_response: 'texto fijo' },
    ]) expect(CourseBonusLadderV1Schema.safeParse({ ...ladder, ...invalid }).success).toBe(false);
  });
});
