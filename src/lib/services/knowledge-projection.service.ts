import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { generateEmbedding } from '@/lib/embeddings/gemini';

/**
 * Durable projection of canonical `knowledge_sources` into the derived search
 * index (`knowledge_documents` + `knowledge_chunks`, vector(768)).
 *
 * Work arrives through `knowledge_projection_jobs`: a database trigger on
 * knowledge_sources enqueues one job per (workspace, source, version) and this
 * worker drains the queue under a lease (claim_knowledge_projection_jobs,
 * SKIP LOCKED). The projection itself is idempotent:
 *   - the document is keyed by (uri, version) with a stable per-source URI;
 *   - the chunk upsert repairs a document that exists without its chunk and
 *     refreshes content when a source was edited in place;
 *   - once a version is projected, older versions of the same URI are
 *     archived so stale facts stop serving.
 *
 * The embedding call happens OUTSIDE the write transaction; only the
 * document + chunk + job-completion writes share one atomic transaction.
 */
export function knowledgeSourceUri(workspaceId: string, sourceId: string): string {
  return `workspace/${workspaceId}/knowledge-source/${sourceId}`;
}

interface WorkerDeps {
  sql: typeof orchestratorSql;
  embed: (text: string) => Promise<number[]>;
}

interface ClaimedJob {
  id: string;
  workspace_id: string;
  source_id: string;
  source_version: number;
  attempt_count: number;
  max_attempts: number;
}

interface SourceRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  version: number;
  status: string;
}

export interface ProjectionWorkerResult {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
}

const MAX_BACKOFF_SECONDS = 3600;

function backoffSeconds(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, attemptCount - 1));
}

export async function runKnowledgeProjectionWorker(
  input: { worker_id: string; limit?: number; lease_seconds?: number },
  deps: Partial<WorkerDeps> = {}
): Promise<ProjectionWorkerResult> {
  const sql = deps.sql ?? orchestratorSql;
  const embed = deps.embed ?? generateEmbedding;
  const limit = input.limit ?? 10;
  const leaseSeconds = input.lease_seconds ?? 120;

  const jobs = await sql<ClaimedJob[]>`
    SELECT id, workspace_id, source_id, source_version, attempt_count, max_attempts
    FROM claim_knowledge_projection_jobs(${input.worker_id}, ${limit}, ${leaseSeconds})
  `;

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const sources = await sql<SourceRow[]>`
      SELECT id, workspace_id, title, content, version, status
      FROM knowledge_sources
      WHERE id = ${job.source_id}::uuid AND workspace_id = ${job.workspace_id}::uuid
    `;
    const source = sources[0];

    if (!source || source.status === 'archived') {
      // Nothing to project: the source vanished or was archived after the
      // job was enqueued (the archive trigger already hid its documents).
      await sql`
        UPDATE knowledge_projection_jobs
        SET status = 'skipped', lease_until = NULL, leased_by = NULL,
            last_error_code = ${source ? 'SOURCE_ARCHIVED' : 'SOURCE_NOT_FOUND'}
        WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
      `;
      skipped += 1;
      continue;
    }

    try {
      // Network call strictly outside any transaction.
      const embedding = await embed(source.content);
      const uri = knowledgeSourceUri(source.workspace_id, source.id);
      const tokenCount = Math.max(1, Math.ceil(source.content.length / 4));

      await sql.begin(async (tx) => {
        const inserted = await tx<Array<{ id: string }>>`
          INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
          VALUES (${uri}, ${source.title}, 'manual', ${source.version}, ${source.workspace_id}::uuid)
          ON CONFLICT (uri, version) DO NOTHING
          RETURNING id
        `;
        let documentId = inserted[0]?.id;
        if (!documentId) {
          const existing = await tx<Array<{ id: string }>>`
            SELECT id FROM knowledge_documents
            WHERE uri = ${uri} AND version = ${source.version}
              AND workspace_id = ${source.workspace_id}::uuid
          `;
          if (!existing[0]) {
            // A (uri, version) document exists but belongs to nobody or to a
            // different tenant; never adopt it.
            throw new Error('DOCUMENT_TENANT_MISMATCH');
          }
          documentId = existing[0].id;
        }

        // Upsert instead of DO NOTHING: repairs a document that lost its
        // chunk and refreshes content for in-place source edits. Sources are
        // short curated texts; one chunk per source keeps this deterministic.
        await tx`
          INSERT INTO knowledge_chunks (document_id, chunk_index, content, token_count, embedding)
          VALUES (
            ${documentId}::uuid,
            0,
            ${source.content},
            ${tokenCount},
            ${JSON.stringify(embedding)}::extensions.vector
          )
          ON CONFLICT (document_id, chunk_index) DO UPDATE
          SET content = EXCLUDED.content,
              token_count = EXCLUDED.token_count,
              embedding = EXCLUDED.embedding
        `;

        // The freshly projected version supersedes older ones.
        await tx`
          UPDATE knowledge_documents
          SET archived_at = now()
          WHERE uri = ${uri}
            AND workspace_id = ${source.workspace_id}::uuid
            AND version < ${source.version}
            AND archived_at IS NULL
        `;

        await tx`
          UPDATE knowledge_projection_jobs
          SET status = 'completed', completed_at = now(),
              lease_until = NULL, leased_by = NULL,
              last_error_code = NULL, last_error_detail = NULL
          WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
        `;
      });

      completed += 1;
      counter.increment('knowledge_sources_projected');
    } catch (error) {
      failed += 1;
      const terminal = job.attempt_count >= job.max_attempts;
      await sql`
        UPDATE knowledge_projection_jobs
        SET
          status = ${terminal ? 'dead_letter' : 'failed_retryable'},
          available_at = now() + make_interval(secs => ${backoffSeconds(job.attempt_count)}),
          lease_until = NULL,
          leased_by = NULL,
          last_error_code = ${terminal ? 'MAX_ATTEMPTS_EXHAUSTED' : 'PROJECTION_FAILED'},
          last_error_detail = ${String(error).slice(0, 1000)}
        WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
      `;
      logger.error({
        event: 'knowledge_projection.job_failed',
        job_id: job.id,
        workspace_id: job.workspace_id,
        source_id: job.source_id,
        source_version: job.source_version,
        attempt_count: job.attempt_count,
        terminal,
        error: String(error).slice(0, 500),
      });
    }
  }

  logger.info({
    event: 'knowledge_projection.worker_completed',
    worker_id: input.worker_id,
    claimed: jobs.length,
    completed,
    failed,
    skipped,
  });

  return { claimed: jobs.length, completed, failed, skipped };
}
