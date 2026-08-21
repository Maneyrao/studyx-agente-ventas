import { sql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import {
  EMBEDDING_EPOCH,
  generateDocumentEmbedding,
  generateQueryEmbedding,
} from '@/lib/embeddings/gemini';

export interface KnowledgeResult {
  chunk_id: string;
  document_id: string;
  source_uri: string;
  title: string;
  content: string;
  similarity: number;
}

export interface KnowledgeDocument {
  id: string;
  uri: string;
  title: string;
  source_type: 'markdown' | 'text' | 'pdf' | 'html' | 'manual';
  version: number;
  ingested_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retrieval-augmented context. Fires a single vector search against the
 * curated knowledge base, scoped to exactly one workspace. The workspace id
 * must be resolved in the backend (BUSINESS_WORKSPACE_SLUG); it never comes
 * from model output or a request body. Callers should skip trivial turns
 * (see triviality heuristic) so we don't pay for embeddings on "gracias".
 *
 * Returns empty array if nothing meets p_min_similarity; throws only on
 * transport/embedding failures — the ingest path fails open (KB unavailable)
 * so a KB outage never blocks a turn.
 */
export async function searchKnowledgeBase(params: {
  workspace_id: string;
  query: string;
  limit: number;
  min_similarity: number;
}): Promise<{ results: KnowledgeResult[]; total: number }> {
  const { workspace_id, query, limit, min_similarity } = params;
  if (typeof workspace_id !== 'string' || !UUID_PATTERN.test(workspace_id)) {
    throw new Error('workspace_id must be a UUID resolved from backend configuration');
  }
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query is required');
  }

  const start = Date.now();
  const embedding = await generateQueryEmbedding(query);

  const results = await sql<KnowledgeResult[]>`
    SELECT * FROM search_knowledge_base(
      ${workspace_id}::uuid,
      ${JSON.stringify(embedding)}::extensions.vector,
      ${EMBEDDING_EPOCH},
      ${Math.min(limit, 20)},
      ${min_similarity}
    )
  `;

  const duration_ms = Date.now() - start;
  counter.increment('knowledge_base_searches_executed');
  logger.info({
    event: 'knowledge_base.search.executed',
    results_count: results.length,
    duration_ms,
    min_similarity,
  });

  return { results, total: results.length };
}

/**
 * Ingest a single document as a set of pre-chunked pieces. Each chunk is
 * embedded and stored. `chunks` must be in reading order; `chunk_index` is
 * derived from the array position and enforced UNIQUE per document.
 *
 * Version bump: if a document with the same uri already exists, ingest at
 * the next version so the current one keeps serving queries until the new
 * version is fully written. Old versions are NOT auto-deleted — call
 * pruneOldVersions() explicitly.
 */
export async function ingestDocument(input: {
  uri: string;
  title: string;
  source_type?: KnowledgeDocument['source_type'];
  /**
   * Owning tenant. Omitted/null marks a legacy global document, which is
   * excluded from every workspace-scoped search — it can never leak into a
   * tenant it was not written for.
   */
  workspace_id?: string | null;
  chunks: Array<{ content: string; token_count: number }>;
}): Promise<{ document_id: string; version: number; chunks_written: number }> {
  const { uri, title, source_type = 'markdown', workspace_id = null, chunks } = input;
  if (!uri || !title) throw new Error('uri and title are required');
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('chunks must be a non-empty array');
  }

  const existing = await sql<Array<{ max_version: number | null }>>`
    SELECT MAX(version) AS max_version
    FROM knowledge_documents
    WHERE uri = ${uri}
  `;
  const nextVersion = (existing[0]?.max_version ?? 0) + 1;

  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
    VALUES (${uri}, ${title}, ${source_type}, ${nextVersion}, ${workspace_id}::uuid)
    RETURNING id
  `;
  const document_id = inserted[0].id;

  let chunks_written = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = await generateDocumentEmbedding({
      title,
      text: c.content,
      kind: source_type,
    });
    await sql`
      INSERT INTO knowledge_chunks (
        document_id, chunk_index, content, token_count, embedding, embedding_epoch
      )
      VALUES (
        ${document_id}::uuid,
        ${i},
        ${c.content},
        ${c.token_count},
        ${JSON.stringify(embedding)}::extensions.vector,
        ${EMBEDDING_EPOCH}
      )
    `;
    chunks_written++;
  }

  counter.increment('knowledge_base_documents_ingested');
  logger.info({
    event: 'knowledge_base.document.ingested',
    document_id,
    uri,
    version: nextVersion,
    chunks_written,
  });

  return { document_id, version: nextVersion, chunks_written };
}
