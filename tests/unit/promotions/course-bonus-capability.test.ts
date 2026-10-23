import { describe, expect, it } from 'vitest';
import {
  deriveCourseBonusCapabilityV1,
  readCourseBonusCapabilityV1,
} from '@/features/promotions/application/read-course-bonus-capability';
import type { DbClient } from '@/lib/db/types';

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
    discussed_offering_code: null,
    recorded_price_objections: 0,
    prior_price_objection_checkin: false,
    promotion,
    active_offer: null,
    now: new Date('2026-10-23T12:00:00Z'),
    ...overrides,
  });
}

describe('course bonus capability', () => {
  it('hides the entire capability while the Central v2 feature flag is disabled', async () => {
    const prior = process.env.CENTRAL_CARGA_BONUS_ENABLED;
    delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
    let queried = false;
    const db = (() => {
      queried = true;
      throw new Error('database must not be queried while disabled');
    }) as unknown as DbClient;
    try {
      await expect(readCourseBonusCapabilityV1({
        workspace_slug: 'studyx',
        contact_id: '00000000-0000-0000-0000-000000000001',
        conversation_id: '00000000-0000-0000-0000-000000000002',
        channel: 'text',
        selected_offering_code: 'ingles_1',
      }, { db })).resolves.toMatchObject({
        status: 'unavailable',
        may_request_review: false,
        may_send_promoted_payment: false,
      });
      expect(queried).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
      else process.env.CENTRAL_CARGA_BONUS_ENABLED = prior;
    }
  });

  it('lets Agent A classify the first objection without revealing or reviewing a gift', () => {
    expect(capability()).toEqual({
      status: 'checkin_available',
      may_schedule_checkin: true,
      may_request_review: false,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      bonus_offerings: [],
      interest_offering_code: 'ingles_1',
    });
  });

  it('allows review after the model recorded one price objection without requiring a scheduled check-in', () => {
    expect(capability({ recorded_price_objections: 1 })).toMatchObject({
      status: 'review_available', may_request_review: true, promotion_code: null, bonus_offerings: [],
    });
    expect(capability({
      selected_offering_code: null,
      discussed_offering_code: 'ingles_1',
      recorded_price_objections: 1,
    })).toMatchObject({
      status: 'review_available', may_request_review: true, interest_offering_code: 'ingles_1',
    });
  });

  it('does not reinterpret customer wording with backend regexes', () => {
    expect(capability({ prior_price_objection_checkin: false })).toMatchObject({
      status: 'checkin_available', may_request_review: false,
    });
    expect(capability({ prior_price_objection_checkin: true })).toMatchObject({
      status: 'review_available', may_request_review: true,
    });
  });

  it('exposes course names only after an authorized offer was delivered', () => {
    expect(capability({
      prior_price_objection_checkin: true,
      active_offer: { status: 'pending_review', promotion_code: promotion.promotion_code, expires_at: null },
    })).toMatchObject({ status: 'review_pending', promotion_code: null, bonus_offerings: [] });
    expect(capability({
      prior_price_objection_checkin: true,
      active_offer: { status: 'offered', promotion_code: promotion.promotion_code, expires_at: null },
    })).toMatchObject({
      status: 'offer_available', may_accept_offer: true,
      promotion_code: promotion.promotion_code,
      bonus_offerings: promotion.bonus_offerings,
    });
  });

  it('authorizes promoted payment only for an accepted, unexpired delivered offer', () => {
    expect(capability({
      prior_price_objection_checkin: true,
      active_offer: { status: 'accepted', promotion_code: promotion.promotion_code, expires_at: '2026-10-24T00:00:00Z' },
    })).toMatchObject({ status: 'accepted', may_send_promoted_payment: true });
    expect(capability({
      prior_price_objection_checkin: true,
      active_offer: { status: 'accepted', promotion_code: promotion.promotion_code, expires_at: '2026-10-23T11:59:59Z' },
    })).toMatchObject({ status: 'not_eligible', may_send_promoted_payment: false });
  });

  it('fails closed for inactive, invalid-channel or mismatched-course rules', () => {
    expect(capability({ promotion: { ...promotion, active: false } }).status).toBe('unavailable');
    expect(capability({ channel: 'voice', promotion: { ...promotion, channels: ['text'] } }).status).toBe('unavailable');
    expect(capability({ selected_offering_code: 'ingles_3' }).status).toBe('unavailable');
  });
});
