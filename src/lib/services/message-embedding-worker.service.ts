import { EMBEDDING_EPOCH, generateDocumentEmbedding, isTerminalEmbeddingConfigurationError } from '@/lib/embeddings/gemini';
import { sql as orchestratorSql } from '@/lib/db/orchestrator';

interface MessageEmbeddingWorkerDeps {
  sql: typeof orchestratorSql;
  embed: (input: { title: string; text: string; kind: string }) => Promise<number[]>;
}

interface ClaimedMessageJob {
  id: string;
  message_id: string;
  contact_id: string;
  attempt_count: number;
  max_attempts: number;
}

const MAX_BATCH_SIZE = 2;
const DEFAULT_DEADLINE_MS = 45_000;
const MAX_DEADLINE_MS = 49_000;
const MIN_JOB_BUDGET_MS = 16_000;
const MAX_BACKOFF_SECONDS = 3_600;

function backoffSeconds(attempt: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, attempt - 1));
}

export interface EmbeddingWorkerResult {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  lease_lost: number;
  deadline_reached: boolean;
}

export async function runMessageEmbeddingWorker(
  input: { worker_id: string; limit?: number; lease_seconds?: number; deadline_ms?: number },
  deps: Partial<MessageEmbeddingWorkerDeps> = {},
): Promise<EmbeddingWorkerResult> {
  const sql = deps.sql ?? orchestratorSql;
  const embed = deps.embed ?? generateDocumentEmbedding;
  const limit = Math.min(Math.max(input.limit ?? MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const leaseSeconds = Math.min(Math.max(input.lease_seconds ?? 45, 20), 300);
  const deadlineMs = Math.min(Math.max(input.deadline_ms ?? DEFAULT_DEADLINE_MS, 1), MAX_DEADLINE_MS);
  const deadlineAt = Date.now() + deadlineMs;
  const result: EmbeddingWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    lease_lost: 0,
    deadline_reached: false,
  };

  while (result.claimed < limit) {
    if (Date.now() + MIN_JOB_BUDGET_MS > deadlineAt) {
      result.deadline_reached = true;
      break;
    }

    const jobs = await sql<ClaimedMessageJob[]>`
      SELECT id, message_id, contact_id, attempt_count, max_attempts
      FROM claim_embedding_jobs(${input.worker_id}, 1, ${leaseSeconds})
    `;
    const job = jobs[0];
    if (!job) break;
    result.claimed += 1;

    const messages = await sql<Array<{ content: string }>>`
      SELECT content FROM messages
      WHERE id = ${job.message_id}::uuid AND contact_id = ${job.contact_id}::uuid
    `;
    if (!messages[0]) {
      const skipped = await sql<Array<{ id: string }>>`
        UPDATE embedding_jobs
        SET status = 'skipped', completed_at = now(), lease_until = NULL, leased_by = NULL,
            last_error_code = 'MESSAGE_NOT_FOUND'
        WHERE id = ${job.id}::uuid
          AND status = 'leased' AND leased_by = ${input.worker_id} AND lease_until > now()
        RETURNING id
      `;
      if (skipped.length === 1) result.skipped += 1;
      else result.lease_lost += 1;
      continue;
    }

    try {
      const embedding = await embed({ title: 'message', text: messages[0].content, kind: 'message' });
      const completed = await sql.begin(async (tx) => {
        const owned = await tx<Array<{ id: string }>>`
          SELECT id FROM embedding_jobs
          WHERE id = ${job.id}::uuid
            AND status = 'leased' AND leased_by = ${input.worker_id} AND lease_until > now()
          FOR UPDATE
        `;
        if (owned.length !== 1) return false;

        const materialized = await tx<Array<{ message_id: string }>>`
          UPDATE message_embeddings
          SET embedding = ${JSON.stringify(embedding)}::extensions.vector,
              embedding_epoch = ${EMBEDDING_EPOCH},
              status = 'indexed'
          WHERE message_id = ${job.message_id}::uuid
            AND contact_id = ${job.contact_id}::uuid
            AND status = 'pending'
          RETURNING message_id
        `;
        if (materialized.length !== 1) throw new Error('MESSAGE_MATERIALIZATION_ROW_MISMATCH');

        const finalized = await tx<Array<{ id: string }>>`
          UPDATE embedding_jobs
          SET status = 'completed', completed_at = now(), lease_until = NULL, leased_by = NULL,
              last_error_code = NULL, last_error_detail = NULL
          WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
          RETURNING id
        `;
        if (finalized.length !== 1) throw new Error('MESSAGE_JOB_COMPLETION_ROW_MISMATCH');
        return true;
      });
      if (completed) result.completed += 1;
      else result.lease_lost += 1;
    } catch (error) {
      const terminalConfiguration = isTerminalEmbeddingConfigurationError(error);
      const terminal = terminalConfiguration || job.attempt_count >= job.max_attempts;
      const failed = await sql<Array<{ id: string }>>`
        UPDATE embedding_jobs
        SET status = ${terminal ? 'dead_letter' : 'failed_retryable'},
            available_at = now() + make_interval(secs => ${backoffSeconds(job.attempt_count)}),
            lease_until = NULL,
            leased_by = NULL,
            last_error_code = ${terminalConfiguration
              ? 'TERMINAL_CONFIGURATION'
              : terminal ? 'MAX_ATTEMPTS_EXHAUSTED' : 'EMBEDDING_PROVIDER_ERROR'},
            last_error_detail = ${String(error).slice(0, 1000)}
        WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${input.worker_id}
          AND lease_until > now()
        RETURNING id
      `;
      if (failed.length === 1) result.failed += 1;
      else result.lease_lost += 1;
    }
  }

  return result;
}
