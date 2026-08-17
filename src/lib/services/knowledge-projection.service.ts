import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { generateEmbedding } from '@/lib/embeddings/gemini';

/**
 * Projection of canonical `knowledge_sources` into the derived search index
 * (`knowledge_documents` + `knowledge_chunks`, vector(768)).
 *
 * The index stays reconstructible: a source is projected under a stable URI
 * per workspace/source, and the document version mirrors the source's own
 * `version`. Re-running the projection is a no-op for every (uri, version)
 * already present, so the job can run after any reset or source edit without
 * duplicating documents.
 */
export function knowledgeSourceUri(workspaceId: string, sourceId: string): string {
  return `workspace/${workspaceId}/knowledge-source/${sourceId}`;
}

interface ProjectionDeps {
  sql: typeof orchestratorSql;
  embed: (text: string) => Promise<number[]>;
}

interface SourceRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  version: number;
}

export async function projectKnowledgeSources(
  input: { workspace_id: string },
  deps: Partial<ProjectionDeps> = {}
): Promise<{ projected: number; skipped: number }> {
  const sql = deps.sql ?? orchestratorSql;
  const embed = deps.embed ?? generateEmbedding;

  const sources = await sql<SourceRow[]>`
    SELECT id, workspace_id, title, content, version
    FROM knowledge_sources
    WHERE workspace_id = ${input.workspace_id}::uuid AND status = 'active'
    ORDER BY id
  `;

  let projected = 0;
  let skipped = 0;

  for (const source of sources) {
    const uri = knowledgeSourceUri(source.workspace_id, source.id);
    const inserted = await sql<Array<{ id: string }>>`
      INSERT INTO knowledge_documents (uri, title, source_type, version)
      VALUES (${uri}, ${source.title}, 'manual', ${source.version})
      ON CONFLICT (uri, version) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      skipped += 1;
      continue;
    }

    // Sources are short curated texts; one chunk per source keeps the
    // projection deterministic. token_count is a chars/4 estimate — the
    // index only uses it as metadata, retrieval quality comes from content.
    const embedding = await embed(source.content);
    await sql`
      INSERT INTO knowledge_chunks (document_id, chunk_index, content, token_count, embedding)
      VALUES (
        ${inserted[0].id}::uuid,
        0,
        ${source.content},
        ${Math.max(1, Math.ceil(source.content.length / 4))},
        ${JSON.stringify(embedding)}::extensions.vector
      )
      ON CONFLICT (document_id, chunk_index) DO NOTHING
    `;
    projected += 1;
  }

  counter.increment('knowledge_sources_projected');
  logger.info({
    event: 'knowledge_projection.completed',
    workspace_id: input.workspace_id,
    sources_seen: sources.length,
    projected,
    skipped,
  });

  return { projected, skipped };
}
