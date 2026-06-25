import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/orchestrator';
import { generateEmbedding } from '@/lib/embeddings/openai';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';

// Vercel Cron injects Authorization: Bearer <CRON_SECRET> automatically in production.
// Set CRON_SECRET manually in .env.local for local development.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const pending = await sql<{ id: string; message_id: string; contact_id: string }[]>`
    SELECT me.id, me.message_id, me.contact_id
    FROM message_embeddings me
    WHERE me.status = 'pending'
    ORDER BY me.created_at
    LIMIT 50
  `;

  let processed = 0;
  let failed = 0;

  for (const row of pending) {
    const messages = await sql<{ content: string }[]>`
      SELECT content FROM messages WHERE id = ${row.message_id} LIMIT 1
    `;
    if (messages.length === 0) continue;

    try {
      const embedding = await generateEmbedding(messages[0].content);
      await sql`
        UPDATE message_embeddings
        SET embedding = ${JSON.stringify(embedding)}::extensions.vector, status = 'indexed'
        WHERE id = ${row.id}
      `;
      processed++;
    } catch {
      failed++;
      counter.increment('pending_embeddings');
    }
  }

  logger.info({ event: 'cron.retry_embeddings', processed, failed });
  return NextResponse.json({ processed, failed }, { status: 200 });
}
