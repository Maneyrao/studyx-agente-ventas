import { sql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { generateQueryEmbedding } from '@/lib/embeddings/gemini';
import { Message } from './message.service';

// ─── US3: Recent memory ──────────────────────────────────────────────────────

export async function getRecentMessages(params: {
  conversation_id: string;
  limit: number;
}): Promise<{ messages: Message[]; total: number }> {
  const { conversation_id, limit } = params;
  const safeLimit = Math.min(limit, 50);

  const messages = await sql<Message[]>`
    SELECT id, conversation_id, contact_id, direction, content, metadata, created_at
    FROM (
      SELECT id, conversation_id, contact_id, direction, content, metadata, created_at
      FROM messages
      WHERE conversation_id = ${conversation_id}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
    ) AS recent
    ORDER BY created_at ASC, id ASC
  `;

  logger.info({ event: 'memory.recent.fetched', conversation_id, count: messages.length });

  return { messages, total: messages.length };
}

// ─── US4: Semantic search ────────────────────────────────────────────────────

export interface SearchResult {
  message_id: string;
  contact_id: string;
  content: string;
  similarity: number;
  created_at: string;
}

export async function semanticSearch(params: {
  contact_id: string;
  query: string;
  limit: number;
}): Promise<{ results: SearchResult[]; total: number }> {
  const { contact_id, query, limit } = params;

  if (!contact_id) throw new Error('contact_id is required');

  const start = Date.now();
  const embedding = await generateQueryEmbedding(query);

  const results = await sql<SearchResult[]>`
    SELECT * FROM search_contact_memory(
      ${contact_id}::uuid,
      ${JSON.stringify(embedding)}::extensions.vector,
      ${Math.min(limit, 20)}
    )
  `;

  const duration_ms = Date.now() - start;
  counter.increment('semantic_searches_executed');
  logger.info({
    event: 'memory.search.executed',
    contact_id,
    results_count: results.length,
    duration_ms,
  });

  return { results, total: results.length };
}
