import { lockPaymentSaleV1, paymentSaleScopeV1 } from './negotiation-payment-state';
import type postgres from 'postgres';
import { jsonbParam } from '@/lib/db/json';
import { reducePaymentState, type PaymentStateEvent, type PaymentStatus } from '../domain/payment-state';

/**
 * Records one provider event against the payment ledger, atomically:
 *   1. append to payment_events — (provider, provider_event_id) unique, so a
 *      replayed webhook returns 'duplicate' with NO state change;
 *   2. reduce the payment state with the pure state machine — an event that
 *      does not apply (out-of-order, terminal state) is 'ignored', recorded
 *      but harmless;
 *   3. trusted paid evidence for a superseded intent creates/reuses its manual
 *      case, even when the canonical terminal state ignores that paid event;
 *   4. an ordinary reduction to `paid` enqueues exactly one fulfillment job.
 *      Superseded intents never enqueue fulfillment or retarget the course.
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
  reconciliation_required?: true;
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
    const scope = await paymentSaleScopeV1(tx as unknown as postgres.Sql,input.payment_id);
    if (scope) await lockPaymentSaleV1(tx as unknown as postgres.Sql,scope);
    const payments = await tx<Array<{ id: string; status: PaymentStatus }>>`
      SELECT id, status FROM payments WHERE id = ${input.payment_id}::uuid FOR UPDATE
    `;
    if (!payments[0]) throw new PaymentEventError('PAYMENT_NOT_FOUND');
    const current = payments[0].status;
    const supersessions=await tx<Array<{id:string;case_id:string|null}>>`
      SELECT s.id,c.id AS case_id FROM payment_intent_supersessions s
      LEFT JOIN payment_reconciliation_cases c ON c.payment_id=s.payment_id
      WHERE s.payment_id=${input.payment_id}::uuid`;
    let reconciliation=supersessions[0]?.case_id ? {reconciliation_required:true as const} : {};

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
    const trustedPaidEvent=input.provider==='stripe'
      && (input.event.type==='checkout_completed_paid' || input.event.type==='async_payment_succeeded');
    if(supersessions[0] && trustedPaidEvent) {
      // Look up exact durable evidence on replay too; a reused provider ID for
      // another payment must never manufacture evidence for this reference.
      const evidence=appended[0] ?? (await tx<Array<{id:string}>>`SELECT id FROM payment_events
        WHERE payment_id=${input.payment_id}::uuid AND provider=${input.provider}
          AND provider_event_id=${input.provider_event_id} AND event_type=${input.event.type}`)[0];
      if(evidence) {
        await tx`INSERT INTO payment_reconciliation_cases(payment_id,supersession_id,payment_event_id)
          VALUES (${input.payment_id}::uuid,${supersessions[0].id}::uuid,${evidence.id}::uuid)
          ON CONFLICT(payment_id) DO NOTHING`;
        reconciliation={reconciliation_required:true as const};
      }
    }
    if (scope) {
      const [ancestorCase] = await tx`SELECT 1 FROM payments ancestor
        JOIN payment_reconciliation_cases c ON c.payment_id=ancestor.id AND c.status='open'
        JOIN payment_intent_supersessions s ON s.payment_id=ancestor.id AND s.reason='NEGOTIATION_REOPENED'
        WHERE ancestor.workspace_id=${scope.workspace_id}::uuid AND ancestor.contact_id=${scope.contact_id}::uuid
          AND sale_family_root_v1(ancestor.workspace_id,ancestor.contact_id,ancestor.source_conversation_id)
            IS NOT DISTINCT FROM sale_family_root_v1(${scope.workspace_id}::uuid,${scope.contact_id}::uuid,${scope.conversation_id}::uuid)
          AND ancestor.offering_id=${scope.offering_id}::uuid LIMIT 1`;
      if (ancestorCase) reconciliation={reconciliation_required:true as const};
    }
    if (appended.length === 0) {
      return { outcome: 'duplicate' as const, status: current,...reconciliation };
    }

    const transition = reducePaymentState(current, input.event);
    if (!transition.applied) {
      return { outcome: 'ignored' as const, status: current,...reconciliation };
    }

    await tx`
      UPDATE payments
      SET status = ${transition.next},
          paid_at = CASE WHEN ${transition.next} = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
          error_code = CASE WHEN ${transition.next} IN ('failed', 'expired') THEN ${input.event.type} ELSE error_code END
      WHERE id = ${input.payment_id}::uuid
    `;

    if (transition.next === 'paid') {
      if(!supersessions[0] && !('reconciliation_required' in reconciliation)) await tx`
        INSERT INTO fulfillment_jobs (payment_id, workspace_id)
        SELECT id, workspace_id FROM payments WHERE id = ${input.payment_id}::uuid
        ON CONFLICT (payment_id) DO NOTHING
      `;
    }

    return { outcome: 'applied' as const, status: transition.next,...reconciliation };
  });
}
