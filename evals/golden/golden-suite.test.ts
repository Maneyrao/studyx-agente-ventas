import { describe, expect, it } from 'vitest';

import { GOLDEN_BASE_SHA, GOLDEN_CASES, validateGoldenAuthorityReferences } from './scenarios';

const REQUIRED_CASE_IDS = [
  '01_first_contact_identity',
  '02_info_discovery',
  '03_single_course_recommendation',
  '04_price_value_objection',
  '05_real_budget_limit',
  '06_repeated_price_bonus_ladder',
  '07_think_it_over_not_closed',
  '08_consult_partner',
  '09_definitive_no',
  '10_requested_call',
  '11_purchase_to_payment_link',
  '12_verified_payment_bonus_fulfillment',
  '13_real_syllabus',
  '14_course_change_cancels_promotion',
  '15_purchase_signal_executes',
  '16_discount_limit_stays_commercial',
] as const;

describe('Agent A authority-only golden specification', () => {
  it('pins the requested base and defines every required case exactly once', () => {
    expect(GOLDEN_BASE_SHA).toBe('028f272fc3a6f6dc4806d19b251564169b55e6d6');
    expect(GOLDEN_CASES.map((item) => item.id)).toEqual(REQUIRED_CASE_IDS);
    expect(new Set(GOLDEN_CASES.map((item) => item.id)).size).toBe(16);
  });

  it('makes every turn measurable instead of relying on an ideal written answer', async () => {
    for (const scenario of GOLDEN_CASES) {
      expect(scenario.turns.length, `${scenario.id}: debe ser multiturno`).toBeGreaterThanOrEqual(2);
      for (const turn of scenario.turns) {
        expect(turn.customer.trim(), `${scenario.id}/${turn.id}`).not.toBe('');
        expect(turn.must.length, `${scenario.id}/${turn.id}: must`).toBeGreaterThan(0);
        expect(turn.mustNot.length, `${scenario.id}/${turn.id}: mustNot`).toBeGreaterThan(0);
        expect(turn.authority.length, `${scenario.id}/${turn.id}: authority`).toBeGreaterThan(0);
        expect(turn.expected.move.length, `${scenario.id}/${turn.id}: move`).toBeGreaterThan(0);
        expect(turn.expected.action.length, `${scenario.id}/${turn.id}: action`).toBeGreaterThan(0);
        expect(turn.expected.state).toHaveProperty('stage');
        expect(turn.expected.state).toHaveProperty('awaitingReply');
        expect(turn.expected.state).toHaveProperty('plan');
        expect(turn.expected.state).toHaveProperty('promotion');
      }
    }
    await expect(validateGoldenAuthorityReferences()).resolves.toEqual([]);
  });
});
