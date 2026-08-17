/**
 * Port to the external checkout provider (Stripe in production, an in-memory
 * fake in tests). Everything the provider needs is derived in the backend
 * from canonical rows — a caller can never pass an amount, currency, price
 * id or URL through this port on behalf of the model.
 */

export interface CreateCheckoutSessionInput {
  /** Canonical payment row id; also the basis of the idempotency key. */
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly offeringId: string;
  /** Canonical Stripe price (null for non-Stripe providers). */
  readonly stripePriceId: string | null;
  readonly checkoutMode: 'payment' | 'subscription';
  /** Exactly `checkout:{payment_id}` — the same retry reuses the same key. */
  readonly idempotencyKey: string;
}

export interface CheckoutSessionResult {
  readonly sessionId: string;
  readonly url: string;
  readonly status: string;
  readonly expiresAt: string | null;
}

/** The provider confirmed the creation failed; the payment may be failed. */
export class ConfirmedCheckoutError extends Error {
  constructor(readonly code: string) {
    super(`Checkout creation failed: ${code}`);
    this.name = 'ConfirmedCheckoutError';
  }
}

/**
 * The outcome is unknown (timeout, cut connection): the session may or may
 * not exist. The payment parks in creation_ambiguous and the retry MUST use
 * the same idempotency key so the provider deduplicates.
 */
export class AmbiguousCheckoutError extends Error {
  constructor(readonly code: string) {
    super(`Checkout creation ambiguous: ${code}`);
    this.name = 'AmbiguousCheckoutError';
  }
}

export interface PaymentProvider {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult>;
}
