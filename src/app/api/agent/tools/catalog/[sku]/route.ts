import { NextRequest, NextResponse } from 'next/server';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
  buildBusinessCatalogView,
  buildBusinessContextView,
} from '@/features/orchestration/domain/business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';
import { logger } from '@/lib/observability/structured-log';

/**
 * GET /api/agent/tools/catalog/:sku
 *
 * One offering by code, from the SAME canonical source and view builder as
 * the /catalog list — offerings of the configured workspace, never the
 * legacy `products` table. Parity is by construction: the item served here
 * is the identical BusinessCatalogItem the list would contain.
 *
 * Fail closed, always as NOT_FOUND:
 *   - missing BUSINESS_WORKSPACE_SLUG (unconfigured tenant),
 *   - configured workspace absent or inactive,
 *   - offering inactive/draft/archived,
 *   - offering owned by any other workspace.
 * There is no code path that widens the lookup beyond the configured tenant,
 * and no query parameter can influence which workspace is read.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  const { sku } = await ctx.params;
  if (typeof sku !== 'string' || sku.trim() === '') {
    return NextResponse.json({ error: 'INVALID_SKU' }, { status: 400 });
  }

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch (error) {
    logger.warn({ event: 'catalog.detail.business_config_missing', error: String(error) });
    return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
  }

  try {
    const raw = await businessContextStore.loadBusinessCatalog(workspaceSlug, {
      // A detail lookup must not inherit the prompt/list cap. Still bounded so
      // malformed tenant data cannot create an unbounded response in memory.
      maxOfferings: 1_000,
    });
    if (raw === null) {
      logger.warn({ event: 'catalog.detail.workspace_missing' });
      return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
    }

    // Look through the whole catalog, not the capped slice. `maxOfferings`
    // exists to bound how much text goes into the agent's prompt; a lookup of
    // one sku puts nothing in a prompt, so applying the cap here only means an
    // offering past position N answers "NOT_FOUND" for a course the business
    // really sells — the same silent denial this endpoint's list counterpart
    // was fixed for. `maxTextChars` and the rest still apply: sanitization is
    // not what the cap is for.
    const context = buildBusinessContextView(raw, {
      ...DEFAULT_BUSINESS_CONTEXT_LIMITS,
      maxOfferings: raw.offerings.length,
    });
    // `maxItems` has to be lifted too: it defaults to the same `maxOfferings`,
    // so leaving it alone would re-apply the cap here and undo the line above.
    const view = buildBusinessCatalogView(context.offerings, {
      asOf: raw.as_of,
      maxItems: context.offerings.length,
      injectionSuspectedCount: context.injection_suspected_count,
    });
    const item = view.items.find((candidate) => candidate.sku === sku);
    if (!item) {
      return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
    }
    if (context.injection_suspected_count > 0) {
      logger.warn({
        event: 'catalog.detail.injection_suspected',
        suspected: context.injection_suspected_count,
      });
    }

    return NextResponse.json({ ...item, as_of: view.as_of }, { status: 200 });
  } catch (error) {
    logger.error({ event: 'catalog.detail.failed', sku, error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
