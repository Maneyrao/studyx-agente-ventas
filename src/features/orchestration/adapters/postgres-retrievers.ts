import { sql } from '@/lib/db/orchestrator';
import { generateEmbedding } from '@/lib/embeddings/gemini';
import type { DbClient } from '@/lib/db/types';
import type {
  KnowledgeRetriever,
  MemoryRetriever,
  RetrievedKnowledge,
  RetrievedMemory,
} from '../ports/retrieval';

/**
 * pgvector-backed implementations of the two advisory retrieval ports.
 *
 * Both embed the query with Gemini and then run a similarity search. Either
 * step can fail — missing key, provider outage, index unavailable — and both
 * are allowed to: the use case wraps these calls in `allSettled` and degrades.
 * They therefore throw honestly instead of returning an empty result, so a
 * failure is never mistaken for "nothing relevant".
 */

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export class PostgresMemoryRetriever implements MemoryRetriever {
  constructor(
    private readonly db: DbClient = sql,
    private readonly embed: (text: string) => Promise<number[]> = generateEmbedding
  ) {}

  async search(input: {
    contact_id: string;
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedMemory[]> {
    if (!input.contact_id) throw new Error('contact_id is required');

    const embedding = await this.embed(input.query);

    // `search_contact_memory` is already contact-scoped in SQL; the parameter
    // below is the only contact this can ever read, so cross-contact leakage is
    // a schema-level impossibility rather than a caller convention.
    const rows = await this.db<Array<{
      message_id: string;
      content: string;
      similarity: number;
      created_at: Date;
    }>>`
      SELECT message_id, content, similarity, created_at
      FROM search_contact_memory(
        ${input.contact_id}::uuid,
        ${toVectorLiteral(embedding)}::extensions.vector,
        ${Math.min(Math.max(input.limit, 1), 20)}
      )
    `;

    // The similarity floor is applied here rather than in SQL because
    // `search_contact_memory` predates it; below the floor a "match" is noise
    // and noise in the prompt is worse than no memory at all.
    return rows
      .filter((row) => row.similarity >= input.min_similarity)
      .slice(0, input.limit)
      .map((row) => ({
        memory_id: row.message_id,
        type: 'conversation_excerpt',
        key: 'recalled_message',
        value: row.content,
        source_quote: row.content,
        similarity: row.similarity,
        recorded_at: row.created_at.toISOString(),
      }));
  }
}

export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly db: DbClient = sql,
    private readonly embed: (text: string) => Promise<number[]> = generateEmbedding
  ) {}

  async search(input: {
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedKnowledge[]> {
    const embedding = await this.embed(input.query);

    const rows = await this.db<Array<{
      source_uri: string;
      title: string;
      content: string;
      similarity: number;
    }>>`
      SELECT source_uri, title, content, similarity
      FROM search_knowledge_base(
        ${toVectorLiteral(embedding)}::extensions.vector,
        ${Math.min(Math.max(input.limit, 1), 20)},
        ${input.min_similarity}
      )
    `;

    return rows.map((row) => ({
      source_uri: row.source_uri,
      title: row.title,
      content: row.content,
      similarity: row.similarity,
    }));
  }
}

export const memoryRetriever = new PostgresMemoryRetriever();
export const knowledgeRetriever = new PostgresKnowledgeRetriever();
