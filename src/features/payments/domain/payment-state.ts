/**
 * Canonical payment state machine, as a pure reducer.
 *
 *   reserved → creating_checkout → pending → paid | failed | expired
 *                     ↓ (timeout, outcome unknown)
 *              creation_ambiguous → creating_checkout (retry, same key) | pending
 *   paid → refunded
 *
 * Rules the reducer encodes:
 *   - A terminal state (paid, failed, expired, refunded) never goes
 *     backwards; `paid` moves forward only to `refunded`.
 *   - A completed checkout whose payment_status is still `unpaid` does NOT
 *     mark the payment paid.
 *   - Events that do not apply are `applied: false`, never an exception, so
 *     replayed and out-of-order webhooks stay idempotent by construction.
 */

export type PaymentStatus =
  | 'reserved'
  | 'creating_checkout'
  | 'creation_ambiguous'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refunded';

export type PaymentStateEvent =
  | { type: 'checkout_creation_started' }
  | { type: 'checkout_created' }
  | { type: 'checkout_creation_failed' }
  | { type: 'checkout_creation_ambiguous' }
  | { type: 'checkout_completed_paid' }
  | { type: 'checkout_completed_unpaid' }
  | { type: 'async_payment_succeeded' }
  | { type: 'async_payment_failed' }
  | { type: 'checkout_expired' }
  | { type: 'refunded' };

export interface PaymentTransition {
  next: PaymentStatus;
  applied: boolean;
}

const TRANSITIONS: Record<PaymentStatus, Partial<Record<PaymentStateEvent['type'], PaymentStatus>>> = {
  reserved: {
    checkout_creation_started: 'creating_checkout',
  },
  creating_checkout: {
    checkout_created: 'pending',
    checkout_creation_failed: 'failed',
    checkout_creation_ambiguous: 'creation_ambiguous',
  },
  creation_ambiguous: {
    checkout_creation_started: 'creating_checkout',
    checkout_created: 'pending',
    checkout_creation_failed: 'failed',
  },
  pending: {
    checkout_completed_paid: 'paid',
    async_payment_succeeded: 'paid',
    async_payment_failed: 'failed',
    checkout_expired: 'expired',
  },
  paid: {
    refunded: 'refunded',
  },
  failed: {},
  expired: {},
  refunded: {},
};

export function reducePaymentState(
  current: PaymentStatus,
  event: PaymentStateEvent
): PaymentTransition {
  const next = TRANSITIONS[current][event.type];
  if (next === undefined) return { next: current, applied: false };
  return { next, applied: true };
}

export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'paid',
  'failed',
  'expired',
  'refunded',
];
