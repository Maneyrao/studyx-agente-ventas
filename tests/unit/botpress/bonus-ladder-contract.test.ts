import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema,
  CourseBonusLadderV1Schema,
} from '../../../botpress-agent/src/schemas/agent-a-brain';
import { ClaimedTurnSchema } from '../../../botpress-agent/src/schemas/contracts';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';

const capability = {
  status: 'not_eligible',
  may_schedule_checkin: false,
  may_request_review: false,
  may_accept_offer: false,
  may_send_promoted_payment: false,
  promotion_code: null,
  bonus_offerings: [],
};

describe('Botpress course bonus ladder contract', () => {
  it.each([0, 2, 3])('preserves shared committed facts at both strict boundaries (%i objections)', count => {
    // Rule 10, authority prompt:106-120: transport facts, not prescribed wording.
    const ladder = deriveCourseBonusLadderV1({
      observed_price_objection_count: count,
      call_invitation_status: 'not_offered',
      call_offer_count: 0,
      may_offer_call: true,
    });
    expect(CourseBonusLadderV1Schema.parse(ladder)).toEqual(ladder);
    for (const schema of [
      ClaimedTurnSchema.shape.course_bonus_capability,
      AgentAContextV1Schema.shape.capabilities.shape.course_bonus,
    ]) {
      expect(schema.parse({ ...capability, ladder })).toEqual({ ...capability, ladder });
      expect(schema.parse(capability)).toEqual(capability);
    }
  });

  it('rejects malformed ladder facts instead of silently dropping them', () => {
    const ladder = deriveCourseBonusLadderV1({
      observed_price_objection_count: 3, call_invitation_status: 'declined',
      call_offer_count: 1, may_offer_call: false,
    });
    for (const invalid of [
      { required_price_objection_count: 2 },
      { observed_price_objection_count: -1 },
      { observed_price_objection_count: 1.5 },
      { call_offer_count: -1 },
      { call_invitation_status: 'unavailable' },
      { missing_steps: ['sales_copy'] },
      { prescribed_response: 'texto fijo' },
    ]) expect(CourseBonusLadderV1Schema.safeParse({ ...ladder, ...invalid }).success).toBe(false);
  });
});
