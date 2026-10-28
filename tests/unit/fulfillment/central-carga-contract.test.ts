import { describe, expect, it } from 'vitest';
import { classifyResponse } from '@/features/fulfillment/central-carga/client';
import {
  buildEnrollmentRequest,
  EnrollmentRequestV2,
  type EnrollmentSource,
} from '@/features/fulfillment/central-carga/contract';

const PAYMENT_ID = '6f1c2a9e-4b7d-4c1e-9a55-0d3e8b2f71aa';

function source(overrides: Partial<EnrollmentSource> = {}): EnrollmentSource {
  return {
    payment_id: PAYMENT_ID,
    workspace_id: '0b8d5a5e-1f3c-4d0a-8d6b-2f1d0c9a7e11',
    contact_id: 'c41e3b2a-6d5f-4e8a-9b7c-1a2b3c4d5e6f',
    environment: 'live',
    provider: 'stripe',
    provider_session_id: 'cs_live_abc',
    paid_at: new Date('2026-10-06T14:03:12Z'),
    amount: '360.00',
    currency: 'USD',
    plan_code: 'monthly_12',
    contact_name: 'María Pérez',
    contact_email: 'maria@example.com',
    contact_phone: '+5491155550000',
    contact_declared_phone: null,
    offering_code: 'ingles_1',
    offering_display_name: 'Inglés 1',
    bonus_offerings: [],
    ...overrides,
  };
}

const response = (overrides: Record<string, unknown> = {}) => ({
  payment_id: PAYMENT_ID,
  enrollment_id: 'enr_paid',
  student_id: 'stu_1',
  enrollment_status: 'active',
  student_was_created: true,
  access: { login_email: 'maria@example.com', welcome_sent: true },
  created_at: '2026-10-06T14:03:15Z',
  ...overrides,
});

describe('Central v1/v2 course enrollment contract', () => {
  it('rejects recovery codes that are empty, duplicated or outside the immutable package', () => {
    const request=buildEnrollmentRequest(source({bonus_offerings:[{code:'a',display_name:'A',promotion_code:'p',position:1}]}));
    if (!request.success) throw new Error('fixture');
    for (const retry_offering_codes of [[],['a','a'],['other']]) {
      expect(EnrollmentRequestV2.safeParse({...request.data,retry_offering_codes}).success).toBe(false);
    }
    expect(EnrollmentRequestV2.safeParse({...request.data,retry_offering_codes:['a']}).success).toBe(true);
  });
  it('keeps schema v1 byte-shape compatible when the payment has no bonus snapshot', () => {
    const parsed = buildEnrollmentRequest(source());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.schema_version).toBe(1);
    expect(parsed.data).not.toHaveProperty('bonus_offerings');
  });

  it('builds schema v2 only from the frozen snapshots in deterministic position order', () => {
    const parsed = buildEnrollmentRequest(source({
      bonus_offerings: [
        { code: 'marketing', display_name: 'Marketing Digital', promotion_code: 'combo_ingles', position: 2 },
        { code: 'ingles_2', display_name: 'Inglés 2', promotion_code: 'combo_ingles', position: 1 },
      ],
    }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      schema_version: 2,
      bonus_offerings: [
        { code: 'ingles_2', display_name: 'Inglés 2', promotion_code: 'combo_ingles' },
        { code: 'marketing', display_name: 'Marketing Digital', promotion_code: 'combo_ingles' },
      ],
    });
  });

  it('rejects duplicate bonus codes and a bonus equal to the paid course', () => {
    const bonus = { code: 'ingles_2', display_name: 'Inglés 2', promotion_code: 'combo', position: 1 };
    expect(buildEnrollmentRequest(source({ bonus_offerings: [bonus, { ...bonus, position: 2 }] })).success).toBe(false);
    expect(buildEnrollmentRequest(source({ bonus_offerings: [{ ...bonus, code: 'ingles_1' }] })).success).toBe(false);
  });

  it('accepts v2 success only for the exact requested set once and active', () => {
    const expectedBonusCodes = ['ingles_2', 'marketing'];
    const validBonuses = [
      { offering_code: 'ingles_2', enrollment_status: 'active' },
      { offering_code: 'marketing', enrollment_status: 'active' },
    ];
    const valid = response({ bonus_enrollments: validBonuses });
    expect(classifyResponse({ method: 'POST', status: 201, bodyText: JSON.stringify(valid),
      paymentId: PAYMENT_ID, expectedBonusCodes }).kind).toBe('success');

    for (const bonus_enrollments of [
      [{ offering_code: 'ingles_2', enrollment_status: 'active' }],
      [...validBonuses, { offering_code: 'otro', enrollment_status: 'active' }],
      [{ offering_code: 'ingles_2', enrollment_status: 'active' }, { offering_code: 'ingles_2', enrollment_status: 'active' }],
    ]) {
      expect(classifyResponse({ method: 'POST', status: 201,
        bodyText: JSON.stringify(response({ bonus_enrollments })), paymentId: PAYMENT_ID, expectedBonusCodes }))
        .toEqual({ kind: 'retry', code: 'invalid_bonus_response' });
    }
  });

  it('keeps a v2 202 in processing until the exact final set exists', () => {
    expect(classifyResponse({ method: 'GET', status: 202,
      bodyText: JSON.stringify(response({ enrollment_status: 'processing' })),
      paymentId: PAYMENT_ID, expectedBonusCodes: ['ingles_2'] })).toEqual({ kind: 'processing' });
  });

  it.each(['processing', 'active'] as const)('keeps HTTP 202 waiting even with valid v2 %s evidence', (enrollment_status) => {
    expect(classifyResponse({ method: 'GET', status: 202, paymentId: PAYMENT_ID,
      expectedBonusCodes: ['a'], bodyText: JSON.stringify(response({ enrollment_status,
        supports_partial_recovery: true, bonus_enrollments: [{ offering_code: 'a', enrollment_status: 'active' }],
      })) })).toEqual({ kind: 'processing' });
  });

  it('retains verified items from a valid partial result without declaring success', () => {
    expect(classifyResponse({ method: 'POST', status: 200, paymentId: PAYMENT_ID,
      expectedBonusCodes: ['a', 'b', 'c'], bodyText: JSON.stringify(response({
        supports_partial_recovery: true,
        bonus_enrollments: ['a', 'b', 'c'].map((offering_code) => ({ offering_code,
          enrollment_status: offering_code === 'c' ? 'failed' : 'active' })),
      })) })).toMatchObject({ kind: 'partial', body: { supports_partial_recovery: true,
      bonus_enrollments: [{ offering_code: 'a' }, { offering_code: 'b' }, { offering_code: 'c' }] } });
  });
});
