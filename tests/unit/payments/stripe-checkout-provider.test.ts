import { describe, expect, it, vi } from 'vitest';
import { StripeCheckoutProvider } from '@/features/payments/adapters/stripe-checkout-provider';
import {
  AmbiguousCheckoutError,
  ConfirmedCheckoutError,
  type CreateCheckoutSessionInput,
} from '@/features/payments/ports/payment-provider';
import { RealSideEffectRejectedError } from '@/lib/services/sandbox.service';

const INPUT: CreateCheckoutSessionInput & { contactId: string } = {
  paymentId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  offeringId: '33333333-3333-4333-8333-333333333333',
  contactId: '44444444-4444-4444-8444-444444444444',
  stripePriceId: 'price_canonical',
  checkoutMode: 'payment',
  idempotencyKey: 'checkout:11111111-1111-4111-8111-111111111111',
};

function stripeMock(result: unknown = {
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/c/pay/cs_test_123',
  status: 'open',
  expires_at: 1_766_000_000,
}) {
  const create = vi.fn(async () => result);
  return { client: { checkout: { sessions: { create } } }, create };
}

function provider(overrides: Partial<ConstructorParameters<typeof StripeCheckoutProvider>[0]> = {}) {
  const { client, create } = stripeMock();
  const instance = new StripeCheckoutProvider({
    stripe: client as never,
    environment: 'test',
    successUrl: 'https://example.com/pago/ok',
    cancelUrl: 'https://example.com/pago/cancelado',
    findSandboxProvider: async () => null,
    ...overrides,
  });
  return { instance, create };
}

describe('StripeCheckoutProvider', () => {
  it('creates the session with canonical price, mode, quantity 1 and bounded metadata', async () => {
    const { instance, create } = provider();
    const session = await instance.createCheckoutSession(INPUT);

    expect(session).toEqual({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      status: 'open',
      expiresAt: new Date(1_766_000_000 * 1000).toISOString(),
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params.mode).toBe('payment');
    expect(params.line_items).toEqual([{ price: 'price_canonical', quantity: 1 }]);
    expect(params.success_url).toBe('https://example.com/pago/ok');
    expect(params.cancel_url).toBe('https://example.com/pago/cancelado');
    // Metadata is exactly these three keys — no phone, no name, no email.
    expect(params.metadata).toEqual({
      payment_id: INPUT.paymentId,
      workspace_id: INPUT.workspaceId,
      offering_id: INPUT.offeringId,
    });
    expect(options).toEqual({ idempotencyKey: INPUT.idempotencyKey });
  });

  it('rejects a payment without a canonical stripe price', async () => {
    const { instance, create } = provider();
    await expect(
      instance.createCheckoutSession({ ...INPUT, stripePriceId: null })
    ).rejects.toBeInstanceOf(ConfirmedCheckoutError);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a connection failure to an ambiguous outcome', async () => {
    const { instance } = provider();
    const failure = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    (instance as unknown as { stripe: { checkout: { sessions: { create: unknown } } } })
      .stripe.checkout.sessions.create = vi.fn(async () => { throw failure; });

    await expect(instance.createCheckoutSession(INPUT)).rejects.toBeInstanceOf(AmbiguousCheckoutError);
  });

  it('maps an invalid request to a confirmed failure', async () => {
    const { instance } = provider();
    const failure = Object.assign(new Error('No such price'), { type: 'StripeInvalidRequestError' });
    (instance as unknown as { stripe: { checkout: { sessions: { create: unknown } } } })
      .stripe.checkout.sessions.create = vi.fn(async () => { throw failure; });

    await expect(instance.createCheckoutSession(INPUT)).rejects.toBeInstanceOf(ConfirmedCheckoutError);
  });

  it('live environment: a sandbox contact is rejected before touching Stripe', async () => {
    const { instance, create } = provider({
      environment: 'live',
      findSandboxProvider: async () => 'telegram_sandbox',
    });
    await expect(instance.createCheckoutSession(INPUT)).rejects.toBeInstanceOf(RealSideEffectRejectedError);
    expect(create).not.toHaveBeenCalled();
  });

  it('live environment stays disabled even for a real contact', async () => {
    const { instance, create } = provider({ environment: 'live' });
    await expect(instance.createCheckoutSession(INPUT)).rejects.toMatchObject({
      code: 'STRIPE_LIVE_DISABLED',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
