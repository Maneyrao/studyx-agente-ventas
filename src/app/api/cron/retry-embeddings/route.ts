import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runMessageEmbeddingWorker } from '@/lib/services/message-embedding-worker.service';
import { logger } from '@/lib/observability/structured-log';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId = `embedding-cron:${randomUUID()}`;
  const result = await runMessageEmbeddingWorker({
    worker_id: workerId,
    limit: 2,
    lease_seconds: 45,
    deadline_ms: 45_000,
  });
  logger.info({ event: 'cron.retry_embeddings', worker_id: workerId, ...result });
  return NextResponse.json(result, { status: 200 });
}
