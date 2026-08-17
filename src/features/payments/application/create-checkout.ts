import type postgres from 'postgres';
import { jsonbParam } from '@/lib/db/json';
import {
  AmbiguousCheckoutError,
  ConfirmedCheckoutError,
  type PaymentProvider,
} from '../ports/payment-provider';

/**
 * Creates the provider checkout session for a reserved payment.
 *
 * Concurrency and retries ride on the payment state machine:
 *   - only one caller can move reserved → creating_checkout (guarded UPDATE);
 *     the loser observes the current state and NEVER contacts the provider;
 *   - the provider call happens OUTSIDE any transaction, always with the
 *     exact idempotency key `checkout:{payment_id}`, so a retry after an
 *     ambiguous outcome (creation_ambiguous) resolves to the same session;
 *   - a worker that died mid-creation leaves `creating_checkout`; after the
 *     takeover window the next call retries with the same key.
 */

const CREATING_TAKEOVER_MS = 60_000;

export class CheckoutCreationError extends Error {
  constructor(readonly code: string) {
    super(`Checkout creation rejected: ${code}`);
    this.name = 'CheckoutCreationError';
  }
}

export interface CreateCheckoutResult {
  payment_id: string;
  status: string;
  checkout_url: string | null;
  provider_session_id: string | null;
}

interface PaymentRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  offering_id: string;
  status: string;
  provider: 'fake' | 'stripe';
  checkout_mode: 'payment' | 'subscription';
  checkout_url: string | null;
  provider_session_id: string | null;
  updated_at: Date;
  stripe_price_id: string | null;
}

async function loadPayment(db: postgres.Sql, paymentId: string): Promise<PaymentRow> {
  const rows = await db<PaymentRow[]>`
    SELECT p.id, p.workspace_id, p.contact_id, p.offering_id, p.status, p.provider,
           p.checkout_mode, p.checkout_url, p.provider_session_id, p.updated_at,
           opc.stripe_price_id
    FROM payments AS p
    LEFT JOIN offering_payment_configs AS opc ON opc.offering_id = p.offering_id
    WHERE p.id = ${paymentId}::uuid
  `;
  if (!rows[0]) throw new CheckoutCreationError('PAYMENT_NOT_FOUND');
  return rows[0];
}

function asResult(payment: PaymentRow): CreateCheckoutResult {
  return {
    payment_id: payment.id,
    status: payment.status,
    checkout_url: payment.checkout_url,
    provider_session_id: payment.provider_session_id,
  };
}

export async function createCheckout(
  db: postgres.Sql,
  input: { payment_id: string },
  deps: { provider: PaymentProvider; now?: () => number }
): Promise<CreateCheckoutResult> {
  const now = deps.now ?? Date.now;
  const payment = await loadPayment(db, input.payment_id);

  // Already resolved: idempotent, no provider contact.
  if (payment.provider_session_id !== null || ['pending', 'paid', 'failed', 'expired', 'refunded'].includes(payment.status)) {
    return asResult(payment);
  }

  // Gate: exactly one caller may enter creating_checkout. A stale
  // creating_checkout row (dead worker) may be taken over after the window —
  // safe because the provider deduplicates on the idempotency key.
  const claimed = await db<Array<{ id: string }>>`
    UPDATE payments
    SET status = 'creating_checkout'
    WHERE id = ${payment.id}::uuid
      AND (
        status IN ('reserved', 'creation_ambiguous')
        OR (status = 'creating_checkout'
            AND updated_at <= to_timestamp(${(now() - CREATING_TAKEOVER_MS) / 1000}))
      )
    RETURNING id
  `;
  if (claimed.length === 0) {
    return asResult(await loadPayment(db, input.payment_id));
  }

  const idempotencyKey = `checkout:${payment.id}`;
  try {
    // Network call strictly outside any transaction.
    const session = await deps.provider.createCheckoutSession({
      paymentId: payment.id,
      workspaceId: payment.workspace_id,
      offeringId: payment.offering_id,
      stripePriceId: payment.stripe_price_id,
      checkoutMode: payment.checkout_mode,
      idempotencyKey,
    });

    await db.begin(async (tx) => {
      await tx`
        UPDATE payments
        SET status = 'pending',
            provider_session_id = ${session.sessionId},
            provider_session_status = ${session.status},
            checkout_url = ${session.url},
            checkout_expires_at = ${session.expiresAt}::timestamptz,
            error_code = NULL
        WHERE id = ${payment.id}::uuid AND status = 'creating_checkout'
      `;
      await tx`
        INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
        VALUES (
          ${payment.id}::uuid, 'internal', ${`internal:checkout_created:${payment.id}`},
          'checkout_created',
          ${jsonbParam(tx, { session_id: session.sessionId, status: session.status })}
        )
        ON CONFLICT (provider, provider_event_id) DO NOTHING
      `;
    });
    return asResult(await loadPayment(db, input.payment_id));
  } catch (error) {
    if (error instanceof ConfirmedCheckoutError) {
      await db`
        UPDATE payments SET status = 'failed', error_code = ${error.code}
        WHERE id = ${payment.id}::uuid AND status = 'creating_checkout'
      `;
      return asResult(await loadPayment(db, input.payment_id));
    }
    const code = error instanceof AmbiguousCheckoutError ? error.code : 'CHECKOUT_UNKNOWN_OUTCOME';
    await db`
      UPDATE payments SET status = 'creation_ambiguous', error_code = ${code}
      WHERE id = ${payment.id}::uuid AND status = 'creating_checkout'
    `;
    return asResult(await loadPayment(db, input.payment_id));
  }
}
