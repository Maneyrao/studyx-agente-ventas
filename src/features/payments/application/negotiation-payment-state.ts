import type { DbClient } from '@/lib/db/types';

export interface PaymentSaleScopeV1 {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string | null;
  readonly offering_id: string;
}

/**
 * Un único candado transaccional por venta: (workspace, contacto, oferta). Es estable entre
 * conversaciones; qué filas pertenecen al linaje lo decide la familia verificada, no la clave.
 * Nunca un candado de sesión: el pooler en modo transacción no puede sostenerlo.
 */
export async function lockPaymentSaleV1(db: DbClient, scope: PaymentSaleScopeV1): Promise<void> {
  await db`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`payment-sale:${scope.workspace_id}:${scope.contact_id}:${scope.offering_id}`}::text, 0))`;
}

export async function paymentSaleScopeV1(db: DbClient, paymentId: string): Promise<PaymentSaleScopeV1 | null> {
  const [fila] = await db<Array<PaymentSaleScopeV1>>`SELECT workspace_id,contact_id,
    source_conversation_id AS conversation_id,offering_id FROM payments WHERE id=${paymentId}::uuid`;
  return fila ?? null;
}

/** Estados no terminales con un cobro en curso o incierto: nunca se modifica el curso, el paquete ni el enlace. */
const ESTADOS_EN_CURSO = ['pending', 'creating_checkout', 'creation_ambiguous'];

export async function readNegotiationPaymentStateV1(db: DbClient, scope: PaymentSaleScopeV1, lock = false) {
  if (lock) await lockPaymentSaleV1(db, scope);
  // Sin fragmentos anidados: el cliente de runtime ejecuta cada consulta etiquetada de inmediato.
  // La familia (raíz + fuentes enlazadas, un solo salto) se calcula una vez; el índice por conversación hace el resto.
  if (lock) await db`WITH root AS (SELECT sale_family_root_v1(${scope.workspace_id}::uuid,${scope.contact_id}::uuid,${scope.conversation_id}::uuid) AS id),
    family AS (SELECT id FROM root WHERE id IS NOT NULL
      UNION SELECT l.source_conversation_id FROM conversation_history_recovery_links l JOIN root ON l.canonical_conversation_id=root.id
        WHERE l.workspace_id=${scope.workspace_id}::uuid AND l.contact_id=${scope.contact_id}::uuid)
    SELECT p.id FROM payments p WHERE p.workspace_id=${scope.workspace_id}::uuid AND p.contact_id=${scope.contact_id}::uuid
      AND (p.source_conversation_id IN (SELECT id FROM family) OR (${scope.conversation_id}::uuid IS NULL AND p.source_conversation_id IS NULL))
      AND p.offering_id=${scope.offering_id}::uuid
      AND NOT (p.plan_code IS NULL AND p.amount=0.5) -- the USD 0.50 verification link is never part of a sale
    ORDER BY p.id FOR UPDATE OF p`;
  const filas = await db<Array<{ id: string; status: string; source_conversation_id: string | null; provider_session_id: string | null;
    promotion_offer_id: string | null; superseded: boolean; reconciliation: boolean; paid_evidence: boolean; pending_evidence: boolean }>>`
    WITH root AS (SELECT sale_family_root_v1(${scope.workspace_id}::uuid,${scope.contact_id}::uuid,${scope.conversation_id}::uuid) AS id),
    family AS (SELECT id FROM root WHERE id IS NOT NULL
      UNION SELECT l.source_conversation_id FROM conversation_history_recovery_links l JOIN root ON l.canonical_conversation_id=root.id
        WHERE l.workspace_id=${scope.workspace_id}::uuid AND l.contact_id=${scope.contact_id}::uuid)
    SELECT p.id,p.status,p.source_conversation_id,p.provider_session_id,p.promotion_offer_id,
      EXISTS(SELECT 1 FROM payment_intent_supersessions s WHERE s.payment_id=p.id) AS superseded,
      EXISTS(SELECT 1 FROM payment_reconciliation_cases c WHERE c.payment_id=p.id AND c.status='open') AS reconciliation,
      EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id
        AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded')) AS paid_evidence,
      EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id AND e.event_type='checkout_completed_unpaid') AS pending_evidence
    FROM payments p WHERE p.workspace_id=${scope.workspace_id}::uuid AND p.contact_id=${scope.contact_id}::uuid
      AND (p.source_conversation_id IN (SELECT id FROM family) OR (${scope.conversation_id}::uuid IS NULL AND p.source_conversation_id IS NULL))
      AND p.offering_id=${scope.offering_id}::uuid
      AND NOT (p.plan_code IS NULL AND p.amount=0.5) -- the USD 0.50 verification link is never part of a sale
    ORDER BY p.id`;
  // Cobro en curso, incierto o en conciliación: el curso, el paquete y el enlace no se tocan.
  const enCurso = filas.some(fila => fila.reconciliation
    || (fila.paid_evidence && !['paid','refunded','failed','expired'].includes(fila.status))
    || ESTADOS_EN_CURSO.includes(fila.status)
    || (!['paid','refunded','failed','expired'].includes(fila.status) && fila.pending_evidence));
  const blocked = enCurso || filas.some(fila => fila.status === 'paid');
  const vigentes = filas.filter(fila => !fila.superseded && !['failed', 'expired', 'refunded'].includes(fila.status));
  const actual = vigentes.length === 1 && vigentes[0]!.status === 'reserved' && vigentes[0]!.provider_session_id === null
    ? vigentes[0]! : null;
  return { blocked, in_flight: enCurso, may_reopen: !blocked && actual !== null, payment: actual };
}

/**
 * La referencia se retira lógicamente; el Payment Link compartido no se desactiva.
 * La fila pertenece a la conversación original del pago; el turno puede ser de otra de la familia.
 */
export async function retirePaymentForNegotiationV1(db: DbClient, scope: PaymentSaleScopeV1,
  paymentId: string, sourceTurnId: string): Promise<void> {
  await db`INSERT INTO payment_intent_supersessions(payment_id,workspace_id,contact_id,conversation_id,
    original_offering_id,replacement_offering_id,source_turn_id,reason)
    SELECT p.id,p.workspace_id,p.contact_id,p.source_conversation_id,p.offering_id,p.offering_id,
      ${sourceTurnId}::uuid,'NEGOTIATION_REOPENED'
    FROM payments p WHERE p.id=${paymentId}::uuid AND p.workspace_id=${scope.workspace_id}::uuid
      AND p.contact_id=${scope.contact_id}::uuid AND p.offering_id=${scope.offering_id}::uuid`;
}

/** The sale of this course (by code) has a processing, paid-in-flight, reconciling or uncertain payment. */
export async function isCheckoutLockedV1(db: DbClient, input: { workspace_id: string; contact_id: string;
  conversation_id: string | null; offering_code: string }): Promise<boolean> {
  const [oferta] = await db<Array<{ id: string }>>`SELECT id FROM offerings
    WHERE workspace_id=${input.workspace_id}::uuid AND code=${input.offering_code}`;
  if (!oferta) return false;
  return (await readNegotiationPaymentStateV1(db, { workspace_id: input.workspace_id, contact_id: input.contact_id,
    conversation_id: input.conversation_id, offering_id: oferta.id })).in_flight;
}
