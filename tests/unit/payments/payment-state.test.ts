import { describe, expect, it } from 'vitest';
import {
  reducePaymentState,
  type PaymentStateEvent,
  type PaymentStatus,
} from '@/features/payments/domain/payment-state';

/**
 * Pure state reducer for the canonical payment ledger.
 *
 * Contract: `reducePaymentState(current, event)` returns the next status and
 * whether the event applied. A terminal state never goes backwards — a replayed
 * or out-of-order webhook is `ignored`, never an exception, so webhook
 * processing stays idempotent.
 */

const apply = (status: PaymentStatus, event: PaymentStateEvent) =>
  reducePaymentState(status, event);

describe('reducePaymentState', () => {
  it('walks the happy path reserved → creating_checkout → pending → paid', () => {
    expect(apply('reserved', { type: 'checkout_creation_started' }))
      .toEqual({ next: 'creating_checkout', applied: true });
    expect(apply('creating_checkout', { type: 'checkout_created' }))
      .toEqual({ next: 'pending', applied: true });
    expect(apply('pending', { type: 'checkout_completed_paid' }))
      .toEqual({ next: 'paid', applied: true });
  });

  it('maps a confirmed creation failure to failed and an unknown outcome to creation_ambiguous', () => {
    expect(apply('creating_checkout', { type: 'checkout_creation_failed' }))
      .toEqual({ next: 'failed', applied: true });
    expect(apply('creating_checkout', { type: 'checkout_creation_ambiguous' }))
      .toEqual({ next: 'creation_ambiguous', applied: true });
  });

  it('creation_ambiguous can be retried with the same payment or resolved directly', () => {
    expect(apply('creation_ambiguous', { type: 'checkout_creation_started' }))
      .toEqual({ next: 'creating_checkout', applied: true });
    expect(apply('creation_ambiguous', { type: 'checkout_created' }))
      .toEqual({ next: 'pending', applied: true });
  });

  it('a completed session with payment_status unpaid never marks paid', () => {
    expect(apply('pending', { type: 'checkout_completed_unpaid' }))
      .toEqual({ next: 'pending', applied: false });
  });

  it('async payments resolve pending to paid or failed', () => {
    expect(apply('pending', { type: 'async_payment_succeeded' }))
      .toEqual({ next: 'paid', applied: true });
    expect(apply('pending', { type: 'async_payment_failed' }))
      .toEqual({ next: 'failed', applied: true });
  });

  it('an expired session closes a pending payment', () => {
    expect(apply('pending', { type: 'checkout_expired' }))
      .toEqual({ next: 'expired', applied: true });
  });

  it('paid can only move forward to refunded', () => {
    expect(apply('paid', { type: 'refunded' })).toEqual({ next: 'refunded', applied: true });
    for (const event of [
      { type: 'checkout_expired' },
      { type: 'async_payment_failed' },
      { type: 'checkout_completed_unpaid' },
      { type: 'checkout_creation_started' },
    ] as const) {
      expect(apply('paid', event)).toEqual({ next: 'paid', applied: false });
    }
  });

  it('terminal states never regress on any event', () => {
    const everyEvent: PaymentStateEvent[] = [
      { type: 'checkout_creation_started' },
      { type: 'checkout_created' },
      { type: 'checkout_creation_failed' },
      { type: 'checkout_creation_ambiguous' },
      { type: 'checkout_completed_paid' },
      { type: 'checkout_completed_unpaid' },
      { type: 'async_payment_succeeded' },
      { type: 'async_payment_failed' },
      { type: 'checkout_expired' },
      { type: 'refunded' },
    ];
    for (const status of ['failed', 'expired', 'refunded'] as const) {
      for (const event of everyEvent) {
        expect(apply(status, event)).toEqual({ next: status, applied: false });
      }
    }
  });

  it('out-of-order success beats a later unpaid completion', () => {
    const afterAsync = apply('pending', { type: 'async_payment_succeeded' });
    expect(afterAsync.next).toBe('paid');
    expect(apply(afterAsync.next, { type: 'checkout_completed_unpaid' }))
      .toEqual({ next: 'paid', applied: false });
  });
});
