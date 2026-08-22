import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { flushSheetProjections } from '@/lib/services/projection.service';
import { logger } from '@/lib/observability/structured-log';

/**
 * Drains `sheet_projection_rows`: the outbox that `enqueueLeadProjection`
 * fills after a lead-affecting signal is delivered on the customer channel
 * (docs/contracts/agent-a-operational-mvp.md §5). This is the ONLY runtime
 * entry point of the Sheets projection worker — it is never called inline
 * from a request path, and a Google failure here only leaves the row
 * pending/retryable; it never reverts the canonical message or decision.
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
