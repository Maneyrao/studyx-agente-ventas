import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

const prior = {
  paymentProvider: process.env.PAYMENT_PROVIDER,
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  databaseUrl: process.env.DATABASE_URL,
};

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('PAYMENT_PROVIDER', prior.paymentProvider);
  restore('STRIPE_SECRET_KEY', prior.secretKey);
  restore('STRIPE_WEBHOOK_SECRET', prior.webhookSecret);
  restore('DATABASE_URL', prior.databaseUrl);
});

describe('Stripe webhook route', () => {
  it('reaches signature verification with live inbound credentials while checkout stays fake', async () => {
    process.env.PAYMENT_PROVIDER = 'fake';
    process.env.STRIPE_SECRET_KEY = 'rk_live_restricted_fixture';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live_fixture';
    process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:1/not-used';
    const { POST } = await import('@/app/api/webhooks/payments/stripe/route');

    const response = await POST(new NextRequest(
      'https://studyx.example/api/webhooks/payments/stripe',
      { method: 'POST', body: '{}' },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'SIGNATURE_REQUIRED' });
  });
});
