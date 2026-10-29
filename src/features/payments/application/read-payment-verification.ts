import { sql as defaultSql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { PaymentPlanCode } from '../domain/payment-link';

export const PAYMENT_VERIFICATION_STATUSES = [
  'reserved',
  'creating_checkout',
  'creation_ambiguous',
  'pending',
  'paid',
  'failed',
  'expired',
  'refunded',
] as const;

export type PaymentVerificationStatus = typeof PAYMENT_VERIFICATION_STATUSES[number];

export const ACCESS_MESSAGE_STATUSES = [
  'pending',
  'dispatched',
  'processing',
  'sent',
  'ambiguous',
  'dead_letter',
  'cancelled',
] as const;

export type AccessMessageStatus = typeof ACCESS_MESSAGE_STATUSES[number];

export interface PaymentFulfillmentV1 {
  readonly enrollment_status: 'active' | 'already_enrolled';
  readonly access_message_status: AccessMessageStatus | null;
  readonly access_sent_at: string | null;
}

export interface PaymentVerificationV1 {
  readonly status: PaymentVerificationStatus;
  readonly offering_code: string;
  readonly plan_code: PaymentPlanCode | null;
  readonly paid_at: string | null;
  readonly fulfillment?: PaymentFulfillmentV1 | null;
}

/**
 * Latest canonical Stripe attempt for one workspace/contact.
 *
 * The signed webhook is the only writer that can move the row to `paid`.
 * Reading this projection never trusts a customer message, screenshot or
 * model claim, and scoping by workspace prevents a global contact from
 * leaking payment state across tenants.
 */
export async function loadLatestPaymentVerificationV1(input: {
  readonly workspace_slug: string;
  readonly contact_id: string;
  readonly offering_code?: string | null;
  readonly plan_code?: PaymentPlanCode | null;
}, db: DbClient = defaultSql): Promise<PaymentVerificationV1 | null> {
  const environment = process.env.PAYMENT_LINK_ENVIRONMENT ?? null;
  const rows = await db<Array<{
    status: PaymentVerificationStatus;
    offering_code: string;
    plan_code: PaymentPlanCode | null;
    paid_at: Date | string | null;
    enrollment_status: PaymentFulfillmentV1['enrollment_status'] | null;
    access_message_status: AccessMessageStatus | null;
    access_sent_at: Date | string | null;
  }>>`
    SELECT payment.status, offering.code AS offering_code,
           payment.plan_code, payment.paid_at,
           enrollment.enrollment_status,
           access_notification.status AS access_message_status,
           access_notification.sent_at AS access_sent_at
    FROM payments AS payment
    JOIN workspaces AS workspace
      ON workspace.id = payment.workspace_id
     AND workspace.slug = ${input.workspace_slug}
     AND workspace.status = 'active'
    JOIN offerings AS offering
      ON offering.id = payment.offering_id
     AND offering.workspace_id = payment.workspace_id
    LEFT JOIN central_enrollments AS enrollment
      ON enrollment.payment_id = payment.id
     AND enrollment.workspace_id = payment.workspace_id
     AND enrollment.enrollment_status IN ('active','already_enrolled')
     AND NOT EXISTS (
       SELECT 1 FROM payment_bonus_offerings promised WHERE promised.payment_id=payment.id
         AND NOT EXISTS (SELECT 1 FROM central_bonus_enrollment_items verified
           WHERE verified.payment_id=payment.id AND verified.offering_code=promised.offering_code_snapshot
             AND verified.position=promised.position AND verified.enrollment_status IN ('active','already_enrolled'))
     )
    LEFT JOIN LATERAL (
      SELECT notification.status, notification.sent_at
      FROM post_sale_notifications AS notification
      WHERE notification.payment_id = payment.id
        AND notification.kind = 'access_ready'
      ORDER BY notification.created_at DESC, notification.id DESC
      LIMIT 1
    ) AS access_notification ON true
    WHERE payment.contact_id = ${input.contact_id}::uuid
      AND payment.provider = 'stripe'
      AND (${environment}::text IS NULL OR payment.environment = ${environment})
      AND (${input.offering_code ?? null}::text IS NULL OR offering.code = ${input.offering_code ?? null})
      AND (${input.plan_code ?? null}::text IS NULL OR payment.plan_code = ${input.plan_code ?? null})
    ORDER BY (${input.offering_code ?? null}::text IS NOT NULL
                AND payment.status = 'paid' AND payment.paid_at IS NOT NULL) DESC,
             payment.created_at DESC, payment.id DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    offering_code: row.offering_code,
    plan_code: row.plan_code,
    paid_at: row.paid_at === null
      ? null
      : row.paid_at instanceof Date
        ? row.paid_at.toISOString()
        : new Date(row.paid_at).toISOString(),
    fulfillment: row.enrollment_status === null
      ? null
      : {
          enrollment_status: row.enrollment_status,
          access_message_status: row.access_message_status,
          access_sent_at: row.access_sent_at === null
            ? null
            : row.access_sent_at instanceof Date
              ? row.access_sent_at.toISOString()
              : new Date(row.access_sent_at).toISOString(),
        },
  };
}
