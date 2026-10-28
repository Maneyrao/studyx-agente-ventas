import { z } from 'zod';

/**
 * Wire contract with the Central de Carga
 * (docs/contracts/central-de-carga-enrollment.md §3.2 and §3.4).
 */

export const EnrollmentRequestV1 = z.object({
  schema_version: z.literal(1),
  payment_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  environment: z.enum(['test', 'live']),
  student: z.object({
    full_name: z.string().trim().min(1).max(200),
    email: z.string().email(),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  }),
  offering: z.object({
    code: z.string().min(1),
    display_name: z.string().min(1),
  }),
  payment: z.object({
    plan_code: z.enum(['monthly_12', 'monthly_6', 'one_time']).nullable(),
    amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    provider: z.literal('stripe'),
    provider_session_id: z.string().min(1),
    paid_at: z.string().datetime(),
  }),
});
export type EnrollmentRequestV1 = z.infer<typeof EnrollmentRequestV1>;

export const EnrollmentRequestV2 = EnrollmentRequestV1.extend({
  schema_version: z.literal(2),
  bonus_offerings: z.array(z.object({
    code: z.string().min(1),
    display_name: z.string().min(1),
    promotion_code: z.string().min(1).max(64),
  })).min(1).max(3),
  retry_offering_codes: z.array(z.string().min(1)).min(1).max(4).optional(),
}).superRefine((request, context) => {
  const codes = request.bonus_offerings.map((offering) => offering.code);
  if (new Set(codes).size !== codes.length || codes.includes(request.offering.code)) {
    context.addIssue({
      code: 'custom',
      path: ['bonus_offerings'],
      message: 'bonus codes must be unique and different from offering.code',
    });
  }
  const retry = request.retry_offering_codes;
  if (retry && (new Set(retry).size !== retry.length
    || retry.some((code) => ![request.offering.code, ...codes].includes(code)))) {
    context.addIssue({ code: 'custom', path: ['retry_offering_codes'], message: 'retry must be a unique expected subset' });
  }
});
export type EnrollmentRequestV2 = z.infer<typeof EnrollmentRequestV2>;
export type EnrollmentRequest = EnrollmentRequestV1 | EnrollmentRequestV2;

export const EnrollmentResponseV1 = z.object({
  payment_id: z.string().uuid(),
  enrollment_id: z.string().min(1),
  student_id: z.string().min(1),
  enrollment_status: z.enum(['active', 'already_enrolled', 'processing']),
  student_was_created: z.boolean(),
  access: z.object({
    login_email: z.string().min(1),
    welcome_sent: z.boolean(),
    login_url: z.string().url().refine(value => new URL(value).protocol === 'https:').optional(),
  }),
  created_at: z.string().datetime().optional(),
});
export type EnrollmentResponseV1 = z.infer<typeof EnrollmentResponseV1>;

export const EnrollmentResponseV2 = EnrollmentResponseV1.extend({
  supports_partial_recovery: z.boolean().optional(),
  bonus_enrollments: z.array(z.object({
    offering_code: z.string().min(1),
    enrollment_status: z.enum(['active', 'already_enrolled', 'processing', 'failed']),
  })).min(1).max(3),
});
export type EnrollmentResponseV2 = z.infer<typeof EnrollmentResponseV2>;
export type EnrollmentResponse = EnrollmentResponseV1 | EnrollmentResponseV2;

/** Everything the worker reads from PostgreSQL to build one request. */
export interface EnrollmentSource {
  payment_id: string;
  workspace_id: string;
  contact_id: string;
  environment: string;
  provider: string;
  provider_session_id: string | null;
  paid_at: Date | null;
  amount: string;
  currency: string;
  plan_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string;
  contact_declared_phone: string | null;
  offering_code: string | null;
  offering_display_name: string | null;
  bonus_offerings: Array<{
    code: string;
    display_name: string;
    promotion_code: string;
    position: number;
  }>;
}

/** numeric(14,2) text -> the contract's exactly-two-decimals string. */
export function formatAmount(raw: string): string {
  const trimmed = raw.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return trimmed;
  const decimals = (match[2] ?? '').padEnd(2, '0').slice(0, 2);
  return `${match[1]}.${decimals}`;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Builds and validates the POST body. Returns the parse result so the caller
 * can dead-letter without ever calling the Central on invalid data. Issue
 * paths are safe to log; values (PII) are never exposed.
 */
export function buildEnrollmentRequest(source: EnrollmentSource) {
  const base = {
    payment_id: source.payment_id,
    workspace_id: source.workspace_id,
    contact_id: source.contact_id,
    environment: source.environment,
    student: {
      full_name: present(source.contact_name),
      email: present(source.contact_email)?.toLowerCase(),
      phone: present(source.contact_declared_phone) ?? source.contact_phone,
    },
    offering: {
      code: present(source.offering_code),
      display_name: present(source.offering_display_name),
    },
    payment: {
      plan_code: source.plan_code,
      amount: formatAmount(source.amount),
      currency: source.currency,
      provider: source.provider,
      provider_session_id: source.provider_session_id,
      paid_at: source.paid_at?.toISOString(),
    },
  };
  if (source.bonus_offerings.length === 0) {
    return EnrollmentRequestV1.safeParse({ schema_version: 1, ...base });
  }
  const bonusOfferings = [...source.bonus_offerings]
    .sort((left, right) => left.position - right.position)
    .map(({ code, display_name, promotion_code }) => ({ code, display_name, promotion_code }));
  return EnrollmentRequestV2.safeParse({
    schema_version: 2,
    ...base,
    bonus_offerings: bonusOfferings,
  });
}

/** Paths of a failed parse, e.g. `student.phone`. Never includes values. */
export function issuePaths(error: z.ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.path.join('.')))].join(',');
}
