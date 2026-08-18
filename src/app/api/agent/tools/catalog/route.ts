import { NextResponse } from 'next/server';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
  buildBusinessCatalogView,
  buildBusinessContextView,
} from '@/features/orchestration/domain/business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';

/**
 * GET /api/agent/tools/catalog
 *
 * The only place a price may come from, now backed by the configured
 * workspace's canonical `offerings` rather than the legacy `products` table.
 * The agent has no authority to change anything here — this endpoint reads,
 * and there is no write counterpart it could reach.
 *
 * What the response guarantees, and why each one exists:
 *
 * - A fixed-price offering exposes exactly the canonical `price_amount` and
 *   `currency`. There is no conversion or arithmetic between the row and the
 *   response.
 * - A quote-priced offering carries `price: null` and
 *   `price_assertable: false`: the response has no field an invented amount
 *   could ride in.
 * - `prices_assertable: false` at the top level means no offering on this
 *   turn may be quoted. An empty or unconfigured catalog has to be a
 *   refusal, not an invitation to improvise.
 * - Descriptions are authored text and are sanitized before leaving the
 *   backend: an offering blurb cannot become an instruction.
 *
 * Sits under `/api/agent/`, so the proxy already requires the orchestrator
 * key and a valid HMAC signature. No query parameters on purpose: the
 * workspace comes from BUSINESS_WORKSPACE_SLUG, never from the caller.
 */
export async function GET() {
  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch (error) {
    // Unconfigured tenant = empty catalog, same degradation contract the
    // workflow already handles: the agent declines to quote.
    logger.warn({ event: 'catalog.business_config_missing', error: String(error) });
    return NextResponse.json(buildBusinessCatalogView([], { now: Date.now() }), { status: 200 });
  }

  try {
    const raw = await businessContextStore.loadBusinessContext(workspaceSlug);
    const offerings = raw ? buildBusinessContextView(raw) : null;
    // Both counts are carried in from the context view rather than recomputed:
    // its input was already sliced to the same `maxOfferings` bound and already
    // scanned for injection, so a view built from its output would find nothing
    // to report and would tell the caller `dropped: 0` on a truncated catalog.
    const truncated = offerings?.offerings_truncated ?? 0;
    const injectionSuspected = offerings?.injection_suspected_count ?? 0;
    const view = buildBusinessCatalogView(offerings?.offerings ?? [], {
      now: Date.now(),
      droppedUpstream: truncated,
      injectionSuspectedCount: injectionSuspected,
    });

    counter.increment('catalog_lookups');
    if (raw === null) {
      logger.warn({ event: 'catalog.workspace_missing' });
    }
    if (injectionSuspected > 0) {
      logger.warn({ event: 'catalog.injection_suspected', suspected: injectionSuspected });
    }
    if (truncated > 0) {
      logger.info({ event: 'catalog.capped', dropped: truncated });
    }

    return NextResponse.json(view, { status: 200 });
  } catch (error) {
    counter.increment('catalog_lookup_failures');
    // Degrade, never block: the workflow treats this as "no catalog available"
    // and the agent falls back to not quoting anything. 503 = genuinely
    // transient (DB/network), the one case where a single retry makes sense.
    logger.error({ event: 'catalog.list.failed', error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
