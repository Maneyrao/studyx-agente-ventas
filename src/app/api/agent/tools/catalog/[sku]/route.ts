import { NextRequest, NextResponse } from 'next/server';
import {
  CatalogInvalidDataError,
  getProductBySku,
  getEffectivePriceCents,
} from '@/lib/services/catalog.service';
import { logger } from '@/lib/observability/structured-log';

/**
 * GET /api/agent/tools/catalog/:sku
 *
 * Returns one product by SKU (or 404). Used by the agent when it needs to
 * quote a specific course without pulling the whole list. Effective price
 * calculation matches the /catalog list endpoint.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  const { sku } = await ctx.params;
  if (typeof sku !== 'string' || sku.trim() === '') {
    return NextResponse.json({ error: 'INVALID_SKU' }, { status: 400 });
  }
  try {
    const product = await getProductBySku(sku);
    if (product === null) {
      return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
    }
    const now = Date.now();
    return NextResponse.json(
      {
        sku: product.sku,
        name: product.name,
        description: product.description,
        duration_weeks: product.duration_weeks,
        modality: product.modality,
        active: product.active,
        price: {
          ars_cents: getEffectivePriceCents(product, 'ARS', now),
          usd_cents: getEffectivePriceCents(product, 'USD', now),
        },
        list_price: {
          ars_cents: product.price_ars_cents,
          usd_cents: product.price_usd_cents,
        },
        promo: product.promo_ars_cents !== null || product.promo_usd_cents !== null
          ? {
              ars_cents: product.promo_ars_cents,
              usd_cents: product.promo_usd_cents,
              valid_to: product.promo_valid_to,
            }
          : null,
        generated_at: new Date(now).toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof CatalogInvalidDataError) {
      logger.error({ event: 'catalog.get.invalid_data', sku, error: String(error) });
      return NextResponse.json({ error: 'CATALOG_INVALID_DATA' }, { status: 422 });
    }
    logger.error({ event: 'catalog.get.failed', sku, error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
