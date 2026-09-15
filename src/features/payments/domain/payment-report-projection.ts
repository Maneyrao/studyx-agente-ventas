/** The operator sheet holds one row per contact; this is that row's address. */
export function leadProjectionKey(workspaceId: string, contactId: string): string {
  return `lead:${workspaceId}:${contactId}`;
}

/**
 * The frozen commercial contract, as the projection sees it: the four
 * conversational data points plus the canonical course and plan, and the
 * customer's own claim that they paid.
 */
export interface PaymentReportProjectionSubjectV1 {
  readonly nombre: string | null;
  readonly apellido: string | null;
  readonly correo: string | null;
  readonly telefono: string | null;
  readonly cursoInteres: string | null;
  readonly plan: string | null;
  readonly paymentReported: boolean;
}

/**
 * The condition that promotes an existing lead row to payment-reported work.
 *
 * Sending a payment link is not a sale and never was: it says only that a
 * customer was given a way to pay. What an operator needs to act on is a
 * customer who says they paid AND enough identity to find them. The lead row
 * may already exist from first contact, but it is not marked as a reported
 * payment until both halves are present.
 */
export function shouldProjectPaymentReportV1(
  subject: PaymentReportProjectionSubjectV1,
): boolean {
  if (!subject.paymentReported) return false;
  return [
    subject.nombre, subject.apellido, subject.correo,
    subject.telefono, subject.cursoInteres, subject.plan,
  ].every((value) => (value ?? '').trim().length > 0);
}

export interface PaymentReportProjectionPayloadV1 {
  readonly nombre?: string;
  readonly apellido?: string;
  readonly email?: string;
  readonly telefono: string;
  readonly cursoInteres?: string;
  readonly plan?: string;
  readonly etapaComercial: string;
  readonly estadoPago: string;
  readonly ultimaSenal: string;
}

/**
 * The projected row for a reported payment. `estado_pago` records a claim,
 * not a verification: no field here may state that money arrived, because
 * nothing in this path has evidence that it did. A human decides that.
 */
export function paymentReportProjectionPayloadV1(
  subject: PaymentReportProjectionSubjectV1,
): PaymentReportProjectionPayloadV1 {
  return {
    nombre: subject.nombre ?? undefined,
    apellido: subject.apellido ?? undefined,
    email: subject.correo ?? undefined,
    telefono: subject.telefono ?? '',
    cursoInteres: subject.cursoInteres ?? undefined,
    plan: subject.plan ?? undefined,
    etapaComercial: 'payment_reported',
    estadoPago: 'reportado_por_cliente',
    ultimaSenal: 'payment_reported',
  };
}
