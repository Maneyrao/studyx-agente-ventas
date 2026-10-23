import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
  isStripePaymentLinkUrl,
  stripePaymentLinkEnvironment,
  type PaymentPlanCode,
} from '../domain/payment-link';
import { loadCentralCargaBonusConfig } from '@/features/fulfillment/central-carga/config';

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
  readonly conversation_id?: string;
  readonly promotion_code?: string;
  readonly promotion_channel?: 'text' | 'voice';
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
  const environment = stripePaymentLinkEnvironment(input.payment_link_url);
  if (!environment) throw new PaymentLinkReservationError('PAYMENT_LINK_INVALID');
  if (input.promotion_code && !loadCentralCargaBonusConfig().enabled) {
    throw new PaymentLinkReservationError('COURSE_BONUS_DISABLED');
  }

  const begin = (db as DbClient & {
    begin?: <T>(fn: (transaction: DbClient) => Promise<T>) => Promise<T>;
  }).begin;
  if (typeof begin === 'function') {
    return (await begin.call(db, (transaction) => reservePaymentLink(transaction, input))) as ReservedPaymentLink;
  }

  const existing = await db<Array<{
    id: string;
    status: string;
    workspace_id: string;
    contact_id: string;
    offering_id: string;
    plan_code: PaymentPlanCode | null;
    checkout_url: string | null;
    environment: 'test' | 'live';
    promotion_codes: string[];
    bonus_snapshot_sealed_at: Date | null;
  }>>`
    SELECT payment.id, payment.status, payment.workspace_id, payment.contact_id,
      payment.offering_id, payment.plan_code, payment.checkout_url, payment.environment,
      payment.bonus_snapshot_sealed_at,
      COALESCE((
        SELECT array_agg(DISTINCT snapshot.promotion_code_snapshot ORDER BY snapshot.promotion_code_snapshot)
        FROM payment_bonus_offerings snapshot WHERE snapshot.payment_id = payment.id
      ), ARRAY[]::text[]) AS promotion_codes
    FROM payments payment
    WHERE payment.idempotency_key = ${input.idempotency_key}
  `;
  if (existing[0]) {
    const found = existing[0];
    if (
      found.workspace_id !== input.workspace_id
      || found.contact_id !== input.contact_id
      || found.offering_id !== input.offering_id
      || found.plan_code !== input.plan_code
      || found.environment !== environment
      || !found.checkout_url
      || (input.promotion_code === undefined
        ? found.promotion_codes.length !== 0
        : found.promotion_codes.length !== 1 || found.promotion_codes[0] !== input.promotion_code)
    ) {
      throw new PaymentLinkReservationError('IDEMPOTENCY_KEY_CONFLICT');
    }
    if (!found.bonus_snapshot_sealed_at) await db`
      UPDATE payments SET bonus_snapshot_sealed_at = now()
      WHERE id = ${found.id}::uuid AND bonus_snapshot_sealed_at IS NULL
    `;
    return { payment_id: found.id, status: found.status, url: found.checkout_url };
  }

  let authorizedPromotion: {
    promotion_id: string;
    offer_id: string;
    bonus_count: number;
  } | null = null;
  if (input.promotion_code) {
    if (!input.conversation_id) throw new PaymentLinkReservationError('PROMOTION_NOT_AUTHORIZED');
    const promotions = await db<Array<{
      promotion_id: string;
      offer_id: string;
      bonus_count: number;
    }>>`
      SELECT promotion.id AS promotion_id, offer.id AS offer_id,
        (SELECT count(*)::integer FROM promotion_offer_bonus_offerings candidate
          WHERE candidate.offer_id = offer.id) AS bonus_count
      FROM promotions promotion
      JOIN promotion_offers offer ON offer.promotion_id = promotion.id
      WHERE promotion.workspace_id = ${input.workspace_id}::uuid
        AND promotion.promotion_code = ${input.promotion_code}
        AND promotion.paid_offering_id = ${input.offering_id}::uuid
        AND promotion.active = true
        AND ${input.promotion_channel ?? 'text'} = ANY(promotion.channels)
        AND (promotion.valid_from IS NULL OR promotion.valid_from <= now())
        AND (promotion.valid_until IS NULL OR promotion.valid_until > now())
        AND offer.workspace_id = ${input.workspace_id}::uuid
        AND offer.contact_id = ${input.contact_id}::uuid
        AND offer.conversation_id = ${input.conversation_id}::uuid
        AND offer.paid_offering_id = ${input.offering_id}::uuid
        AND offer.status = 'accepted'
        AND offer.bonus_snapshot_sealed_at IS NOT NULL
        AND offer.payment_id IS NULL
        AND (offer.expires_at IS NULL OR offer.expires_at > now())
        AND (SELECT count(*) FROM promotion_offers used
          WHERE used.promotion_id = promotion.id
            AND used.contact_id = ${input.contact_id}::uuid
            AND used.status = 'attached') < promotion.max_redemptions_per_contact
        AND (SELECT count(*) FROM promotion_offer_bonus_offerings candidate
          WHERE candidate.offer_id = offer.id) BETWEEN 1 AND 3
      FOR UPDATE OF offer
    `;
    authorizedPromotion = promotions[0] ?? null;
    if (!authorizedPromotion) throw new PaymentLinkReservationError('PROMOTION_NOT_AUTHORIZED');
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
        provider, environment, checkout_mode, idempotency_key, checkout_url, plan_code,
        registration_email, registration_name, source_conversation_id
      ) VALUES (
        ${paymentId}::uuid, ${input.workspace_id}::uuid, ${input.contact_id}::uuid,
        ${input.offering_id}::uuid, ${presentation.installment_amount},
        ${presentation.currency}, 'reserved', 'stripe', ${environment}, ${checkoutMode},
        ${input.idempotency_key}, ${checkoutUrl}, ${input.plan_code},
        (SELECT lower(trim(email)) FROM contacts WHERE id = ${input.contact_id}::uuid),
        (SELECT name FROM contacts WHERE id = ${input.contact_id}::uuid),
        ${input.conversation_id ?? null}::uuid
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
          ...(input.promotion_code ? { promotion_code: input.promotion_code } : {}),
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

  if (authorizedPromotion && input.promotion_code) {
    const snapshots = await db<Array<{ id: string }>>`
      INSERT INTO payment_bonus_offerings (
        payment_id, promotion_id, offering_id, promotion_code_snapshot,
        offering_code_snapshot, offering_display_name_snapshot, position
      )
      SELECT ${paymentId}::uuid, snapshot.promotion_id, snapshot.offering_id,
        snapshot.promotion_code_snapshot, snapshot.offering_code_snapshot,
        snapshot.offering_display_name_snapshot, snapshot.position
      FROM promotion_offer_bonus_offerings snapshot
      WHERE snapshot.offer_id = ${authorizedPromotion.offer_id}::uuid
      ORDER BY snapshot.position
      RETURNING id
    `;
    if (snapshots.length !== authorizedPromotion.bonus_count) {
      throw new PaymentLinkReservationError('PROMOTION_SNAPSHOT_INCOMPLETE');
    }
    const attached = await db<Array<{ id: string }>>`
      UPDATE promotion_offers SET status = 'attached', payment_id = ${paymentId}::uuid
      WHERE id = ${authorizedPromotion.offer_id}::uuid
        AND status = 'accepted' AND payment_id IS NULL
      RETURNING id
    `;
    if (!attached[0]) throw new PaymentLinkReservationError('PROMOTION_NOT_AUTHORIZED');
  }

  const sealed = await db<Array<{ id: string }>>`
    UPDATE payments SET bonus_snapshot_sealed_at = now()
    WHERE id = ${paymentId}::uuid AND status = 'reserved' AND bonus_snapshot_sealed_at IS NULL
    RETURNING id
  `;
  if (!sealed[0]) throw new PaymentLinkReservationError('PROMOTION_SNAPSHOT_NOT_SEALED');

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
