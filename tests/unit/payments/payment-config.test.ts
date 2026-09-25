import { describe, expect, it } from 'vitest';
import { loadPaymentProviderConfig, loadStripeWebhookConfig } from '@/lib/config';

const env = (overrides: Record<string, string | undefined>) =>
  ({ ...overrides }) as NodeJS.ProcessEnv;

describe('loadPaymentProviderConfig', () => {
  it('defaults to the fake provider when nothing is configured', () => {
    expect(loadPaymentProviderConfig(env({}))).toEqual({ provider: 'fake' });
  });

  it('stripe_test requires every Stripe variable', () => {
    expect(() => loadPaymentProviderConfig(env({ PAYMENT_PROVIDER: 'stripe_test' })))
      .toThrow(/MISSING_PAYMENT_CONFIG/);
  });

  it('stripe_test refuses a live secret key', () => {
    expect(() => loadPaymentProviderConfig(env({
      PAYMENT_PROVIDER: 'stripe_test',
      STRIPE_SECRET_KEY: 'sk_live_abc123',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_SUCCESS_URL: 'https://example.com/ok',
      STRIPE_CANCEL_URL: 'https://example.com/no',
    }))).toThrow(/STRIPE_TEST_REJECTS_LIVE_KEY/);
  });

  it('stripe_test accepts a test secret key', () => {
    const config = loadPaymentProviderConfig(env({
      PAYMENT_PROVIDER: 'stripe_test',
      STRIPE_SECRET_KEY: 'sk_test_abc123',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_SUCCESS_URL: 'https://example.com/ok',
      STRIPE_CANCEL_URL: 'https://example.com/no',
    }));
    expect(config.provider).toBe('stripe_test');
    if (config.provider === 'stripe_test') {
      expect(config.successUrl).toBe('https://example.com/ok');
    }
  });

  it('stripe_live is disabled outright', () => {
    expect(() => loadPaymentProviderConfig(env({
      PAYMENT_PROVIDER: 'stripe_live',
      STRIPE_SECRET_KEY: 'sk_live_abc123',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_SUCCESS_URL: 'https://example.com/ok',
      STRIPE_CANCEL_URL: 'https://example.com/no',
    }))).toThrow(/STRIPE_LIVE_DISABLED/);
  });

  it('rejects an unknown provider value', () => {
    expect(() => loadPaymentProviderConfig(env({ PAYMENT_PROVIDER: 'paypal' })))
      .toThrow(/INVALID_PAYMENT_CONFIG/);
  });
});

describe('loadStripeWebhookConfig', () => {
  it('accepts a restricted live key for signed inbound events without enabling live checkout', () => {
    expect(loadStripeWebhookConfig(env({
      STRIPE_SECRET_KEY: 'rk_live_restricted',
      STRIPE_WEBHOOK_SECRET: 'whsec_live_endpoint',
      PAYMENT_PROVIDER: 'fake',
    }))).toEqual({
      environment: 'live',
      secretKey: 'rk_live_restricted',
      webhookSecret: 'whsec_live_endpoint',
    });
  });

  it('accepts test keys and rejects malformed key or signing-secret pairs', () => {
    expect(loadStripeWebhookConfig(env({
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_endpoint',
    })).environment).toBe('test');
    expect(() => loadStripeWebhookConfig(env({
      STRIPE_SECRET_KEY: 'not-a-stripe-key',
      STRIPE_WEBHOOK_SECRET: 'whsec_endpoint',
    }))).toThrow('INVALID_STRIPE_WEBHOOK_CONFIG:STRIPE_SECRET_KEY');
    expect(() => loadStripeWebhookConfig(env({
      STRIPE_SECRET_KEY: 'rk_live_restricted',
      STRIPE_WEBHOOK_SECRET: 'wrong-secret',
    }))).toThrow('INVALID_STRIPE_WEBHOOK_CONFIG:STRIPE_WEBHOOK_SECRET');
  });
});
