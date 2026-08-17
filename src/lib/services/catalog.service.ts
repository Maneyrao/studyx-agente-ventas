import { z } from 'zod';
import { sql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';

// Schema mirrors the SQL constraint set 1:1. Prices in MINOR UNITS (cents).
export const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  duration_weeks: z.number().int().positive(),
  modality: z.enum(['live', 'ondemand', 'hybrid']),
  price_ars_cents: z.number().int().nonnegative(),
  price_usd_cents: z.number().int().nonnegative(),
  promo_ars_cents: z.number().int().nonnegative().nullable(),
  promo_usd_cents: z.number().int().nonnegative().nullable(),
  promo_valid_to: z.string().datetime({ offset: true }).nullable(),
  active: z.boolean(),
});

export type Product = z.infer<typeof ProductSchema>;

/**
 * Raw row shape as returned by postgres.js: bigints arrive as strings and
 * `promo_valid_to::text` arrives in PostgreSQL's own timestamptz format
 * ('2026-10-01 02:59:59+00'), which ProductSchema rejects on purpose.
 */
export interface ProductRow {
  sku: string;
  name: string;
  description: string | null;
  duration_weeks: number;
  modality: string;
  price_ars_cents: string | number;
  price_usd_cents: string | number;
  promo_ars_cents: string | number | null;
  promo_usd_cents: string | number | null;
  promo_valid_to: string | null;
  active: boolean;
}

/**
 * Permanent, non-retryable catalog data error. The HTTP layer maps this to a
 * 422 CATALOG_INVALID_DATA so clients never burn retries on data that will be
 * exactly as invalid on the next attempt.
 */
export class CatalogInvalidDataError extends Error {
  readonly code = 'CATALOG_INVALID_DATA' as const;
  constructor(detail: string) {
    super(`CATALOG_INVALID_DATA: ${detail}`);
    this.name = 'CatalogInvalidDataError';
  }
}

/**
 * Placeholder SKUs from the seed must never be quotable, even if a row flips
 * back to active by accident. Defense in depth: SQL excludes them, this
 * predicate excludes them again in code.
 */
export function isPlaceholderSku(sku: string): boolean {
  return sku.startsWith('PLACEHOLDER-');
}

/**
 * Normalize any valid timestamptz text (PG format or ISO) to strict ISO 8601.
 * Null stays null. Garbage is a permanent data error, not a transient one.
 */
export function normalizeTimestamptz(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CatalogInvalidDataError('promo_valid_to is not a parseable timestamp');
  }
  return parsed.toISOString();
}

/**
 * Coerce one DB row into a validated Product. Numeric strings become numbers,
 * the promo timestamp is normalized to ISO, and a schema violation surfaces as
 * CatalogInvalidDataError — never as a retryable failure.
 */
export function parseProductRow(row: ProductRow): Product {
  const coerced = {
    ...row,
    price_ars_cents: Number(row.price_ars_cents),
    price_usd_cents: Number(row.price_usd_cents),
    promo_ars_cents: row.promo_ars_cents === null ? null : Number(row.promo_ars_cents),
    promo_usd_cents: row.promo_usd_cents === null ? null : Number(row.promo_usd_cents),
    promo_valid_to: normalizeTimestamptz(row.promo_valid_to),
  };
  const parsed = ProductSchema.safeParse(coerced);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(',');
    throw new CatalogInvalidDataError(`schema violation in fields: ${fields}`);
  }
  return parsed.data;
}

/**
 * Effective price for the given currency, honoring an active promo when
 * present and still within its validity window. Returns MINOR UNITS.
 * Never mutates the input; returns the base price when no promo applies.
 * `now` parameter is injectable so tests can freeze time — callers should
 * pass Date.now() (or a Date-like ms epoch).
 */
export function getEffectivePriceCents(
  product: Product,
  currency: 'ARS' | 'USD',
  now: number = Date.now(),
): number {
  const base = currency === 'ARS' ? product.price_ars_cents : product.price_usd_cents;
  const promo = currency === 'ARS' ? product.promo_ars_cents : product.promo_usd_cents;
  if (promo === null) return base;
  if (product.promo_valid_to !== null) {
    const validTo = Date.parse(product.promo_valid_to);
    if (Number.isFinite(validTo) && validTo < now) return base;
  }
  return promo;
}

export async function listActiveProducts(): Promise<Product[]> {
  const rows = await sql<ProductRow[]>`
    SELECT sku, name, description, duration_weeks, modality,
           price_ars_cents::int8 AS price_ars_cents,
           price_usd_cents::int8 AS price_usd_cents,
           promo_ars_cents::int8 AS promo_ars_cents,
           promo_usd_cents::int8 AS promo_usd_cents,
           promo_valid_to::text  AS promo_valid_to,
           active
    FROM products
    WHERE active = true
      AND sku NOT LIKE 'PLACEHOLDER-%'
    ORDER BY sku ASC
  `;
  return rows.filter((r) => !isPlaceholderSku(r.sku)).map(parseProductRow);
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  if (isPlaceholderSku(sku)) return null;
  const rows = await sql<ProductRow[]>`
    SELECT sku, name, description, duration_weeks, modality,
           price_ars_cents::int8 AS price_ars_cents,
           price_usd_cents::int8 AS price_usd_cents,
           promo_ars_cents::int8 AS promo_ars_cents,
           promo_usd_cents::int8 AS promo_usd_cents,
           promo_valid_to::text  AS promo_valid_to,
           active
    FROM products
    WHERE sku = ${sku}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return parseProductRow(rows[0]);
}

/**
 * Upsert seed catalog into the products table. Preserves manual edits to
 * `active` (does NOT force-enable disabled SKUs).
 */
export async function upsertProducts(products: Product[]): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const p of products) {
    await sql`
      INSERT INTO products (
        sku, name, description, duration_weeks, modality,
        price_ars_cents, price_usd_cents,
        promo_ars_cents, promo_usd_cents, promo_valid_to,
        active
      ) VALUES (
        ${p.sku}, ${p.name}, ${p.description}, ${p.duration_weeks}, ${p.modality},
        ${p.price_ars_cents}, ${p.price_usd_cents},
        ${p.promo_ars_cents}, ${p.promo_usd_cents}, ${p.promo_valid_to},
        ${p.active}
      )
      ON CONFLICT (sku) DO UPDATE SET
        name             = EXCLUDED.name,
        description      = EXCLUDED.description,
        duration_weeks   = EXCLUDED.duration_weeks,
        modality         = EXCLUDED.modality,
        price_ars_cents  = EXCLUDED.price_ars_cents,
        price_usd_cents  = EXCLUDED.price_usd_cents,
        promo_ars_cents  = EXCLUDED.promo_ars_cents,
        promo_usd_cents  = EXCLUDED.promo_usd_cents,
        promo_valid_to   = EXCLUDED.promo_valid_to
        -- active: intentionally omitted (manual toggles win)
    `;
    upserted++;
  }
  logger.info({ event: 'catalog.upserted', count: upserted });
  return { upserted };
}
