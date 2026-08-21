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
  const totals = await runKnowledgeProjectionWorker({
    worker_id: workerId,
    limit: 2,
    lease_seconds: 45,
    deadline_ms: 45_000,
  });

  logger.info({ event: 'cron.project_knowledge', worker_id: workerId, ...totals });
  return NextResponse.json(totals, { status: 200 });
}
