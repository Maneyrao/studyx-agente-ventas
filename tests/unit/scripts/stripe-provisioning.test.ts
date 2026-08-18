import { describe, expect, it, vi } from 'vitest';
import {
  amountToUnitAmount,
  buildPricePayload,
  buildProductPayload,
  deriveStripeEnvironment,
  findMatchingPrice,
  productSearchQuery,
  upsertStripeProductAndPrice,
} from '../../../scripts/lib/stripe-provisioning.mjs';

const OFFERING = {
  id: 'b1000000-0000-4000-8000-000000000001',
  code: 'maquillaje_profesional',
  display_name: 'Diplomado en Maquillaje Profesional',
  price_type: 'fixed',
  price_amount: '1200.00',
  currency: 'USD',
};

describe('deriveStripeEnvironment', () => {
  it('maps sk_test_ to test', () => {
    expect(deriveStripeEnvironment('sk_test_abc123')).toBe('test');
  });

  it('maps sk_live_ to live', () => {
    expect(deriveStripeEnvironment('sk_live_abc123')).toBe('live');
  });

  it('maps rk_test_ / rk_live_ restricted keys the same way', () => {
    expect(deriveStripeEnvironment('rk_test_abc123')).toBe('test');
    expect(deriveStripeEnvironment('rk_live_abc123')).toBe('live');
  });

  it('rejects a key without a recognized prefix', () => {
    expect(() => deriveStripeEnvironment('not_a_stripe_key')).toThrow(
      /STRIPE_SECRET_KEY_INVALID_PREFIX/,
    );
  });

  it('rejects a missing key without ever including it in the message', () => {
    expect(() => deriveStripeEnvironment(undefined)).toThrow(
      /STRIPE_SECRET_KEY_INVALID_PREFIX/,
    );
  });
});

describe('amountToUnitAmount', () => {
  it('converts a decimal-string amount to integer cents', () => {
    expect(amountToUnitAmount('1200.00')).toBe(120000);
  });

  it('converts a numeric amount to integer cents', () => {
    expect(amountToUnitAmount(699)).toBe(69900);
  });

  it('handles single-digit cents correctly', () => {
    expect(amountToUnitAmount('19.05')).toBe(1905);
  });

  it('rejects an amount with more than two decimal places', () => {
    expect(() => amountToUnitAmount('19.005')).toThrow(/INVALID_PRICE_AMOUNT/);
  });

  it('rejects a negative or non-numeric amount', () => {
    expect(() => amountToUnitAmount('-5.00')).toThrow(/INVALID_PRICE_AMOUNT/);
    expect(() => amountToUnitAmount('abc')).toThrow(/INVALID_PRICE_AMOUNT/);
    expect(() => amountToUnitAmount(null)).toThrow(/INVALID_PRICE_AMOUNT/);
  });
});

describe('buildProductPayload', () => {
  it('builds a Product payload keyed by the offering code in metadata', () => {
    expect(buildProductPayload(OFFERING)).toEqual({
      name: 'Diplomado en Maquillaje Profesional',
      metadata: {
        offering_code: 'maquillaje_profesional',
        offering_id: 'b1000000-0000-4000-8000-000000000001',
      },
    });
  });
});

describe('buildPricePayload', () => {
  it('builds a Price payload from the offering amount/currency', () => {
    expect(buildPricePayload(OFFERING, 'prod_123')).toEqual({
      product: 'prod_123',
      unit_amount: 120000,
      currency: 'usd',
      metadata: { offering_code: 'maquillaje_profesional' },
    });
  });
});

describe('productSearchQuery', () => {
  it('builds a Stripe Search query scoped to the offering code', () => {
    expect(productSearchQuery('maquillaje_profesional')).toBe(
      "metadata['offering_code']:'maquillaje_profesional'",
    );
  });

  it('escapes single quotes in the offering code', () => {
    expect(productSearchQuery("o'brien")).toBe("metadata['offering_code']:'o\\'brien'");
  });
});

describe('findMatchingPrice', () => {
  const prices = [
    { id: 'price_old', active: true, unit_amount: 99900, currency: 'usd' },
    { id: 'price_match', active: true, unit_amount: 120000, currency: 'usd' },
    { id: 'price_inactive', active: false, unit_amount: 120000, currency: 'usd' },
  ];

  it('finds an active price with the same amount and currency', () => {
    expect(findMatchingPrice(prices, 120000, 'USD')).toEqual(prices[1]);
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingPrice(prices, 1, 'usd')).toBeNull();
    expect(findMatchingPrice([], 120000, 'usd')).toBeNull();
  });

  it('ignores inactive prices', () => {
    expect(findMatchingPrice([prices[2]], 120000, 'usd')).toBeNull();
  });
});

describe('upsertStripeProductAndPrice (Stripe client mocked, no network calls)', () => {
  function fakeStripe({
    existingProduct = null as { id: string } | null,
    existingPrices = [] as Array<{ id: string; active: boolean; unit_amount: number; currency: string }>,
  } = {}) {
    const productsCreate = vi.fn(async (payload) => ({ id: 'prod_new', ...payload }));
    const pricesCreate = vi.fn(async (payload) => ({ id: 'price_new', active: true, ...payload }));
    return {
      products: {
        search: vi.fn(async () => ({ data: existingProduct ? [existingProduct] : [] })),
        create: productsCreate,
      },
      prices: {
        list: vi.fn(async () => ({ data: existingPrices })),
        create: pricesCreate,
      },
      _spies: { productsCreate, pricesCreate },
    };
  }

  it('creates a new Product and Price when nothing exists yet', async () => {
    const stripe = fakeStripe();
    const result = await upsertStripeProductAndPrice(stripe, OFFERING);

    expect(stripe.products.search).toHaveBeenCalledWith({
      query: "metadata['offering_code']:'maquillaje_profesional'",
      limit: 1,
    });
    expect(stripe._spies.productsCreate).toHaveBeenCalledTimes(1);
    expect(stripe._spies.pricesCreate).toHaveBeenCalledTimes(1);
    expect(result.product.id).toBe('prod_new');
    expect(result.price.id).toBe('price_new');
  });

  it('is idempotent: reuses an existing Product and Price instead of duplicating them', async () => {
    const existingProduct = { id: 'prod_existing' };
    const existingPrices = [{ id: 'price_existing', active: true, unit_amount: 120000, currency: 'usd' }];
    const stripe = fakeStripe({ existingProduct, existingPrices });

    const result = await upsertStripeProductAndPrice(stripe, OFFERING);

    expect(stripe._spies.productsCreate).not.toHaveBeenCalled();
    expect(stripe._spies.pricesCreate).not.toHaveBeenCalled();
    expect(result.product.id).toBe('prod_existing');
    expect(result.price.id).toBe('price_existing');
  });

  it('reuses the existing Product but creates a new Price if the amount changed', async () => {
    const existingProduct = { id: 'prod_existing' };
    const existingPrices = [{ id: 'price_stale', active: true, unit_amount: 69900, currency: 'usd' }];
    const stripe = fakeStripe({ existingProduct, existingPrices });

    const result = await upsertStripeProductAndPrice(stripe, OFFERING);

    expect(stripe._spies.productsCreate).not.toHaveBeenCalled();
    expect(stripe._spies.pricesCreate).toHaveBeenCalledTimes(1);
    expect(result.product.id).toBe('prod_existing');
    expect(result.price.id).toBe('price_new');
  });
});
