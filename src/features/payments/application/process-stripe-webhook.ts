import type postgres from 'postgres';
import type Stripe from 'stripe';
import { logger } from '@/lib/observability/structured-log';
import { recordPaymentEvent } from './record-payment-event';
import type { PaymentStateEvent } from '../domain/payment-state';

/**
 * Verifies and records one Stripe webhook delivery.
 *
 * Order of defenses:
 *   1. Stripe-Signature verified against the RAW body — absent/invalid → 400
 *      and the ledger is never touched.
 *   2. Only checkout.session.* events we understand act on the ledger; other
 *      event types are acknowledged untouched (200) so Stripe stops retrying.
 *   3. The payment is located by the session's OWN metadata.payment_id and
 *      must match the persisted provider_session_id (or attach to a payment
 *      whose creation was ambiguous and has no session yet). Any mismatch is
 *      recorded as an anomaly and applies nothing.
 *   4. `paid` requires payment_status === 'paid' AND the session's
 *      amount_total/currency to equal the canonical payment amount. A
 *      manipulated amount never marks paid.
 *   5. State + events + the single fulfillment job are persisted through
 *      recordPaymentEvent (dedup by event id, terminal states never regress)
 *      and the response returns immediately after persisting — fulfillment
 *      and projections (Sheets, enrollment) run from their own queues, never
 *      inside this webhook.
 */

interface StripeSessionPayload {
  id?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string | undefined>;
}

export interface StripeWebhookDeps {
  db: postgres.Sql;
  stripe: Stripe;
  webhookSecret: string;
}

export interface StripeWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

export async function processStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: StripeWebhookDeps
): Promise<StripeWebhookResult> {
  if (!signature) {
    return { status: 400, body: { error: 'SIGNATURE_REQUIRED' } };
  }

  let event: Stripe.Event;
  try {
    event = await deps.stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      deps.webhookSecret
    );
  } catch {
    // Never echo the failure detail: it can contain header fragments.
    return { status: 400, body: { error: 'SIGNATURE_INVALID' } };
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return { status: 200, body: { outcome: 'unhandled_event_type' } };
  }

  const session = event.data.object as StripeSessionPayload;
  const paymentId = session.metadata?.payment_id;
  const sessionId = session.id;
  if (!paymentId || !sessionId) {
    logger.warn({ event: 'payments.webhook.metadata_missing', event_id: event.id });
    return { status: 200, body: { outcome: 'metadata_missing' } };
  }

  const payments = await deps.db<Array<{
    id: string; status: string; amount: string; currency: string;
    provider_session_id: string | null;
  }>>`
    SELECT id, status, amount::text AS amount, currency, provider_session_id
    FROM payments WHERE id = ${paymentId}::uuid
  `;
  const payment = payments[0];
  if (!payment) {
    logger.warn({ event: 'payments.webhook.payment_not_found', event_id: event.id });
    return { status: 200, body: { outcome: 'payment_not_found' } };
  }

  if (payment.provider_session_id !== null && payment.provider_session_id !== sessionId) {
    // Fail closed: a signed event about some OTHER session cannot act here.
    await recordPaymentEvent(deps.db, {
      payment_id: payment.id,
      provider: 'stripe',
      provider_event_id: event.id,
      event: { type: 'checkout_amount_mismatch' },
      payload: { anomaly: 'SESSION_MISMATCH', session_id: sessionId },
    });
    logger.warn({ event: 'payments.webhook.session_mismatch', payment_id: payment.id, event_id: event.id });
    return { status: 200, body: { outcome: 'session_mismatch' } };
  }

  if (payment.provider_session_id === null) {
    // Ambiguous creation resolved by Stripe itself: the session exists and
    // names this payment. Attach it before applying the event.
    await deps.db`
      UPDATE payments
      SET provider_session_id = ${sessionId}
      WHERE id = ${payment.id}::uuid AND provider_session_id IS NULL
    `;
    await recordPaymentEvent(deps.db, {
      payment_id: payment.id,
      provider: 'stripe',
      provider_event_id: `internal:webhook_attach:${sessionId}`,
      event: { type: 'checkout_created' },
      payload: { session_id: sessionId, attached_by: event.id },
    });
  }

  let stateEvent: PaymentStateEvent;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const isPaid = session.payment_status === 'paid';
      if (!isPaid) {
        stateEvent = { type: 'checkout_completed_unpaid' };
        break;
      }
      const amountMatches = session.amount_total === toCents(payment.amount)
        && (session.currency ?? '').toUpperCase() === payment.currency;
      if (!amountMatches) {
        stateEvent = { type: 'checkout_amount_mismatch' };
        logger.warn({
          event: 'payments.webhook.amount_mismatch',
          payment_id: payment.id,
          event_id: event.id,
        });
        break;
      }
      stateEvent = event.type === 'checkout.session.completed'
        ? { type: 'checkout_completed_paid' }
        : { type: 'async_payment_succeeded' };
      break;
    }
    case 'checkout.session.async_payment_failed':
      stateEvent = { type: 'async_payment_failed' };
      break;
    default:
      stateEvent = { type: 'checkout_expired' };
      break;
  }

  const recorded = await recordPaymentEvent(deps.db, {
    payment_id: payment.id,
    provider: 'stripe',
    provider_event_id: event.id,
    event: stateEvent,
    payload: {
      type: event.type,
      session_id: sessionId,
      payment_status: session.payment_status ?? null,
    },
  });

  return { status: 200, body: { outcome: recorded.outcome, status: recorded.status } };
}
