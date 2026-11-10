import { describe, expect, it } from 'vitest';
import { validateBonusMotiveV1 } from '@/shared/conversation/bonus-motive';

// Owner 2026-11-10: the promotion follows the main course; the customer is asked
// whether to keep the same gift or choose another, with no new motive needed.
const base = { moves: ['price_objection'], batch: ['¿me dejás el mismo?'], retention_used: false,
  purchase_decline_recorded: false, previous_turn_asked_price_question: false };

describe('bonus motive with a carried-over promotion', () => {
  it('accepts the first gift of the new main course without a new motive', () => {
    expect(validateBonusMotiveV1({ ...base, motive: { kind: 'price_objection', quote: '¿me dejás el mismo?' },
      has_delivered_bonus: false, promotion_carried_over: true })).toBeNull();
    expect(validateBonusMotiveV1({ ...base, motive: undefined, has_delivered_bonus: false,
      promotion_carried_over: true })).toBeNull();
  });
  it('without carry-over the same question is not a motive', () => {
    expect(validateBonusMotiveV1({ ...base, motive: { kind: 'price_objection', quote: '¿me dejás el mismo?' },
      has_delivered_bonus: false })).not.toBeNull();
  });
  it('a later gift of the new package needs its own motive again', () => {
    expect(validateBonusMotiveV1({ ...base, motive: { kind: 'price_objection', quote: '¿me dejás el mismo?' },
      has_delivered_bonus: true, promotion_carried_over: true })).not.toBeNull();
  });
});
