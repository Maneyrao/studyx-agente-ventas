import { describe, expect, it } from 'vitest';
import {
  countPriceObjectionInterventionsV1,
  deriveCourseBonusCapabilityV1,
} from '@/features/promotions/application/read-course-bonus-capability';

const promotion = {
  promotion_code: 'ingles_1_mas_ingles_2',
  paid_offering_code: 'ingles_1',
  channels: ['text', 'voice'] as const,
  active: true,
  valid_from: null,
  valid_until: null,
  bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
};

function capability(overrides: Record<string, unknown> = {}) {
  return deriveCourseBonusCapabilityV1({
    channel: 'text',
    selected_offering_code: 'ingles_1',
    price_objection_interventions: 0,
    promotion,
    active_offer: null,
    now: new Date('2026-10-23T12:00:00Z'),
    ...overrides,
  });
}

describe('course bonus capability', () => {
  it('counts split messages as one semantic price-objection intervention', () => {
    expect(countPriceObjectionInterventionsV1([
      ['mmm', 'me sigue pareciendo caro', 'vale la pena?'],
      ['sigue fuera de mi presupuesto'],
      ['cuánto cuesta?'],
    ])).toBe(2);
  });

  it('does not reveal or review a gift on a price question or first objection', () => {
    expect(capability()).toMatchObject({ status: 'not_eligible', may_request_review: false });
    expect(capability({ price_objection_interventions: 1 })).toEqual({
      status: 'checkin_available',
      may_schedule_checkin: true,
      may_request_review: false,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      bonus_offerings: [],
    });
  });

  it('allows review only after persistent resistance with exact course interest', () => {
    expect(capability({ price_objection_interventions: 2 })).toMatchObject({
      status: 'review_available', may_request_review: true, promotion_code: null, bonus_offerings: [],
    });
    expect(capability({ selected_offering_code: null, price_objection_interventions: 3 })).toMatchObject({
      status: 'needs_interest', may_request_review: false,
    });
  });

  it('exposes course names only after an authorized offer was delivered', () => {
    expect(capability({
      price_objection_interventions: 2,
      active_offer: { status: 'pending_review', promotion_code: promotion.promotion_code, expires_at: null },
    })).toMatchObject({ status: 'review_pending', promotion_code: null, bonus_offerings: [] });
    expect(capability({
      price_objection_interventions: 2,
      active_offer: { status: 'offered', promotion_code: promotion.promotion_code, expires_at: null },
    })).toMatchObject({
      status: 'offer_available', may_accept_offer: true,
      promotion_code: promotion.promotion_code,
      bonus_offerings: promotion.bonus_offerings,
    });
  });

  it('authorizes promoted payment only for an accepted, unexpired delivered offer', () => {
    expect(capability({
      price_objection_interventions: 2,
      active_offer: { status: 'accepted', promotion_code: promotion.promotion_code, expires_at: '2026-10-24T00:00:00Z' },
    })).toMatchObject({ status: 'accepted', may_send_promoted_payment: true });
    expect(capability({
      price_objection_interventions: 2,
      active_offer: { status: 'accepted', promotion_code: promotion.promotion_code, expires_at: '2026-10-23T11:59:59Z' },
    })).toMatchObject({ status: 'not_eligible', may_send_promoted_payment: false });
  });

  it('fails closed for inactive, invalid-channel or mismatched-course rules', () => {
    expect(capability({ promotion: { ...promotion, active: false } }).status).toBe('unavailable');
    expect(capability({ channel: 'voice', promotion: { ...promotion, channels: ['text'] } }).status).toBe('unavailable');
    expect(capability({ selected_offering_code: 'ingles_3' }).status).toBe('unavailable');
  });
});
