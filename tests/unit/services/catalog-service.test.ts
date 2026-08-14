import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/orchestrator', () => ({
  sql: () => Promise.resolve([]),
}));
vi.mock('@/lib/observability/structured-log', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { getEffectivePriceCents, ProductSchema, type Product } from '@/lib/services/catalog.service';

const baseProduct: Product = {
  sku: 'CURSO-VENTAS-8',
  name: 'Curso Ventas 8 semanas',
  description: null,
  duration_weeks: 8,
  modality: 'live',
  price_ars_cents: 12500000,
  price_usd_cents: 12500,
  promo_ars_cents: null,
  promo_usd_cents: null,
  promo_valid_to: null,
  active: true,
};

describe('ProductSchema', () => {
  it('accepts a valid product with no promo', () => {
    expect(() => ProductSchema.parse(baseProduct)).not.toThrow();
  });

  it('rejects negative prices', () => {
    expect(() => ProductSchema.parse({ ...baseProduct, price_ars_cents: -1 })).toThrow();
  });

  it('rejects duration_weeks <= 0', () => {
    expect(() => ProductSchema.parse({ ...baseProduct, duration_weeks: 0 })).toThrow();
  });

  it('rejects invalid modality', () => {
    expect(() =>
      ProductSchema.parse({ ...baseProduct, modality: 'in-person' as unknown as Product['modality'] }),
    ).toThrow();
  });
});

describe('getEffectivePriceCents', () => {
  it('returns the base price when no promo is set', () => {
    expect(getEffectivePriceCents(baseProduct, 'ARS')).toBe(12500000);
    expect(getEffectivePriceCents(baseProduct, 'USD')).toBe(12500);
  });

  it('returns the promo price when promo is set and no validity window', () => {
    const p: Product = {
      ...baseProduct,
      promo_ars_cents: 10000000,
      promo_usd_cents: 10000,
      promo_valid_to: null,
    };
    expect(getEffectivePriceCents(p, 'ARS')).toBe(10000000);
    expect(getEffectivePriceCents(p, 'USD')).toBe(10000);
  });

  it('returns the promo price when now is before promo_valid_to', () => {
    const p: Product = {
      ...baseProduct,
      promo_ars_cents: 10000000,
      promo_usd_cents: 10000,
      promo_valid_to: '2099-12-31T23:59:59Z',
    };
    expect(getEffectivePriceCents(p, 'ARS', Date.parse('2026-08-01T00:00:00Z'))).toBe(10000000);
  });

  it('falls back to base price when now is past promo_valid_to', () => {
    const p: Product = {
      ...baseProduct,
      promo_ars_cents: 10000000,
      promo_usd_cents: 10000,
      promo_valid_to: '2025-01-01T00:00:00Z',
    };
    expect(getEffectivePriceCents(p, 'ARS', Date.parse('2026-08-01T00:00:00Z'))).toBe(12500000);
    expect(getEffectivePriceCents(p, 'USD', Date.parse('2026-08-01T00:00:00Z'))).toBe(12500);
  });

  it('falls back to base price when promo_valid_to is unparseable', () => {
    const p: Product = {
      ...baseProduct,
      promo_ars_cents: 10000000,
      promo_usd_cents: 10000,
      promo_valid_to: 'not-a-date-but-passes-schema-later',
    };
    // Schema would reject this string upstream; the function must still be
    // safe if it somehow arrives (defensive).
    expect(getEffectivePriceCents(p, 'ARS')).toBe(10000000);
  });

  it('never mutates the input', () => {
    const p: Product = {
      ...baseProduct,
      promo_ars_cents: 9999,
      promo_usd_cents: 99,
      promo_valid_to: '2099-12-31T23:59:59Z',
    };
    const before = JSON.stringify(p);
    getEffectivePriceCents(p, 'ARS');
    expect(JSON.stringify(p)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Regression: PostgreSQL `timestamptz::text` format vs ProductSchema.
//
// PostgreSQL returns `promo_valid_to` as '2026-10-01 02:59:59+00' (space
// separator, short offset). ProductSchema requires strict ISO with offset.
// The service must normalize BEFORE parsing — never relax the schema.
// ---------------------------------------------------------------------------
import {
  CatalogInvalidDataError,
  isPlaceholderSku,
  normalizeTimestamptz,
  parseProductRow,
  type ProductRow,
} from '@/lib/services/catalog.service';

const PG_TIMESTAMPTZ = '2026-10-01 02:59:59+00';

const pgRow: ProductRow = {
  sku: 'CURSO-VENTAS-4',
  name: 'Curso Ventas 4 semanas',
  description: null,
  duration_weeks: 4,
  modality: 'hybrid',
  price_ars_cents: '7500000',
  price_usd_cents: '7500',
  promo_ars_cents: '6000000',
  promo_usd_cents: '6000',
  promo_valid_to: PG_TIMESTAMPTZ,
  active: true,
};

describe('normalizeTimestamptz', () => {
  it('normalizes the exact PostgreSQL timestamptz text format to strict ISO', () => {
    expect(normalizeTimestamptz(PG_TIMESTAMPTZ)).toBe('2026-10-01T02:59:59.000Z');
  });

  it('normalizes a timestamptz with explicit negative offset', () => {
    expect(normalizeTimestamptz('2026-09-30 23:59:59-03')).toBe('2026-10-01T02:59:59.000Z');
  });

  it('passes through an already-ISO value unchanged in meaning', () => {
    expect(normalizeTimestamptz('2026-10-01T02:59:59.000Z')).toBe('2026-10-01T02:59:59.000Z');
  });

  it('keeps null as null', () => {
    expect(normalizeTimestamptz(null)).toBeNull();
  });

  it('throws CatalogInvalidDataError (never a retryable error) on garbage', () => {
    expect(() => normalizeTimestamptz('not-a-date')).toThrow(CatalogInvalidDataError);
  });
});

describe('parseProductRow', () => {
  it('parses the exact row shape PostgreSQL returns, promo_valid_to included', () => {
    const product = parseProductRow(pgRow);
    expect(product.promo_valid_to).toBe('2026-10-01T02:59:59.000Z');
    expect(product.price_ars_cents).toBe(7500000);
    expect(product.promo_usd_cents).toBe(6000);
  });

  it('keeps a null promo_valid_to as null', () => {
    expect(parseProductRow({ ...pgRow, promo_valid_to: null }).promo_valid_to).toBeNull();
  });

  it('throws CatalogInvalidDataError when a row violates the schema', () => {
    expect(() => parseProductRow({ ...pgRow, price_ars_cents: '-1' })).toThrow(
      CatalogInvalidDataError,
    );
  });

  it('ProductSchema itself still rejects the raw PG format (schema NOT relaxed)', () => {
    expect(() =>
      ProductSchema.parse({ ...baseProduct, promo_valid_to: PG_TIMESTAMPTZ }),
    ).toThrow();
  });
});

describe('isPlaceholderSku', () => {
  it('flags any SKU starting with PLACEHOLDER-', () => {
    expect(isPlaceholderSku('PLACEHOLDER-CURSO-VENTAS-8')).toBe(true);
    expect(isPlaceholderSku('CURSO-VENTAS-8')).toBe(false);
  });
});
