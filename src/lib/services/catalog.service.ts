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
  const rows = await sql<Product[]>`
    SELECT sku, name, description, duration_weeks, modality,
           price_ars_cents::int8 AS price_ars_cents,
           price_usd_cents::int8 AS price_usd_cents,
           promo_ars_cents::int8 AS promo_ars_cents,
           promo_usd_cents::int8 AS promo_usd_cents,
           promo_valid_to::text  AS promo_valid_to,
           active
    FROM products
    WHERE active = true
    ORDER BY sku ASC
  `;
  // Postgres returns bigint as string via postgres.js; coerce to number for
  // ergonomic downstream use. Safe: cents fit well inside 2^53.
  const coerced = rows.map((r) => ({
    ...r,
    price_ars_cents: Number(r.price_ars_cents),
    price_usd_cents: Number(r.price_usd_cents),
    promo_ars_cents: r.promo_ars_cents === null ? null : Number(r.promo_ars_cents),
    promo_usd_cents: r.promo_usd_cents === null ? null : Number(r.promo_usd_cents),
  }));
  return coerced.map((r) => ProductSchema.parse(r));
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const rows = await sql<Product[]>`
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
  const r = rows[0];
  const coerced = {
    ...r,
    price_ars_cents: Number(r.price_ars_cents),
    price_usd_cents: Number(r.price_usd_cents),
    promo_ars_cents: r.promo_ars_cents === null ? null : Number(r.promo_ars_cents),
    promo_usd_cents: r.promo_usd_cents === null ? null : Number(r.promo_usd_cents),
  };
  return ProductSchema.parse(coerced);
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
