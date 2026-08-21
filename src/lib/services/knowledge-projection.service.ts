import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import {
  EMBEDDING_EPOCH,
  generateDocumentEmbedding,
  isTerminalEmbeddingConfigurationError,
  type EmbeddingRequestOptions,
} from '@/lib/embeddings/gemini';
import {
  runDeadlineTransaction,
  WorkerDeadline,
  WorkerDeadlineExceeded,
} from './durable-worker-deadline';

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
  embed: (text: string, options?: EmbeddingRequestOptions) => Promise<number[]>;
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
  lease_lost?: number;
  deadline_reached?: boolean;
}

const MAX_BACKOFF_SECONDS = 3600;
const MAX_BATCH_SIZE = 2;
const DEFAULT_DEADLINE_MS = 45_000;
const MIN_OPERATION_BUDGET_MS = 25;

function backoffSeconds(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, attemptCount - 1));
}

export async function runKnowledgeProjectionWorker(
  input: { worker_id: string; limit?: number; lease_seconds?: number; deadline_ms?: number },
  deps: Partial<WorkerDeps> = {}
): Promise<ProjectionWorkerResult> {
  const sql = deps.sql ?? orchestratorSql;
  const limit = Math.min(Math.max(input.limit ?? MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const leaseSeconds = Math.min(Math.max(input.lease_seconds ?? 45, 20), 300);
  const deadline = new WorkerDeadline(input.deadline_ms ?? DEFAULT_DEADLINE_MS);

  let claimed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let leaseLost = 0;
  let deadlineReached = false;

  while (claimed < limit) {
    if (deadline.remainingMs() < MIN_OPERATION_BUDGET_MS) {
      deadlineReached = true;
      break;
    }
    let jobs: ClaimedJob[];
    try {
      jobs = await runDeadlineTransaction(sql, deadline, 'claim-knowledge-projection', (tx) => tx<ClaimedJob[]>`
        SELECT id, workspace_id, source_id, source_version, attempt_count, max_attempts
        FROM claim_knowledge_projection_jobs(${input.worker_id}, 1, ${leaseSeconds})
      `);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      throw error;
    }
    const job = jobs[0];
    if (!job) break;
    claimed += 1;

    let sources: SourceRow[];
    try {
      sources = await runDeadlineTransaction(sql, deadline, 'load-knowledge-source', (tx) => tx<SourceRow[]>`
        SELECT id, workspace_id, title, content, version, status
        FROM knowledge_sources
        WHERE id = ${job.source_id}::uuid AND workspace_id = ${job.workspace_id}::uuid
      `);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      throw error;
    }
    const source = sources[0];

    if (!source || source.status === 'archived') {
      // Nothing to project: the source vanished or was archived after the
      // job was enqueued (the archive trigger already hid its documents).
      let skippedRows: Array<{ id: string }>;
      try {
        skippedRows = await runDeadlineTransaction(sql, deadline, 'skip-knowledge-source', (tx) => tx<Array<{ id: string }>>`
          UPDATE knowledge_projection_jobs
          SET status = 'skipped', lease_until = NULL, leased_by = NULL,
              last_error_code = ${source ? 'SOURCE_ARCHIVED' : 'SOURCE_NOT_FOUND'}
          WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
            AND lease_until > now()
          RETURNING id
        `);
      } catch (error) {
        if (error instanceof WorkerDeadlineExceeded) {
          deadlineReached = true;
          break;
        }
        throw error;
      }
      if (skippedRows.length === 1) skipped += 1;
      else leaseLost += 1;
      continue;
    }

    try {
      // Network call strictly outside any transaction.
      const embedding = await deadline.run('embed-knowledge-source', (signal) => deps.embed
        ? deps.embed(source.content, { signal, timeout_ms: deadline.remainingMs() })
        : generateDocumentEmbedding({
          title: source.title,
          text: source.content,
          kind: 'knowledge-source',
        }, { signal, timeout_ms: deadline.remainingMs() }));
      const uri = knowledgeSourceUri(source.workspace_id, source.id);
      const tokenCount = Math.max(1, Math.ceil(source.content.length / 4));

      const completion = await runDeadlineTransaction(sql, deadline, 'complete-knowledge-projection', async (tx) => {
        // Match the canonical writer's lock order: knowledge_sources first,
        // then its projection job. This avoids source-edit/job deadlocks and
        // closes the archive-during-Gemini race before any derived write.
        const liveSources = await tx<SourceRow[]>`
          SELECT id, workspace_id, title, content, version, status
          FROM knowledge_sources
          WHERE id = ${job.source_id}::uuid AND workspace_id = ${job.workspace_id}::uuid
          FOR UPDATE
        `;
        const owned = await tx<Array<{ id: string }>>`
          SELECT id FROM knowledge_projection_jobs
          WHERE id = ${job.id}::uuid AND status = 'leased'
            AND leased_by = ${input.worker_id} AND lease_until > now()
          FOR UPDATE
        `;
        if (owned.length !== 1) return 'lease_lost' as const;
        const liveSource = liveSources[0];
        if (!liveSource || liveSource.status !== 'active' || liveSource.version !== job.source_version) {
          const skippedJob = await tx<Array<{ id: string }>>`
            UPDATE knowledge_projection_jobs
            SET status = 'skipped', lease_until = NULL, leased_by = NULL,
                last_error_code = ${liveSource ? 'SOURCE_CHANGED_DURING_EMBEDDING' : 'SOURCE_NOT_FOUND'}
            WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
            RETURNING id
          `;
          if (skippedJob.length !== 1) throw new Error('KNOWLEDGE_JOB_SKIP_ROW_MISMATCH');
          return 'skipped' as const;
        }

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
          INSERT INTO knowledge_chunks (
            document_id, chunk_index, content, token_count, embedding, embedding_epoch
          )
          VALUES (
            ${documentId}::uuid,
            0,
            ${source.content},
            ${tokenCount},
            ${JSON.stringify(embedding)}::extensions.vector,
            ${EMBEDDING_EPOCH}
          )
          ON CONFLICT (document_id, chunk_index) DO UPDATE
          SET content = EXCLUDED.content,
              token_count = EXCLUDED.token_count,
              embedding = EXCLUDED.embedding,
              embedding_epoch = EXCLUDED.embedding_epoch
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

        const finalized = await tx<Array<{ id: string }>>`
          UPDATE knowledge_projection_jobs
          SET status = 'completed', completed_at = now(),
              lease_until = NULL, leased_by = NULL,
              last_error_code = NULL, last_error_detail = NULL
          WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
          RETURNING id
        `;
        if (finalized.length !== 1) throw new Error('KNOWLEDGE_JOB_COMPLETION_ROW_MISMATCH');
        return 'completed' as const;
      });

      if (completion === 'completed') {
        completed += 1;
        counter.increment('knowledge_sources_projected');
      } else if (completion === 'skipped') {
        skipped += 1;
      } else {
        leaseLost += 1;
      }
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      const terminalConfiguration = isTerminalEmbeddingConfigurationError(error);
      const terminal = terminalConfiguration || job.attempt_count >= job.max_attempts;
      let failedRows: Array<{ id: string }>;
      try {
        failedRows = await runDeadlineTransaction(sql, deadline, 'fail-knowledge-projection', (tx) => tx<Array<{ id: string }>>`
          UPDATE knowledge_projection_jobs
          SET
            status = ${terminal ? 'dead_letter' : 'failed_retryable'},
            available_at = now() + make_interval(secs => ${backoffSeconds(job.attempt_count)}),
            lease_until = NULL,
            leased_by = NULL,
            last_error_code = ${terminalConfiguration
              ? 'TERMINAL_CONFIGURATION'
              : terminal ? 'MAX_ATTEMPTS_EXHAUSTED' : 'PROJECTION_FAILED'},
            last_error_detail = ${String(error).slice(0, 1000)}
          WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
            AND lease_until > now()
          RETURNING id
        `);
      } catch (failureError) {
        if (failureError instanceof WorkerDeadlineExceeded) {
          deadlineReached = true;
          break;
        }
        throw failureError;
      }
      if (failedRows.length === 1) failed += 1;
      else leaseLost += 1;
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
    claimed,
    completed,
    failed,
    skipped,
  });

  return {
    claimed,
    completed,
    failed,
    skipped,
    lease_lost: leaseLost,
    deadline_reached: deadlineReached,
  };
}
