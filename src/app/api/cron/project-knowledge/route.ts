import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { runKnowledgeProjectionWorker } from '@/lib/services/knowledge-projection.service';
import { logger } from '@/lib/observability/structured-log';

/**
 * Drains knowledge_projection_jobs: the durable queue that a database trigger
 * fills whenever a knowledge_source is created or edited. This is the ONLY
 * runtime entry point of the projection worker — the projection is not called
 * inline from any request path.
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

  const workerId = `knowledge-projection-cron:${randomUUID()}`;
  const totals = { claimed: 0, completed: 0, failed: 0, skipped: 0 };

  // Drain until the queue has no claimable jobs, with a hard round bound so a
  // pathological queue can never pin the cron invocation.
  for (let round = 0; round < 20; round++) {
    const result = await runKnowledgeProjectionWorker({ worker_id: workerId, limit: 20 });
    totals.claimed += result.claimed;
    totals.completed += result.completed;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
    if (result.claimed === 0) break;
  }

  logger.info({ event: 'cron.project_knowledge', worker_id: workerId, ...totals });
  return NextResponse.json(totals, { status: 200 });
}
