import { describe, expect, it } from 'vitest';
import { paymentReservationRejectionSubjectsV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';

/** Owner incident B (2026-11-10): a reservation failure is a rejected effect, never an unreadable turn. */
describe('payment reservation rejections are structured effect rejections', () => {
  it.each(['PROMOTION_NOT_AUTHORIZED', 'IDEMPOTENCY_KEY_CONFLICT', 'CHECKOUT_REPLACEMENT_BLOCKED'])(
    '%s rejects the payment-link effect with its real code', code => {
      expect(paymentReservationRejectionSubjectsV1(code)).toEqual(['send_payment_link', `payment_reservation:${code.toLowerCase()}`]);
    });
  it('unrelated reasons are not reinterpreted', () => {
    expect(paymentReservationRejectionSubjectsV1('AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED')).toBeNull();
  });
});
