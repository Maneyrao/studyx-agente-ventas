import { NextResponse } from 'next/server';
import { listActiveProducts, getEffectivePriceCents } from '@/lib/services/catalog.service';
import { logger } from '@/lib/observability/structured-log';

/**
 * GET /api/agent/tools/catalog
 *
 * Returns every active product with its effective price (base or promo,
 * whichever the current server time selects). Consumed by the Botpress-side
 * agent as a "tool" so the LLM never invents prices — it always reads them
 * from a single source of truth.
 *
 * No auth: the catalog is not sensitive. Add HMAC only if we start returning
 * customer-specific offers here.
 */
export async function GET() {
  try {
    const products = await listActiveProducts();
    const now = Date.now();
    const items = products.map((p) => ({
      sku: p.sku,
      name: p.name,
      description: p.description,
      duration_weeks: p.duration_weeks,
      modality: p.modality,
      price: {
        ars_cents: getEffectivePriceCents(p, 'ARS', now),
        usd_cents: getEffectivePriceCents(p, 'USD', now),
      },
      list_price: {
        ars_cents: p.price_ars_cents,
        usd_cents: p.price_usd_cents,
      },
      promo: p.promo_ars_cents !== null || p.promo_usd_cents !== null
        ? {
            ars_cents: p.promo_ars_cents,
            usd_cents: p.promo_usd_cents,
            valid_to: p.promo_valid_to,
          }
        : null,
    }));
    return NextResponse.json(
      { count: items.length, items, generated_at: new Date(now).toISOString() },
      { status: 200 },
    );
  } catch (error) {
    logger.error({ event: 'catalog.list.failed', error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 500 });
  }
}
