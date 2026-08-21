import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { memoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';
import { runSelectedMemoryEmbeddingWorker } from '@/lib/services/selected-memory-embedding-worker.service';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId = `memory-cron:${randomUUID()}`;
  const expired = await memoryStore.expireDueMemories(100);
  if (expired.length > 0) counter.increment('memory_expired', expired.length);

  const result = await runSelectedMemoryEmbeddingWorker({
    worker_id: workerId,
    limit: 2,
    lease_seconds: 45,
    deadline_ms: 45_000,
  });
  const response = { expired: expired.length, ...result };
  logger.info({ event: 'cron.memory_maintenance', worker_id: workerId, ...response });
  return NextResponse.json(response, { status: 200 });
}
