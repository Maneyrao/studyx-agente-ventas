import { NextRequest, NextResponse } from 'next/server';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
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
    const raw = await businessContextStore.loadBusinessContext(workspaceSlug);
    if (raw === null) {
      logger.warn({ event: 'catalog.detail.workspace_missing' });
      return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
    }

    const context = buildBusinessContextView(raw);
    const view = buildBusinessCatalogView(context.offerings, { now: Date.now() });
    const item = view.items.find((candidate) => candidate.sku === sku);
    if (!item) {
      return NextResponse.json({ error: 'NOT_FOUND', sku }, { status: 404 });
    }

    return NextResponse.json({ ...item, as_of: view.as_of }, { status: 200 });
  } catch (error) {
    logger.error({ event: 'catalog.detail.failed', sku, error: String(error) });
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
