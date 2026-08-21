import { randomUUID } from 'node:crypto';
import {
  drainDurableQueue,
  requireGeminiApiKey,
  resolveLocalQueueDatabaseUrl,
} from './lib/durable-queue-cli';

async function main() {
  requireGeminiApiKey();
  process.env.DATABASE_URL = resolveLocalQueueDatabaseUrl();
  const { runMessageEmbeddingWorker } = await import('../src/lib/services/message-embedding-worker.service');
  const workerId = `message-embedding-cli:${randomUUID()}`;
  const totals = await drainDurableQueue(
    (id) => runMessageEmbeddingWorker({ worker_id: id, limit: 2, deadline_ms: 45_000 }),
    workerId,
  );
  console.log(JSON.stringify(totals));
  if (totals.failed > 0 || (totals.lease_lost ?? 0) > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
