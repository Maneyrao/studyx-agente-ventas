import { NextResponse } from 'next/server';
import { listActiveProducts } from '@/lib/services/catalog.service';
import {
  DEFAULT_CATALOG_LIMITS,
  buildCatalogView,
} from '@/features/orchestration/domain/catalog-view';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';

/**
 * GET /api/agent/tools/catalog
 *
 * The only place a price may come from. The agent has no authority to change
 * anything here — this endpoint reads, and there is no write counterpart it
 * could reach.
 *
 * What the response guarantees, and why each one exists:
 *
 * - `prices_assertable: false` means the agent must decline to quote. An empty
 *   catalog has to be a refusal, not an invitation to improvise.
 * - An expired promotion is absent, never shown as history. `as_of` says when
 *   the prices were read, so "vigente" is a claim the backend makes, not one
 *   the model infers.
 * - Descriptions are authored text and go through the same sanitization as any
 *   retrieved document: a product blurb cannot become an instruction.
 * - Items and characters are capped, so a growing catalog cannot silently
 *   crowd the structured facts out of the prompt.
 *
 * Sits under `/api/agent/`, so the proxy already requires the orchestrator key
 * and a valid HMAC signature. No query parameters on purpose: the signature
 * covers the path and body only, so a filter passed in the query string would
 * be the one unsigned input in the request.
 */
export async function GET() {
  try {
    const products = await listActiveProducts();
    const view = buildCatalogView(products, { ...DEFAULT_CATALOG_LIMITS, now: Date.now() });

    counter.increment('catalog_lookups');
    if (view.injection_suspected_count > 0) {
      logger.warn({
        event: 'catalog.injection_suspected',
        suspected: view.injection_suspected_count,
      });
    }
    if (view.dropped > 0 || view.stale_promotions_dropped > 0) {
      logger.info({
        event: 'catalog.capped',
        dropped: view.dropped,
        stale_promotions_dropped: view.stale_promotions_dropped,
      });
    }

    return NextResponse.json(view, { status: 200 });
  } catch (error) {
    // Degrade, never block: the workflow treats this as "no catalog available"
    // and the agent falls back to not quoting anything.
    counter.increment('catalog_lookup_failures');
    logger.error({ event: 'catalog.list.failed', error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
