import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';

/**
 * Reserves one canonical payment for (workspace, contact, offering).
 *
 * Every commercial fact is derived HERE from canonical rows:
 *   - fixed offering  → amount/currency from offerings;
 *   - quote offering  → amount/currency from a commercial_quote that is
 *     confirmed, current, and belongs to the same workspace/contact/offering;
 *   - free offering   → no payment, ever.
 * The input deliberately has no amount, currency, price id or provider field
 * — a hostile extra property is simply never read.
 *
 * Idempotent per caller-supplied idempotency_key: a replay returns the same
 * payment. No network I/O happens here; the checkout comes later.
 */

export class PaymentReservationError extends Error {
  constructor(readonly code: string) {
    super(`Payment reservation rejected: ${code}`);
    this.name = 'PaymentReservationError';
  }
}

export interface ReservePaymentInput {
  workspace_id: string;
  contact_id: string;
  offering_id: string;
  quote_id?: string | null;
  idempotency_key: string;
}

export interface ReservedPayment {
  payment_id: string;
  status: string;
  amount: string;
  currency: string;
}

interface OfferingRow {
  id: string;
  price_type: 'fixed' | 'quote' | 'free';
  price_amount: string | null;
  currency: string | null;
  provider: 'fake' | 'stripe';
  checkout_mode: 'payment' | 'subscription';
  environment: 'test' | 'live';
}

export async function reservePayment(
  db: DbClient,
  input: ReservePaymentInput
): Promise<ReservedPayment> {
  if (!input.idempotency_key || input.idempotency_key.trim() === '') {
    throw new PaymentReservationError('IDEMPOTENCY_KEY_REQUIRED');
  }

  const existing = await db<Array<{ id: string; status: string; amount: string; currency: string; workspace_id: string; contact_id: string; offering_id: string }>>`
    SELECT id, status, amount::text AS amount, currency, workspace_id, contact_id, offering_id
    FROM payments WHERE idempotency_key = ${input.idempotency_key}
  `;
  if (existing[0]) {
    const found = existing[0];
    if (
      found.workspace_id !== input.workspace_id
      || found.contact_id !== input.contact_id
      || found.offering_id !== input.offering_id
    ) {
      throw new PaymentReservationError('IDEMPOTENCY_KEY_CONFLICT');
    }
    return { payment_id: found.id, status: found.status, amount: found.amount, currency: found.currency };
  }

  const offerings = await db<OfferingRow[]>`
    SELECT o.id, o.price_type, o.price_amount::text AS price_amount, o.currency,
           opc.provider, opc.checkout_mode, opc.environment
    FROM offerings AS o
    JOIN offering_payment_configs AS opc
      ON opc.offering_id = o.id AND opc.status = 'active'
    WHERE o.id = ${input.offering_id}::uuid
      AND o.workspace_id = ${input.workspace_id}::uuid
      AND o.status = 'active'
  `;
  const offering = offerings[0];
  if (!offering) throw new PaymentReservationError('OFFERING_NOT_PAYABLE');

  let amount: string;
  let currency: string;
  let quoteId: string | null = null;

  if (offering.price_type === 'free') {
    throw new PaymentReservationError('OFFERING_IS_FREE');
  } else if (offering.price_type === 'fixed') {
    if (offering.price_amount === null || offering.currency === null) {
      throw new PaymentReservationError('OFFERING_PRICE_MISSING');
    }
    amount = offering.price_amount;
    currency = offering.currency;
  } else {
    if (!input.quote_id) throw new PaymentReservationError('QUOTE_REQUIRED');
    const quotes = await db<Array<{
      id: string; amount: string; currency: string; status: string; valid_until: Date | null;
    }>>`
      SELECT id, amount::text AS amount, currency, status, valid_until
      FROM commercial_quotes
      WHERE id = ${input.quote_id}::uuid
        AND workspace_id = ${input.workspace_id}::uuid
        AND contact_id = ${input.contact_id}::uuid
        AND offering_id = ${input.offering_id}::uuid
    `;
    const quote = quotes[0];
    if (!quote) throw new PaymentReservationError('QUOTE_NOT_FOUND');
    if (quote.status !== 'confirmed') throw new PaymentReservationError('QUOTE_NOT_CONFIRMED');
    if (quote.valid_until !== null && quote.valid_until.getTime() <= Date.now()) {
      throw new PaymentReservationError('QUOTE_EXPIRED');
    }
    amount = quote.amount;
    currency = quote.currency;
    quoteId = quote.id;
  }

  const inserted = await db<Array<{ id: string }>>`
    INSERT INTO payments (
      workspace_id, contact_id, offering_id, quote_id,
      amount, currency, status, provider, environment, checkout_mode, idempotency_key
    ) VALUES (
      ${input.workspace_id}::uuid, ${input.contact_id}::uuid, ${input.offering_id}::uuid,
      ${quoteId}::uuid,
      ${amount}, ${currency}, 'reserved',
      ${offering.provider}, ${offering.environment}, ${offering.checkout_mode},
      ${input.idempotency_key}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  let paymentId = inserted[0]?.id;
  if (!paymentId) {
    // A concurrent replay won the insert race; return its row.
    const raced = await db<Array<{ id: string }>>`
      SELECT id FROM payments WHERE idempotency_key = ${input.idempotency_key}
    `;
    paymentId = raced[0].id;
  } else {
    await db`
      INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
      VALUES (
        ${paymentId}::uuid, 'internal', ${`internal:reserved:${paymentId}`},
        'reserved', ${jsonbParam(db, { idempotency_key: input.idempotency_key })}
      )
      ON CONFLICT (provider, provider_event_id) DO NOTHING
    `;
  }

  return { payment_id: paymentId, status: 'reserved', amount, currency };
}
