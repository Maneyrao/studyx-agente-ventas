import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/orchestrator';
import { generateDocumentEmbedding, isTerminalEmbeddingConfigurationError } from '@/lib/embeddings/gemini';
import { memoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';

/**
 * Maintenance sweep for selected memories.
 *
 * Two jobs, both deliberately out of the conversational path:
 *
 * 1. **Expiry.** A memory past its validity stops being recoverable and loses
 *    its vector. Reading already honours validity, so this sweep is about not
 *    keeping a stale vector indexed, not about correctness of a live turn.
 * 2. **Vectorization.** Embedding is asynchronous by design. If Gemini is down,
 *    memories simply stay `pending` and the conversation runs on structured
 *    facts, recent messages and the summary — which is the degradation the
 *    memory strategy promises.
 *
 * Nothing here can create, modify or delete the meaning of a memory. It only
 * moves derived state.
 */

const MAX_EMBEDDING_ATTEMPTS = 5;
const BATCH_SIZE = 20;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId = `memory-cron:${randomUUID()}`;
  const expired = await memoryStore.expireDueMemories(500);
  if (expired.length > 0) counter.increment('memory_expired', expired.length);

  const pending = await sql<Array<{
    memory_id: string;
    contact_id: string;
    value_text: string;
    attempts: number;
  }>>`
    SELECT memory_id, contact_id, value_text, attempts
    FROM claim_memory_embeddings(${BATCH_SIZE})
  `;

  let embedded = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const embedding = await generateDocumentEmbedding({
        title: 'selected memory',
        text: row.value_text,
        kind: 'selected-memory',
      });
      // The predicate re-checks the status: a memory superseded or expired
      // between the claim and now must not come back holding a fresh vector.
      await sql`
        UPDATE selected_memories
        SET
          embedding = ${JSON.stringify(embedding)}::extensions.vector,
          embedding_state = 'ready',
          embedding_last_error = NULL,
          embedding_updated_at = now()
        WHERE id = ${row.memory_id}::uuid
          AND status IN ('accepted', 'active')
          AND embedding_state = 'pending'
      `;
      embedded += 1;
    } catch (error) {
      failed += 1;
      const terminal = isTerminalEmbeddingConfigurationError(error) || row.attempts >= MAX_EMBEDDING_ATTEMPTS;
      await sql`
        UPDATE selected_memories
        SET
          embedding_state = ${terminal ? 'failed' : 'pending'},
          embedding_last_error = ${String(error).slice(0, 1000)},
          embedding_updated_at = now()
        WHERE id = ${row.memory_id}::uuid AND embedding_state = 'pending'
      `;
      counter.increment('memory_embedding_failures');
    }
  }

  logger.info({
    event: 'cron.memory_maintenance',
    worker_id: workerId,
    expired: expired.length,
    claimed: pending.length,
    embedded,
    failed,
  });

  return NextResponse.json(
    { expired: expired.length, claimed: pending.length, embedded, failed },
    { status: 200 }
  );
}
