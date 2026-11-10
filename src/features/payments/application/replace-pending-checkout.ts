import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
  stripePaymentLinkEnvironment,
  type PaymentPlanCode,
} from '../domain/payment-link';
import { PaymentLinkReservationError, addPaymentReference } from './reserve-payment-link';

export type CheckoutRevisionReasonV1 = 'PLAN_CHANGED' | 'CONTACT_DATA_CHANGED';

export interface ReplacePendingCheckoutInputV1 {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly offering_id: string;
  readonly previous_payment_id: string;
  readonly plan_code: PaymentPlanCode;
  readonly payment_link_url: string;
  readonly idempotency_key: string;
  readonly source_turn_id: string;
  /** The model-authorized promotion, if any; it must be the previous package's. */
  readonly promotion_code?: string;
}

export type ReplacePendingCheckoutResultV1 =
  | { readonly outcome: 'reused'; readonly payment_id: string; readonly status: string; readonly url: string }
  | { readonly outcome: 'replaced'; readonly payment_id: string; readonly status: string; readonly url: string;
      readonly replaced_payment_id: string; readonly reason: CheckoutRevisionReasonV1 };

interface PaymentRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly offering_id: string;
  readonly source_conversation_id: string | null;
  readonly status: string;
  readonly provider: string;
  readonly provider_session_id: string | null;
  readonly environment: 'test' | 'live';
  readonly plan_code: PaymentPlanCode | null;
  readonly checkout_url: string | null;
  readonly registration_email: string | null;
  readonly promotion_offer_id: string | null;
  readonly promotion_cycle_id: string | null;
  readonly accepted_offer_version: number | null;
  readonly bonus_snapshot_sealed_at: Date | null;
  readonly promotion_codes: string[];
}

const reject = (code: string): never => { throw new PaymentLinkReservationError(code); };

/**
 * Replaces one unpaid, untouched checkout of the SAME course and package when
 * only the plan or the registration e-mail changed (incident B, 2026-11-10).
 *
 * One transaction: lock → verify → record the supersession (old → new) → new
 * reservation with the requested plan and the current contact e-mail → the
 * package's exact sealed gifts → the attached package now points at the new
 * reference. Same promotion, same offer_version, no extra redemption. The old
 * row and its evidence are never modified; a late payment on it reaches the
 * existing reconciliation case and never a second enrollment.
 *
 * Idempotent per idempotency_key (the turn) and, for the same plan and e-mail,
 * the current reference is reused instead of replaced.
 */
export async function replacePendingCheckoutV1(
  db: DbClient,
  input: ReplacePendingCheckoutInputV1,
): Promise<ReplacePendingCheckoutResultV1> {
  if (!input.idempotency_key.trim()) reject('IDEMPOTENCY_KEY_REQUIRED');
  if (!isPaymentPlanCode(input.plan_code)) reject('PLAN_INVALID');
  const environment = stripePaymentLinkEnvironment(input.payment_link_url);
  if (!environment) reject('PAYMENT_LINK_INVALID');
  const begin = (db as DbClient & { begin?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T> }).begin;
  if (typeof begin === 'function') {
    return await begin.call(db, (tx) => replacePendingCheckoutV1(tx, input)) as ReplacePendingCheckoutResultV1;
  }

  // Same lock order as reservePaymentLink: conversation, redemption, payment.
  await db`SELECT conversation_id FROM conversation_sales_context_states_v1
    WHERE workspace_id=${input.workspace_id}::uuid AND contact_id=${input.contact_id}::uuid
      AND conversation_id=${input.conversation_id}::uuid FOR UPDATE`;
  const loadPayment = async (where: { id?: string; key?: string }, lock: boolean) => (await db<PaymentRow[]>`
    SELECT p.id,p.workspace_id,p.contact_id,p.offering_id,p.source_conversation_id,p.status,p.provider,
      p.provider_session_id,p.environment,p.plan_code,p.checkout_url,p.registration_email,
      p.promotion_offer_id,p.promotion_cycle_id,p.accepted_offer_version,p.bonus_snapshot_sealed_at,
      COALESCE((SELECT array_agg(DISTINCT s.promotion_code_snapshot ORDER BY s.promotion_code_snapshot)
        FROM payment_bonus_offerings s WHERE s.payment_id=p.id), ARRAY[]::text[]) AS promotion_codes
    FROM payments p
    WHERE ${where.id ? db`p.id=${where.id}::uuid` : db`p.idempotency_key=${where.key ?? ''}`}
    ${lock ? db`FOR UPDATE OF p` : db``}`)[0] ?? null;

  const unlockedPrevious = await loadPayment({ id: input.previous_payment_id }, false);
  if (!unlockedPrevious) return reject('CHECKOUT_REPLACEMENT_NOT_FOUND');
  const promotionCode = unlockedPrevious.promotion_codes[0] ?? null;
  if (unlockedPrevious.promotion_codes.length > 1) reject('PROMOTION_SNAPSHOT_INCOMPLETE');
  if ((input.promotion_code ?? promotionCode) !== promotionCode) reject('PROMOTION_NOT_AUTHORIZED');
  if (promotionCode) {
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${[
      'course-bonus-redemption', input.workspace_id, input.contact_id, promotionCode].join(':')}, 0))`;
  }
  const previous = await loadPayment({ id: input.previous_payment_id }, true);
  if (!previous || previous.workspace_id !== input.workspace_id || previous.contact_id !== input.contact_id
    || previous.source_conversation_id !== input.conversation_id || previous.offering_id !== input.offering_id
    || previous.provider !== 'stripe' || previous.environment !== environment || !previous.checkout_url) {
    return reject('CHECKOUT_REPLACEMENT_IDENTITY_MISMATCH');
  }

  // Replay of this same turn (including a concurrent duplicate that won the lock).
  const replay = await loadPayment({ key: input.idempotency_key }, false);
  if (replay) {
    const [link] = await db<Array<{ reason: CheckoutRevisionReasonV1 }>>`
      SELECT reason FROM payment_intent_supersessions
      WHERE payment_id=${previous.id}::uuid AND replacement_payment_id=${replay.id}::uuid`;
    if (!link || replay.plan_code !== input.plan_code || !replay.checkout_url) reject('IDEMPOTENCY_KEY_CONFLICT');
    return { outcome: 'replaced', payment_id: replay.id, status: replay.status, url: replay.checkout_url!,
      replaced_payment_id: previous.id, reason: link!.reason };
  }

  const [superseded] = await db<Array<{ replacement_payment_id: string | null }>>`
    SELECT replacement_payment_id FROM payment_intent_supersessions WHERE payment_id=${previous.id}::uuid`;
  if (superseded) {
    // An equivalent substitution already happened (another turn won the race,
    // or the turn is retried): hand back the CURRENT successor instead of
    // failing. Only revision chains are followed; a course change never is.
    const [successor] = await db<Array<{ id: string; status: string; checkout_url: string | null; equivalent: boolean }>>`
      WITH RECURSIVE chain(payment_id, depth) AS (
        SELECT replacement_payment_id, 1 FROM payment_intent_supersessions
        WHERE payment_id=${previous.id}::uuid AND replacement_payment_id IS NOT NULL
        UNION ALL
        SELECT s.replacement_payment_id, chain.depth+1 FROM payment_intent_supersessions s
        JOIN chain ON s.payment_id=chain.payment_id
        WHERE s.replacement_payment_id IS NOT NULL AND chain.depth<10
      )
      SELECT p.id, p.status, p.checkout_url,
        (p.plan_code=${input.plan_code} AND p.registration_email IS NOT DISTINCT FROM (
          SELECT lower(trim(email)) FROM contacts WHERE id=${input.contact_id}::uuid)) AS equivalent
      FROM chain JOIN payments p ON p.id=chain.payment_id
      WHERE NOT EXISTS (SELECT 1 FROM payment_intent_supersessions s WHERE s.payment_id=p.id)
      ORDER BY chain.depth DESC LIMIT 1`;
    if (successor?.equivalent && successor.checkout_url && ['reserved', 'pending'].includes(successor.status)) {
      return { outcome: 'reused', payment_id: successor.id, status: successor.status, url: successor.checkout_url };
    }
    return reject('CHECKOUT_ALREADY_SUPERSEDED');
  }

  const [contact] = await db<Array<{ email: string | null }>>`
    SELECT lower(trim(email)) AS email FROM contacts WHERE id=${input.contact_id}::uuid`;
  const currentEmail = contact?.email ?? null;
  const reason: CheckoutRevisionReasonV1 | null = previous.plan_code !== input.plan_code ? 'PLAN_CHANGED'
    : (previous.registration_email ?? null) !== currentEmail ? 'CONTACT_DATA_CHANGED' : null;
  if (reason === null) {
    return { outcome: 'reused', payment_id: previous.id, status: previous.status, url: previous.checkout_url };
  }
  if (currentEmail === null) reject('CHECKOUT_REPLACEMENT_CONTACT_MISSING');

  // Nothing that may already have been paid, or is being paid, can be revised.
  const [blocked] = await db<Array<{ reason: string }>>`
    SELECT 'paid' AS reason FROM payments paid
    WHERE paid.workspace_id=${input.workspace_id}::uuid AND paid.contact_id=${input.contact_id}::uuid
      AND paid.offering_id=${input.offering_id}::uuid AND paid.status='paid'
    UNION ALL SELECT 'reconciliation' FROM payment_reconciliation_cases WHERE payment_id=${previous.id}::uuid
    UNION ALL SELECT 'evidence' FROM payment_events WHERE payment_id=${previous.id}::uuid
      AND event_type IN ('checkout_completed_paid','async_payment_succeeded','checkout_completed_unpaid')
    LIMIT 1`;
  if (blocked || previous.status !== 'reserved' || previous.provider_session_id !== null) {
    reject('CHECKOUT_REPLACEMENT_BLOCKED');
  }
  if (previous.promotion_codes.length > 0 && previous.promotion_offer_id === null) {
    // A legacy review-mode package has no direct offer identity to move.
    reject('CHECKOUT_REPLACEMENT_UNSUPPORTED');
  }

  const paymentId = randomUUID();
  const presentation = PAYMENT_PLAN_PRESENTATIONS[input.plan_code];
  const checkoutUrl = addPaymentReference(input.payment_link_url, paymentId);
  await db`INSERT INTO payment_intent_supersessions(payment_id,workspace_id,contact_id,conversation_id,
      original_offering_id,replacement_offering_id,source_turn_id,reason,replacement_payment_id)
    VALUES (${previous.id}::uuid,${input.workspace_id}::uuid,${input.contact_id}::uuid,${input.conversation_id}::uuid,
      ${input.offering_id}::uuid,${input.offering_id}::uuid,${input.source_turn_id}::uuid,${reason},${paymentId}::uuid)`;
  const inserted = await db<Array<{ id: string; status: string; checkout_url: string }>>`
    WITH inserted_payment AS (
      INSERT INTO payments (
        id, workspace_id, contact_id, offering_id, amount, currency, status,
        provider, environment, checkout_mode, idempotency_key, checkout_url, plan_code,
        registration_email, registration_name, source_conversation_id,
        promotion_offer_id, promotion_cycle_id, accepted_offer_version
      ) VALUES (
        ${paymentId}::uuid, ${input.workspace_id}::uuid, ${input.contact_id}::uuid,
        ${input.offering_id}::uuid, ${presentation.installment_amount}, ${presentation.currency},
        'reserved', 'stripe', ${environment}, ${input.plan_code === 'one_time' ? 'payment' : 'subscription'},
        ${input.idempotency_key}, ${checkoutUrl}, ${input.plan_code}, ${currentEmail},
        (SELECT name FROM contacts WHERE id=${input.contact_id}::uuid), ${input.conversation_id}::uuid,
        ${previous.promotion_offer_id}::uuid, ${previous.promotion_cycle_id}::uuid,
        ${previous.accepted_offer_version}::integer
      )
      RETURNING id, status, checkout_url
    ), recorded_event AS (
      INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
      SELECT inserted_payment.id, 'internal', 'internal:reserved:' || inserted_payment.id::text, 'reserved',
        ${jsonbParam(db, {
          idempotency_key: input.idempotency_key, plan_code: input.plan_code, source: 'stripe_payment_link',
          replaces_payment_id: previous.id, revision_reason: reason,
          ...(promotionCode ? { promotion_code: promotionCode, promotion_cycle_id: previous.promotion_cycle_id,
            accepted_offer_version: previous.accepted_offer_version } : {}),
        })}
      FROM inserted_payment
      RETURNING payment_id
    )
    SELECT id, status, checkout_url FROM inserted_payment`;
  if (!inserted[0]) reject('CHECKOUT_REPLACEMENT_NOT_RESERVED');

  if (previous.promotion_offer_id) {
    // The exact sealed package of the offer, as the original reservation copied it.
    const copied = await db<Array<{ id: string }>>`
      INSERT INTO payment_bonus_offerings (payment_id, promotion_id, offering_id, promotion_code_snapshot,
        offering_code_snapshot, offering_display_name_snapshot, position)
      SELECT ${paymentId}::uuid, snapshot.promotion_id, snapshot.offering_id, snapshot.promotion_code_snapshot,
        snapshot.offering_code_snapshot, snapshot.offering_display_name_snapshot, snapshot.position
      FROM promotion_offer_bonus_offerings snapshot
      WHERE snapshot.offer_id=${previous.promotion_offer_id}::uuid
      ORDER BY snapshot.position
      RETURNING id`;
    const [expected] = await db<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM payment_bonus_offerings WHERE payment_id=${previous.id}::uuid`;
    if (copied.length === 0 || copied.length !== expected?.count) reject('PROMOTION_SNAPSHOT_INCOMPLETE');
    const moved = await db<Array<{ id: string }>>`
      UPDATE promotion_offers SET payment_id=${paymentId}::uuid
      WHERE id=${previous.promotion_offer_id}::uuid AND payment_id=${previous.id}::uuid AND status='attached'
      RETURNING id`;
    if (!moved[0]) reject('PROMOTION_NOT_AUTHORIZED');
  }
  const sealed = await db<Array<{ id: string }>>`
    UPDATE payments SET bonus_snapshot_sealed_at=now()
    WHERE id=${paymentId}::uuid AND status='reserved' AND bonus_snapshot_sealed_at IS NULL RETURNING id`;
  if (!sealed[0]) reject('PROMOTION_SNAPSHOT_NOT_SEALED');
  return { outcome: 'replaced', payment_id: paymentId, status: inserted[0]!.status, url: inserted[0]!.checkout_url,
    replaced_payment_id: previous.id, reason: reason! };
}
