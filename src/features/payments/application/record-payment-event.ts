import type postgres from 'postgres';
import { jsonbParam } from '@/lib/db/json';
import { reducePaymentState, type PaymentStateEvent, type PaymentStatus } from '../domain/payment-state';

/**
 * Records one provider event against the payment ledger, atomically:
 *   1. append to payment_events — (provider, provider_event_id) unique, so a
 *      replayed webhook short-circuits as 'duplicate' with NO state change;
 *   2. reduce the payment state with the pure state machine — an event that
 *      does not apply (out-of-order, terminal state) is 'ignored', recorded
 *      but harmless;
 *   3. when the reduction lands on `paid`, enqueue EXACTLY ONE fulfillment
 *      job (unique per payment). The webhook never fulfills anything itself.
 *
 * Everything happens in one transaction with zero network I/O.
 */

export interface RecordPaymentEventInput {
  payment_id: string;
  provider: string;
  provider_event_id: string;
  event: PaymentStateEvent;
  payload: unknown;
  occurred_at?: string;
}

export interface RecordPaymentEventResult {
  outcome: 'applied' | 'ignored' | 'duplicate';
  status: PaymentStatus;
}

export class PaymentEventError extends Error {
  constructor(readonly code: string) {
    super(`Payment event rejected: ${code}`);
    this.name = 'PaymentEventError';
  }
}

export async function recordPaymentEvent(
  db: postgres.Sql,
  input: RecordPaymentEventInput
): Promise<RecordPaymentEventResult> {
  return db.begin(async (tx) => {
    const payments = await tx<Array<{ id: string; status: PaymentStatus }>>`
      SELECT id, status FROM payments WHERE id = ${input.payment_id}::uuid FOR UPDATE
    `;
    if (!payments[0]) throw new PaymentEventError('PAYMENT_NOT_FOUND');
    const current = payments[0].status;

    const appended = await tx<Array<{ id: string }>>`
      INSERT INTO payment_events (
        payment_id, provider, provider_event_id, event_type, payload, occurred_at
      ) VALUES (
        ${input.payment_id}::uuid, ${input.provider}, ${input.provider_event_id},
        ${input.event.type}, ${jsonbParam(tx, input.payload ?? {})},
        ${input.occurred_at ?? new Date().toISOString()}::timestamptz
      )
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
    `;
    if (appended.length === 0) {
      return { outcome: 'duplicate' as const, status: current };
    }

    const transition = reducePaymentState(current, input.event);
    if (!transition.applied) {
      return { outcome: 'ignored' as const, status: current };
    }

    await tx`
      UPDATE payments
      SET status = ${transition.next},
          paid_at = CASE WHEN ${transition.next} = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
          error_code = CASE WHEN ${transition.next} IN ('failed', 'expired') THEN ${input.event.type} ELSE error_code END
      WHERE id = ${input.payment_id}::uuid
    `;

    if (transition.next === 'paid') {
      await tx`
        INSERT INTO fulfillment_jobs (payment_id, workspace_id)
        SELECT id, workspace_id FROM payments WHERE id = ${input.payment_id}::uuid
        ON CONFLICT (payment_id) DO NOTHING
      `;
    }

    return { outcome: 'applied' as const, status: transition.next };
  });
}
