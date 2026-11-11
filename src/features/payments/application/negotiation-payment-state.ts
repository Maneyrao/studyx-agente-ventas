import type postgres from 'postgres';
import type { DbClient } from '@/lib/db/types';

export interface PaymentSaleScopeV1 {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string | null;
  readonly offering_id: string;
}

const claveDeVenta = (scope: PaymentSaleScopeV1): string =>
  ['payment-sale', scope.workspace_id, scope.contact_id, scope.conversation_id ?? '', scope.offering_id].join(':');

/** Un mismo candado ordena la oferta, el cobro y el alta de esta venta. */
export async function lockPaymentSaleV1(db: DbClient, scope: PaymentSaleScopeV1): Promise<void> {
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${claveDeVenta(scope)}, 0))`;
}

export async function paymentSaleScopeV1(db: DbClient, paymentId: string): Promise<PaymentSaleScopeV1 | null> {
  const [fila] = await db<Array<PaymentSaleScopeV1>>`SELECT workspace_id,contact_id,
    source_conversation_id AS conversation_id,offering_id FROM payments WHERE id=${paymentId}::uuid`;
  return fila ?? null;
}

export async function readNegotiationPaymentStateV1(db: DbClient, scope: PaymentSaleScopeV1, lock = false) {
  if (lock) await lockPaymentSaleV1(db, scope);
  const filas = await db<Array<{ id: string; status: string; provider_session_id: string | null;
    promotion_offer_id: string | null; superseded: boolean; reconciliation: boolean; paid_evidence: boolean; pending_evidence: boolean }>>`
    SELECT p.id,p.status,p.provider_session_id,p.promotion_offer_id,
      EXISTS(SELECT 1 FROM payment_intent_supersessions s WHERE s.payment_id=p.id) AS superseded,
      EXISTS(SELECT 1 FROM payment_reconciliation_cases c WHERE c.payment_id=p.id AND c.status='open') AS reconciliation,
      EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id
        AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded')) AS paid_evidence,
      EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id AND e.event_type='checkout_completed_unpaid') AS pending_evidence
    FROM payments p WHERE p.workspace_id=${scope.workspace_id}::uuid AND p.contact_id=${scope.contact_id}::uuid
      AND p.source_conversation_id IS NOT DISTINCT FROM ${scope.conversation_id}::uuid AND p.offering_id=${scope.offering_id}::uuid
    ORDER BY p.id ${lock ? db`FOR UPDATE OF p` : db``}`;
  const blocked = filas.some(fila => fila.reconciliation || fila.status === 'paid'
    || (fila.paid_evidence && !['refunded','failed','expired'].includes(fila.status))
    || (!['paid','refunded','failed','expired'].includes(fila.status) && (fila.status === 'pending' || fila.pending_evidence)));
  const vigentes = filas.filter(fila => !fila.superseded && !['failed', 'expired', 'refunded'].includes(fila.status));
  const actual = vigentes.length === 1 && vigentes[0]!.status === 'reserved' && vigentes[0]!.provider_session_id === null
    ? vigentes[0]! : null;
  return { blocked, may_reopen: !blocked && actual !== null, payment: actual };
}

/** La referencia se retira lógicamente; el Payment Link compartido no se desactiva. */
export async function retirePaymentForNegotiationV1(db: DbClient, scope: PaymentSaleScopeV1,
  paymentId: string, sourceTurnId: string): Promise<void> {
  await db`INSERT INTO payment_intent_supersessions(payment_id,workspace_id,contact_id,conversation_id,
    original_offering_id,replacement_offering_id,source_turn_id,reason)
    VALUES (${paymentId}::uuid,${scope.workspace_id}::uuid,${scope.contact_id}::uuid,${scope.conversation_id}::uuid,
      ${scope.offering_id}::uuid,${scope.offering_id}::uuid,${sourceTurnId}::uuid,'NEGOTIATION_REOPENED')`;
}

/** El alta usa un candado de sesión: no mantiene una transacción abierta durante la llamada externa. */
export async function withNegotiationPaymentSaleLockV1<T>(sql: postgres.Sql, paymentId: string,
  work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const scope = await paymentSaleScopeV1(sql, paymentId);
  if (!scope) return work(sql);
  const [linaje] = await sql`SELECT 1 FROM payment_intent_supersessions s
    WHERE s.workspace_id=${scope.workspace_id}::uuid AND s.contact_id=${scope.contact_id}::uuid
      AND s.conversation_id=${scope.conversation_id}::uuid AND s.original_offering_id=${scope.offering_id}::uuid
      AND s.reason='NEGOTIATION_REOPENED' LIMIT 1`;
  if (!linaje) return work(sql);
  const conexion = await sql.reserve();
  try {
    await conexion`SELECT pg_advisory_lock(hashtextextended(${claveDeVenta(scope)}, 0))`;
    return await work(conexion as unknown as postgres.Sql);
  } finally {
    try { await conexion`SELECT pg_advisory_unlock(hashtextextended(${claveDeVenta(scope)}, 0))`; }
    finally { await conexion.release(); }
  }
}
