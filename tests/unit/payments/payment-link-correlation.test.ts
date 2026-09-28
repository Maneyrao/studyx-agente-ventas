import { describe, expect, it } from 'vitest';
import {
  PaymentLinkReservationError,
  addPaymentReference,
} from '@/features/payments/application/reserve-payment-link';

describe('Payment Link correlation', () => {
  it('adds the canonical payment id without changing an approved Stripe link', () => {
    const paymentId = '4a75762d-f7cb-41c1-b887-f860fa711e75';
    expect(addPaymentReference(
      'https://buy.stripe.com/example?prefilled_email=lead%40example.com',
      paymentId,
    )).toBe(
      `https://buy.stripe.com/example?prefilled_email=lead%40example.com&client_reference_id=${paymentId}`,
    );
  });

  it('refuses a non-Stripe destination', () => {
    expect(() => addPaymentReference(
      'https://example.com/pay',
      '4a75762d-f7cb-41c1-b887-f860fa711e75',
    )).toThrowError(PaymentLinkReservationError);
  });
});
