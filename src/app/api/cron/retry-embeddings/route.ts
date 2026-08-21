import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/orchestrator';
import { generateDocumentEmbedding, isTerminalEmbeddingConfigurationError } from '@/lib/embeddings/gemini';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';
import { randomUUID } from 'node:crypto';

// Vercel Cron injects Authorization: Bearer <CRON_SECRET> automatically in production.
// Set CRON_SECRET manually in .env.local for local development.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const workerId = `embedding-cron:${randomUUID()}`;
  const pending = await sql<Array<{
    id: string;
    message_id: string;
    contact_id: string;
    attempt_count: number;
    max_attempts: number;
  }>>`
    SELECT id, message_id, contact_id, attempt_count, max_attempts
    FROM claim_embedding_jobs(${workerId}, ${10}, ${60})
  `;

  let processed = 0;
  let failed = 0;

  for (const row of pending) {
    const messages = await sql<{ content: string }[]>`
      SELECT content FROM messages WHERE id = ${row.message_id} LIMIT 1
    `;
    if (messages.length === 0) {
      await sql`
        UPDATE embedding_jobs
        SET status = 'skipped', completed_at = now(), lease_until = NULL, leased_by = NULL,
            last_error_code = 'MESSAGE_NOT_FOUND'
        WHERE id = ${row.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
      `;
      continue;
    }

    try {
      const embedding = await generateDocumentEmbedding({
        title: 'message',
        text: messages[0].content,
        kind: 'message',
      });
      await sql`
        UPDATE message_embeddings
        SET embedding = ${JSON.stringify(embedding)}::extensions.vector, status = 'indexed'
        WHERE message_id = ${row.message_id}::uuid
          AND contact_id = ${row.contact_id}::uuid
          AND status = 'pending'
      `;
      processed++;
    } catch (error) {
      failed++;
      counter.increment('pending_embeddings');
      const terminal = isTerminalEmbeddingConfigurationError(error) || row.attempt_count >= row.max_attempts;
      const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, row.attempt_count - 1));
      await sql`
        UPDATE embedding_jobs
        SET
          status = ${terminal ? 'dead_letter' : 'failed_retryable'},
          available_at = now() + make_interval(secs => ${retryDelaySeconds}),
          lease_until = NULL,
          leased_by = NULL,
          last_error_code = ${terminal ? 'MAX_ATTEMPTS_EXHAUSTED' : 'EMBEDDING_PROVIDER_ERROR'},
          last_error_detail = ${String(error).slice(0, 1000)}
        WHERE id = ${row.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
      `;
    }
  }

  logger.info({ event: 'cron.retry_embeddings', worker_id: workerId, claimed: pending.length, processed, failed });
  return NextResponse.json({ claimed: pending.length, processed, failed }, { status: 200 });
}
