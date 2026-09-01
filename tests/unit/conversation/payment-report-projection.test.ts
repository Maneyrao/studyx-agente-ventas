import { describe, expect, it } from 'vitest';
import {
  leadProjectionKey,
  paymentReportProjectionPayloadV1,
  shouldProjectPaymentReportV1,
  type PaymentReportProjectionSubjectV1,
} from '@/features/payments/domain/payment-report-projection';

const complete: PaymentReportProjectionSubjectV1 = {
  nombre: 'Ariana',
  apellido: 'Paz',
  correo: 'ariana.paz@example.test',
  telefono: '+5491100000001',
  cursoInteres: 'Redes Informáticas',
  plan: 'one_time',
  paymentReported: true,
};

describe('payment report projection', () => {
  /** Sending a link is not a sale. The operator row is for a reported payment. */
  it('does not project when only the link was sent', () => {
    expect(shouldProjectPaymentReportV1({ ...complete, paymentReported: false })).toBe(false);
  });

  it('does not project while any of the six data points is missing', () => {
    const subjects: Array<Partial<PaymentReportProjectionSubjectV1>> = [
      { nombre: null }, { apellido: null }, { correo: null },
      { telefono: null }, { cursoInteres: null }, { plan: null },
      { nombre: '  ' },
    ];
    for (const missing of subjects) {
      expect(shouldProjectPaymentReportV1({ ...complete, ...missing })).toBe(false);
    }
  });

  it('projects once the six are complete and a payment was reported', () => {
    expect(shouldProjectPaymentReportV1(complete)).toBe(true);
  });

  /** One key per contact: replays and repeated claims rewrite one row. */
  it('addresses one stable operator row per contact', () => {
    expect(leadProjectionKey('ws-1', 'contact-1')).toBe('lead:ws-1:contact-1');
  });

  /** A claim is not a verified payment, and the row must say so. */
  it('marks the row as reported by the customer and pending human review', () => {
    const payload = paymentReportProjectionPayloadV1(complete);

    expect(payload.estadoPago).toBe('reportado_por_cliente');
    expect(payload.ultimaSenal).toBe('payment_reported');
    expect(payload.etapaComercial).toBe('payment_reported');
    expect(JSON.stringify(payload)).not.toMatch(/verificad|confirmad|acredit/iu);
  });

  it('carries exactly the six frozen data points and no seventh', () => {
    const payload = paymentReportProjectionPayloadV1(complete);

    expect(payload.nombre).toBe('Ariana');
    expect(payload.apellido).toBe('Paz');
    expect(payload.email).toBe('ariana.paz@example.test');
    expect(payload.telefono).toBe('+5491100000001');
    expect(payload.cursoInteres).toBe('Redes Informáticas');
    expect(payload.plan).toBe('one_time');
  });
});
