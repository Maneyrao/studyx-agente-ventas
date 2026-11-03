import { describe, expect, it, vi } from 'vitest';
import {
  derivePromotionContextRepairPlanV1,
  deriveCourseBonusCapabilityV1,
  readCourseBonusCapabilityV1,
  deriveDirectCourseBonusCapabilityV1,
} from '@/features/promotions/application/read-course-bonus-capability';
import type { DbClient } from '@/lib/db/types';
import {
  isCentralCargaBonusEnabledForContact,
  loadCentralCargaBonusConfig,
} from '@/features/fulfillment/central-carga/config';

const promotion = {
  promotion_code: 'ingles_1_mas_ingles_2',
  paid_offering_code: 'ingles_1',
  channels: ['text', 'voice'] as const,
  active: true,
  valid_from: null,
  valid_until: null,
  bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
};

const activeCourses = [
  { code: 'ingles_1', display_name: 'Inglés 1' }, { code: 'ingles_2', display_name: 'Inglés 2' },
  { code: 'ingles_3', display_name: 'Inglés 3' }, { code: 'oratoria', display_name: 'Oratoria' },
  { code: 'estrategias_emprender', display_name: 'Estrategias para Emprender' },
];

describe('direct capability', () => {
  it('projects disabled rollout with the configured direct limit without reading customer data', async () => {
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','false');vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS','');
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');vi.stubEnv('COURSE_BONUS_MAX_COURSES','2');
    try {
      expect(await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:'disabled',conversation_id:'unused',
        channel:'text',selected_offering_code:'ingles_1'},{db:(()=>{throw new Error('MUST_NOT_QUERY');}) as unknown as DbClient}))
        .toMatchObject({enabled:false,max_bonus_courses:2});
    } finally { vi.unstubAllEnvs(); }
  });
  it('does not authorize accepting or extending an expired direct offer', () => {
    expect(deriveDirectCourseBonusCapabilityV1({interest_offering_code:'ingles_1',max_bonus_courses:2,
      active_courses:activeCourses,package:{promotion_code:'p',promotion_cycle_id:'cycle',offer_version:1,status:'offered',
        expires_at:'2000-01-01T00:00:00.000Z',courses:promotion.bonus_offerings,delivered:true,later_reply:true}}))
      .toMatchObject({may_offer_bonus:false,may_accept_offer:false});
  });
  it('exposes the bonus set as structure; the price/retention evidence is validated per proposal', () => {
    const input = { interest_offering_code: 'ingles_1', max_bonus_courses: 2 as const, package: null, active_courses: activeCourses };
    const open = deriveDirectCourseBonusCapabilityV1(input);
    expect(open).toMatchObject({ enabled: true, max_bonus_courses: 2, may_offer_bonus: true, may_request_review: false, offer_version: 0 });
    // Affinity row + universal bridges, never the paid course; the model chooses.
    expect(open.bonus_candidates?.map(course => course.code)).toEqual(['ingles_2', 'ingles_3', 'estrategias_emprender']);
    expect(open.bonus_candidates?.map(course => course.code)).not.toContain('oratoria');
    expect(deriveDirectCourseBonusCapabilityV1({ ...input, named_codes: ['oratoria'] }).bonus_candidates?.map(course => course.code))
      .toContain('oratoria');
    expect(deriveDirectCourseBonusCapabilityV1({ ...input, active_courses: [activeCourses[0]!] })).toMatchObject({ may_offer_bonus: false, bonus_candidates: [] });
    expect(deriveDirectCourseBonusCapabilityV1({ ...input,
      package: { promotion_code: 'p', promotion_cycle_id: 'cycle', offer_version: 1,
        status: 'offered', courses: promotion.bonus_offerings, delivered: false, later_reply: false } }))
      .toMatchObject({ promotion_code: 'p', promotion_cycle_id: 'cycle', offer_version: 1,
        bonus_offerings: promotion.bonus_offerings, delivered_bonus_offerings: [],
        may_offer_bonus: false, may_accept_offer: false });
  });
  it('allows a next bonus only after the previous one was delivered and answered, never past the limit, and drops what is already in the package', () => {
    const base = { interest_offering_code: 'ingles_1', max_bonus_courses: 2 as const, active_courses: activeCourses };
    const offered = { promotion_code: 'p', promotion_cycle_id: 'cycle', offer_version: 1, status: 'offered' as const,
      courses: promotion.bonus_offerings, delivered: true, later_reply: true };
    const next = deriveDirectCourseBonusCapabilityV1({ ...base, package: offered });
    expect(next.may_offer_bonus).toBe(true);
    expect(next.bonus_candidates?.map(course => course.code)).not.toContain('ingles_2');
    expect(deriveDirectCourseBonusCapabilityV1({ ...base, package: { ...offered, later_reply: false } }).may_offer_bonus).toBe(false);
    expect(deriveDirectCourseBonusCapabilityV1({ ...base, max_bonus_courses: 2, package: { ...offered, offer_version: 2,
      courses: [...promotion.bonus_offerings, { code: 'ingles_3', display_name: 'Inglés 3', position: 2 }] } }).may_offer_bonus).toBe(false);
    expect(deriveDirectCourseBonusCapabilityV1({ ...base, package: { ...offered, status: 'accepted' as const } }).may_offer_bonus).toBe(false);
  });
  it('a literal swap of the single offered bonus is exposed as the only rule_bonus', () => {
    const offered = { promotion_code: 'p', promotion_cycle_id: 'cycle', offer_version: 1, status: 'offered' as const,
      courses: promotion.bonus_offerings, delivered: true, later_reply: true };
    expect(deriveDirectCourseBonusCapabilityV1({ interest_offering_code: 'ingles_1', max_bonus_courses: 1, active_courses: activeCourses,
      package: offered, customer_request: { kind: 'swap', replaced_offering_code: 'ingles_2', bonus_offering_code: 'oratoria' } }).rule_bonus)
      .toMatchObject({ bonus_offering_code: 'oratoria', source: 'customer_request', replaces_offering_code: 'ingles_2' });
    expect(deriveDirectCourseBonusCapabilityV1({ interest_offering_code: 'ingles_1', max_bonus_courses: 1, active_courses: activeCourses,
      package: offered }).rule_bonus).toBeNull();
  });
});

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
  it('reconstructs a capped idempotent count from accepted structured evidence', () => {
    const input = {
      workspace_id: '00000000-0000-4000-8000-000000000001',
      conversation_id: '00000000-0000-4000-8000-000000000002',
      contact_id: '00000000-0000-4000-8000-000000000003',
      interest_offering_code: 'fotografia_profesional',
      existing: {
        interest_offering_code: 'fotografia_profesional',
        price_objection_count: 1,
        source_turn_id: '00000000-0000-4000-8000-000000000011',
      },
      accepted_price_objection_turn_ids: [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000011',
      ],
      active_offer_status: null,
    } as const;

    const first = derivePromotionContextRepairPlanV1(input);
    expect(first).toMatchObject({
      previous_price_objection_count: 1,
      proposed_price_objection_count: 2,
      evidence_source_turn_ids: [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ],
      protected_offer: false,
    });
    expect(derivePromotionContextRepairPlanV1({
      ...input,
      existing: {
        ...input.existing,
        price_objection_count: first.proposed_price_objection_count,
      },
    }).proposed_price_objection_count).toBe(2);
  });

  it('does not reuse objections after a course change or mutate accepted packages', () => {
    expect(() => derivePromotionContextRepairPlanV1({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      conversation_id: '00000000-0000-4000-8000-000000000002',
      contact_id: '00000000-0000-4000-8000-000000000003',
      interest_offering_code: 'marketing_digital',
      existing: {
        interest_offering_code: 'fotografia_profesional',
        price_objection_count: 2,
        source_turn_id: '00000000-0000-4000-8000-000000000010',
      },
      accepted_price_objection_turn_ids: ['00000000-0000-4000-8000-000000000010'],
      active_offer_status: null,
    })).toThrow('PROMOTION_CONTEXT_COURSE_MISMATCH');

    expect(derivePromotionContextRepairPlanV1({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      conversation_id: '00000000-0000-4000-8000-000000000002',
      contact_id: '00000000-0000-4000-8000-000000000003',
      interest_offering_code: 'fotografia_profesional',
      existing: {
        interest_offering_code: 'fotografia_profesional',
        price_objection_count: 1,
        source_turn_id: '00000000-0000-4000-8000-000000000010',
      },
      accepted_price_objection_turn_ids: [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ],
      active_offer_status: 'attached',
    })).toMatchObject({
      protected_offer: true,
      previous_price_objection_count: 1,
      proposed_price_objection_count: 1,
    });
  });

  it('enables a promotion only for the exact canary contact while the global flag is off', () => {
    const canary = '00000000-0000-4000-8000-000000000001';
    const config = loadCentralCargaBonusConfig({
      CENTRAL_CARGA_BONUS_ENABLED: 'false',
      CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED: 'true',
      CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS: ` ${canary},00000000-0000-4000-8000-000000000002 `,
    });

    expect(isCentralCargaBonusEnabledForContact(config, canary)).toBe(true);
    expect(isCentralCargaBonusEnabledForContact(config, '00000000-0000-4000-8000-000000000003')).toBe(false);
  });

  it('reads the promotion capability for the exact canary contact while the global flag is off', async () => {
    const canary = '00000000-0000-4000-8000-000000000001';
    const priorEnabled = process.env.CENTRAL_CARGA_BONUS_ENABLED;
    const priorCanaries = process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
    process.env.CENTRAL_CARGA_BONUS_ENABLED = 'false';
    process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = canary;
    let queryCount = 0;
    const db = (async () => {
      queryCount += 1;
      if (queryCount === 1) return [{ interest_offering_code: 'ingles_1', price_objection_count: 1 }];
      return [{
        promotion_code: 'ingles_1_mas_ingles_2',
        paid_offering_code: 'ingles_1',
        channels: ['text'],
        active: true,
        valid_from: null,
        valid_until: null,
        bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
        offer_status: null,
        offer_promotion_code: null,
        offer_expires_at: null,
        prior_price_objection_checkin: false,
      }];
    }) as unknown as DbClient;

    try {
      await expect(readCourseBonusCapabilityV1({
        workspace_slug: 'studyx',
        contact_id: canary,
        conversation_id: '00000000-0000-4000-8000-000000000002',
        channel: 'text',
        selected_offering_code: null,
      }, { db })).resolves.toMatchObject({
        status: 'review_available',
        may_request_review: true,
        interest_offering_code: 'ingles_1',
      });
      expect(queryCount).toBe(2);
    } finally {
      if (priorEnabled === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
      else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorEnabled;
      if (priorCanaries === undefined) delete process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
      else process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = priorCanaries;
    }
  });

  it('keeps a delivered offer bound to its paid course when the bonus is discussed later', async () => {
    const canary = '00000000-0000-4000-8000-000000000001';
    const priorEnabled = process.env.CENTRAL_CARGA_BONUS_ENABLED;
    const priorCanaries = process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
    process.env.CENTRAL_CARGA_BONUS_ENABLED = 'false';
    process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = canary;
    let queryCount = 0;
    let capabilitySql = '';
    const db = (async (strings: TemplateStringsArray) => {
      queryCount += 1;
      if (queryCount === 1) return [{ interest_offering_code: 'excel_integral', price_objection_count: 0 }];
      capabilitySql = strings.join('?');
      return [{
        promotion_code: 'redes_con_excel',
        paid_offering_code: 'redes_informaticas',
        channels: ['text'],
        active: true,
        valid_from: null,
        valid_until: null,
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
        offer_status: 'offered',
        offer_promotion_code: 'redes_con_excel',
        offer_expires_at: null,
        prior_price_objection_checkin: true,
      }];
    }) as unknown as DbClient;

    try {
      await expect(readCourseBonusCapabilityV1({
        workspace_slug: 'studyx',
        contact_id: canary,
        conversation_id: '00000000-0000-4000-8000-000000000002',
        channel: 'text',
        selected_offering_code: null,
      }, { db })).resolves.toMatchObject({
        status: 'offer_available',
        may_accept_offer: true,
        interest_offering_code: 'redes_informaticas',
        promotion_code: 'redes_con_excel',
      });
      expect(capabilitySql).toContain("candidate.status IN ('pending_review','offered','accepted')");
      expect(capabilitySql).toContain('candidate.payment_id IS NULL');
      expect(capabilitySql).toContain('related_bonus.offering_code_snapshot');
      expect(capabilitySql).toContain('po.created_at DESC NULLS LAST');
    } finally {
      if (priorEnabled === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
      else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorEnabled;
      if (priorCanaries === undefined) delete process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
      else process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = priorCanaries;
    }
  });

  it('checks for existing direct obligations but hides new capability while the Central v2 flag is disabled', async () => {
    const prior = process.env.CENTRAL_CARGA_BONUS_ENABLED;
    delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
    let queried = false;
    const db = (() => {
      queried = true;
      return [];
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
      expect(queried).toBe(true);
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

  it('allows Agent A to choose one different active course when no fixed promotion exists', () => {
    expect(capability({
      promotion: null,
      recorded_price_objections: 1,
      allows_any_active_bonus: true,
    })).toMatchObject({
      status: 'review_available',
      may_request_review: true,
      bonus_selection_mode: 'any_active_course',
      interest_offering_code: 'ingles_1',
      promotion_code: null,
      bonus_offerings: [],
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
