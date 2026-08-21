import { sql } from '@/lib/db/orchestrator';
import { EMBEDDING_EPOCH, generateQueryEmbedding } from '@/lib/embeddings/gemini';
import { loadBusinessWorkspaceConfig } from '@/lib/config';
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
    private readonly embed: (text: string) => Promise<number[]> = generateQueryEmbedding
  ) {}

  async search(input: {
    contact_id: string;
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedMemory[]> {
    if (!input.contact_id) throw new Error('contact_id is required');

    const embedding = await this.embed(input.query);

    // Fase 4: la memoria de largo plazo ya no es "todo mensaje vectorizado"
    // sino `selected_memories`, y sólo las filas `active` con vigencia abierta.
    // `search_selected_memories` es contact-scoped en SQL: el parámetro de abajo
    // es el único contacto que esta consulta puede leer, así que la fuga entre
    // contactos es imposible por esquema, no por convención del llamador.
    const rows = await this.db<Array<{
      memory_id: string;
      memory_type: string;
      memory_key: string;
      value_text: string;
      source_quote: string;
      similarity: number;
      recorded_at: Date;
    }>>`
      SELECT memory_id, memory_type, memory_key, value_text, source_quote, similarity, recorded_at
      FROM search_selected_memories(
        ${input.contact_id}::uuid,
        ${toVectorLiteral(embedding)}::extensions.vector,
        ${EMBEDDING_EPOCH},
        ${Math.min(Math.max(input.limit, 1), 20)},
        ${input.min_similarity}
      )
    `;

    return rows.slice(0, input.limit).map((row) => ({
      memory_id: row.memory_id,
      type: row.memory_type,
      key: row.memory_key,
      value: row.value_text,
      source_quote: row.source_quote,
      similarity: row.similarity,
      recorded_at: row.recorded_at.toISOString(),
    }));
  }
}

export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  private workspaceIdPromise: Promise<string> | null = null;

  /**
   * The tenant is bound at construction, never taken from search input: the
   * default resolver maps BUSINESS_WORKSPACE_SLUG (backend configuration) to
   * a workspaces row. If the slug is missing or the workspace does not
   * exist, search throws — the claim path treats that as "knowledge base
   * unavailable" and degrades. It never falls back to another tenant's data.
   */
  constructor(
    private readonly db: DbClient = sql,
    private readonly embed: (text: string) => Promise<number[]> = generateQueryEmbedding,
    private readonly resolveWorkspaceId: () => Promise<string> = async () => {
      const { workspaceSlug } = loadBusinessWorkspaceConfig();
      const rows = await db<Array<{ id: string }>>`
        SELECT id FROM workspaces WHERE slug = ${workspaceSlug} AND status = 'active'
      `;
      if (rows.length === 0) {
        throw new Error(`BUSINESS_WORKSPACE_NOT_FOUND:${workspaceSlug}`);
      }
      return rows[0].id;
    }
  ) {}

  private workspaceId(): Promise<string> {
    // Memoized: workspace ids are stable for the lifetime of a deployment.
    // A failed resolution is not cached so a transient DB error can recover.
    if (!this.workspaceIdPromise) {
      this.workspaceIdPromise = this.resolveWorkspaceId().catch((error) => {
        this.workspaceIdPromise = null;
        throw error;
      });
    }
    return this.workspaceIdPromise;
  }

  async search(input: {
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedKnowledge[]> {
    const workspaceId = await this.workspaceId();
    const embedding = await this.embed(input.query);

    const rows = await this.db<Array<{
      source_uri: string;
      title: string;
      content: string;
      similarity: number;
    }>>`
      SELECT source_uri, title, content, similarity
      FROM search_knowledge_base(
        ${workspaceId}::uuid,
        ${toVectorLiteral(embedding)}::extensions.vector,
        ${EMBEDDING_EPOCH},
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
