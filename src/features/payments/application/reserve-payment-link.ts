import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
  isStripePaymentLinkUrl,
  type PaymentPlanCode,
} from '../domain/payment-link';

export class PaymentLinkReservationError extends Error {
  constructor(readonly code: string) {
    super(`Payment link reservation rejected: ${code}`);
    this.name = 'PaymentLinkReservationError';
  }
}

export interface ReservePaymentLinkInput {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly offering_id: string;
  readonly plan_code: PaymentPlanCode;
  readonly idempotency_key: string;
  readonly payment_link_url: string;
}

export interface ReservedPaymentLink {
  readonly payment_id: string;
  readonly status: string;
  readonly url: string;
}

export interface ReserveStripeVerificationLinkInput {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly offering_id: string;
  readonly idempotency_key: string;
  readonly payment_link_url: string;
}

export function addPaymentReference(url: string, paymentId: string): string {
  if (!isStripePaymentLinkUrl(url)) {
    throw new PaymentLinkReservationError('PAYMENT_LINK_INVALID');
  }
  const referenced = new URL(url);
  referenced.searchParams.set('client_reference_id', paymentId);
  return referenced.toString();
}

/**
 * Reserves the ledger row before an approved static Stripe Payment Link is
 * delivered. `client_reference_id` is returned by Checkout in the signed
 * session webhook, which lets a shared Payment Link identify the exact lead.
 */
export async function reservePaymentLink(
  db: DbClient,
  input: ReservePaymentLinkInput,
): Promise<ReservedPaymentLink> {
  if (!input.idempotency_key.trim()) {
    throw new PaymentLinkReservationError('IDEMPOTENCY_KEY_REQUIRED');
  }
  if (!isPaymentPlanCode(input.plan_code)) {
    throw new PaymentLinkReservationError('PLAN_INVALID');
  }

  const existing = await db<Array<{
    id: string;
    status: string;
    workspace_id: string;
    contact_id: string;
    offering_id: string;
    plan_code: PaymentPlanCode | null;
    checkout_url: string | null;
  }>>`
    SELECT id, status, workspace_id, contact_id, offering_id, plan_code, checkout_url
    FROM payments
    WHERE idempotency_key = ${input.idempotency_key}
  `;
  if (existing[0]) {
    const found = existing[0];
    if (
      found.workspace_id !== input.workspace_id
      || found.contact_id !== input.contact_id
      || found.offering_id !== input.offering_id
      || found.plan_code !== input.plan_code
      || !found.checkout_url
    ) {
      throw new PaymentLinkReservationError('IDEMPOTENCY_KEY_CONFLICT');
    }
    return { payment_id: found.id, status: found.status, url: found.checkout_url };
  }

  const offering = await db<Array<{ id: string }>>`
    SELECT id
    FROM offerings
    WHERE id = ${input.offering_id}::uuid
      AND workspace_id = ${input.workspace_id}::uuid
      AND status = 'active'
  `;
  if (!offering[0]) throw new PaymentLinkReservationError('OFFERING_NOT_FOUND');

  const paymentId = randomUUID();
  const presentation = PAYMENT_PLAN_PRESENTATIONS[input.plan_code];
  const checkoutMode = input.plan_code === 'one_time' ? 'payment' : 'subscription';
  const checkoutUrl = addPaymentReference(input.payment_link_url, paymentId);
  const inserted = await db<Array<{ id: string; status: string; checkout_url: string }>>`
    WITH inserted_payment AS (
      INSERT INTO payments (
        id, workspace_id, contact_id, offering_id, amount, currency, status,
        provider, environment, checkout_mode, idempotency_key, checkout_url, plan_code
      ) VALUES (
        ${paymentId}::uuid, ${input.workspace_id}::uuid, ${input.contact_id}::uuid,
        ${input.offering_id}::uuid, ${presentation.installment_amount},
        ${presentation.currency}, 'reserved', 'stripe', 'live', ${checkoutMode},
        ${input.idempotency_key}, ${checkoutUrl}, ${input.plan_code}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, status, checkout_url
    ), recorded_event AS (
      INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
      SELECT
        inserted_payment.id, 'internal', 'internal:reserved:' || inserted_payment.id::text,
        'reserved', ${jsonbParam(db, {
          idempotency_key: input.idempotency_key,
          plan_code: input.plan_code,
          source: 'stripe_payment_link',
        })}
      FROM inserted_payment
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING payment_id
    )
    SELECT id, status, checkout_url
    FROM inserted_payment
  `;

  if (!inserted[0]) {
    return reservePaymentLink(db, input);
  }

  return { payment_id: paymentId, status: inserted[0].status, url: inserted[0].checkout_url };
}

/**
 * Operator-only USD 0.50 Stripe verification path. It deliberately has no
 * public plan code, so neither Agent A nor Agent B can discover or offer it.
 * Access is provided only by the separately authenticated diagnostic route.
 */
export async function reserveStripeVerificationLink(
  db: DbClient,
  input: ReserveStripeVerificationLinkInput,
): Promise<ReservedPaymentLink> {
  if (!input.idempotency_key.trim()) {
    throw new PaymentLinkReservationError('IDEMPOTENCY_KEY_REQUIRED');
  }
  const existing = await db<Array<{
    id: string;
    status: string;
    workspace_id: string;
    contact_id: string;
    offering_id: string;
    plan_code: string | null;
    checkout_url: string | null;
    amount: string;
  }>>`
    SELECT id, status, workspace_id, contact_id, offering_id, plan_code,
           checkout_url, amount::text AS amount
    FROM payments
    WHERE idempotency_key = ${input.idempotency_key}
  `;
  if (existing[0]) {
    const found = existing[0];
    if (
      found.workspace_id !== input.workspace_id
      || found.contact_id !== input.contact_id
      || found.offering_id !== input.offering_id
      || found.plan_code !== null
      || Number(found.amount) !== 0.5
      || !found.checkout_url
    ) {
      throw new PaymentLinkReservationError('IDEMPOTENCY_KEY_CONFLICT');
    }
    return { payment_id: found.id, status: found.status, url: found.checkout_url };
  }

  const offering = await db<Array<{ id: string }>>`
    SELECT id FROM offerings
    WHERE id = ${input.offering_id}::uuid
      AND workspace_id = ${input.workspace_id}::uuid
      AND status = 'active'
  `;
  if (!offering[0]) throw new PaymentLinkReservationError('OFFERING_NOT_FOUND');

  const paymentId = randomUUID();
  const checkoutUrl = addPaymentReference(input.payment_link_url, paymentId);
  const inserted = await db<Array<{ id: string; status: string; checkout_url: string }>>`
    WITH inserted_payment AS (
      INSERT INTO payments (
        id, workspace_id, contact_id, offering_id, amount, currency, status,
        provider, environment, checkout_mode, idempotency_key, checkout_url, plan_code
      ) VALUES (
        ${paymentId}::uuid, ${input.workspace_id}::uuid, ${input.contact_id}::uuid,
        ${input.offering_id}::uuid, '0.50', 'USD', 'reserved', 'stripe', 'live',
        'payment', ${input.idempotency_key}, ${checkoutUrl}, NULL
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, status, checkout_url
    ), recorded_event AS (
      INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
      SELECT
        inserted_payment.id, 'internal', 'internal:reserved:' || inserted_payment.id::text,
        'reserved', ${jsonbParam(db, {
          idempotency_key: input.idempotency_key,
          source: 'stripe_internal_verification',
        })}
      FROM inserted_payment
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING payment_id
    )
    SELECT id, status, checkout_url FROM inserted_payment
  `;
  if (!inserted[0]) return reserveStripeVerificationLink(db, input);
  return { payment_id: paymentId, status: inserted[0].status, url: inserted[0].checkout_url };
}
