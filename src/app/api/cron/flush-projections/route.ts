import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { flushSheetProjections } from '@/lib/services/projection.service';
import { logger } from '@/lib/observability/structured-log';

/**
 * Drains `sheet_projection_rows`: the outbox that `enqueueLeadProjection`
 * fills as the lead progresses (docs/contracts/agent-a-operational-mvp.md §5).
 * Successful customer-path mutations also schedule a bounded drain with
 * Next.js `after()`; this cron is the recovery sweep for anything left
 * pending/retryable. A Google failure never reverts a canonical message or
 * decision.
 *
 * Vercel Cron injects Authorization: Bearer <CRON_SECRET> automatically in
 * production. Set CRON_SECRET manually in .env.local for local development.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId = `flush-projections-cron:${randomUUID()}`;
  const totals = await flushSheetProjections({
    worker_id: workerId,
    limit: 10,
    lease_seconds: 45,
    deadline_ms: 45_000,
  });

  logger.info({ event: 'cron.flush_projections', worker_id: workerId, ...totals });
  return NextResponse.json(totals, { status: 200 });
}
