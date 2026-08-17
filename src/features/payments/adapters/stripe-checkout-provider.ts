import type Stripe from 'stripe';
import {
  AmbiguousCheckoutError,
  ConfirmedCheckoutError,
  type CheckoutSessionResult,
  type CreateCheckoutSessionInput,
  type PaymentProvider,
} from '../ports/payment-provider';
import { assertRealSideEffectAllowed } from '@/lib/services/sandbox.service';

/**
 * Stripe Checkout Sessions adapter (server-side only; no stripe-js anywhere).
 *
 * The session is built exclusively from canonical facts:
 *   - price: the offering's configured stripe_price_id, quantity 1;
 *   - mode: the offering's configured checkout_mode;
 *   - success/cancel URLs: deployment configuration;
 *   - metadata: payment_id, workspace_id, offering_id and nothing else;
 *   - idempotency key: exactly the caller's `checkout:{payment_id}`.
 *
 * Error taxonomy: a connection-level failure means the outcome is UNKNOWN
 * (the session may exist) → AmbiguousCheckoutError, and the retry reuses the
 * same idempotency key. A Stripe-confirmed rejection → ConfirmedCheckoutError.
 *
 * Live is locked twice: the config loader refuses PAYMENT_PROVIDER=
 * stripe_live, and even a hand-built live instance runs the sandbox lock and
 * then refuses with STRIPE_LIVE_DISABLED before contacting Stripe.
 */

const AMBIGUOUS_STRIPE_ERROR_TYPES = new Set([
  'StripeConnectionError',
  'StripeAPIError',
]);

const CONFIRMED_STRIPE_ERROR_TYPES = new Set([
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError',
]);

export class StripeCheckoutProvider implements PaymentProvider {
  private readonly stripe: Stripe;
  private readonly environment: 'test' | 'live';
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly findSandboxProvider: (contactId: string) => Promise<string | null>;

  constructor(deps: {
    stripe: Stripe;
    environment: 'test' | 'live';
    successUrl: string;
    cancelUrl: string;
    findSandboxProvider: (contactId: string) => Promise<string | null>;
  }) {
    this.stripe = deps.stripe;
    this.environment = deps.environment;
    this.successUrl = deps.successUrl;
    this.cancelUrl = deps.cancelUrl;
    this.findSandboxProvider = deps.findSandboxProvider;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    if (this.environment === 'live') {
      await assertRealSideEffectAllowed(
        { findSandboxProvider: this.findSandboxProvider },
        { contactId: input.contactId, effect: 'STRIPE_CHECKOUT' },
      );
      throw new ConfirmedCheckoutError('STRIPE_LIVE_DISABLED');
    }
    if (!input.stripePriceId) {
      throw new ConfirmedCheckoutError('STRIPE_PRICE_MISSING');
    }

    try {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: input.checkoutMode,
          line_items: [{ price: input.stripePriceId, quantity: 1 }],
          success_url: this.successUrl,
          cancel_url: this.cancelUrl,
          metadata: {
            payment_id: input.paymentId,
            workspace_id: input.workspaceId,
            offering_id: input.offeringId,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        sessionId: session.id,
        url: session.url ?? '',
        status: session.status ?? 'open',
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      };
    } catch (error) {
      const type = (error as { type?: string }).type ?? '';
      if (CONFIRMED_STRIPE_ERROR_TYPES.has(type)) {
        throw new ConfirmedCheckoutError(type);
      }
      if (AMBIGUOUS_STRIPE_ERROR_TYPES.has(type)) {
        throw new AmbiguousCheckoutError(type);
      }
      // Unknown failure (timeout, DNS, crash mid-request): the session may
      // exist on Stripe's side. Never treat it as confirmed-failed.
      throw new AmbiguousCheckoutError('STRIPE_UNKNOWN_OUTCOME');
    }
  }
}
