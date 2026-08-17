import type {
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
  PaymentProvider,
} from '../ports/payment-provider';

/**
 * Deterministic in-memory provider for tests and PAYMENT_PROVIDER=fake
 * deployments. Honors provider-side idempotency: the same idempotency key
 * always resolves to the same session, exactly like Stripe would.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: CreateCheckoutSessionInput[] = [];
  private readonly sessionsByKey = new Map<string, CheckoutSessionResult>();
  private nextError: Error | null = null;

  failNextWith(error: Error): void {
    this.nextError = error;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    this.calls.push(input);
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    const existing = this.sessionsByKey.get(input.idempotencyKey);
    if (existing) return existing;

    const session: CheckoutSessionResult = {
      sessionId: `fake_cs_${input.paymentId}`,
      url: `https://fake.checkout.local/session/${input.paymentId}`,
      status: 'open',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    this.sessionsByKey.set(input.idempotencyKey, session);
    return session;
  }
}
