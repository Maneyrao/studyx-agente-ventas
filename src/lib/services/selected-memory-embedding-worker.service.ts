import {
  EMBEDDING_EPOCH,
  generateDocumentEmbedding,
  isTerminalEmbeddingConfigurationError,
  type EmbeddingRequestOptions,
} from '@/lib/embeddings/gemini';
import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import type { EmbeddingWorkerResult } from './message-embedding-worker.service';
import {
  runDeadlineQuery,
  WorkerDeadline,
  WorkerDeadlineExceeded,
} from './durable-worker-deadline';

interface SelectedMemoryEmbeddingWorkerDeps {
  sql: typeof orchestratorSql;
  embed: (
    input: { title: string; text: string; kind: string },
    options?: EmbeddingRequestOptions,
  ) => Promise<number[]>;
}

interface ClaimedMemory {
  memory_id: string;
  contact_id: string;
  value_text: string;
  attempts: number;
  max_attempts: number;
}

const MAX_BATCH_SIZE = 2;
const DEFAULT_DEADLINE_MS = 45_000;
const MIN_OPERATION_BUDGET_MS = 25;

function backoffSeconds(attempt: number): number {
  return Math.min(3_600, 30 * 2 ** Math.max(0, attempt - 1));
}

export async function runSelectedMemoryEmbeddingWorker(
  input: { worker_id: string; limit?: number; lease_seconds?: number; deadline_ms?: number },
  deps: Partial<SelectedMemoryEmbeddingWorkerDeps> = {},
): Promise<EmbeddingWorkerResult> {
  const sql = deps.sql ?? orchestratorSql;
  const embed = deps.embed ?? generateDocumentEmbedding;
  const limit = Math.min(Math.max(input.limit ?? MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const leaseSeconds = Math.min(Math.max(input.lease_seconds ?? 45, 20), 300);
  const deadline = new WorkerDeadline(input.deadline_ms ?? DEFAULT_DEADLINE_MS);
  const result: EmbeddingWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    lease_lost: 0,
    deadline_reached: false,
  };

  while (result.claimed < limit) {
    if (deadline.remainingMs() < MIN_OPERATION_BUDGET_MS) {
      result.deadline_reached = true;
      break;
    }
    let rows: ClaimedMemory[];
    try {
      rows = await runDeadlineQuery(deadline, 'claim-selected-memory', () => sql<ClaimedMemory[]>`
        SELECT memory_id, contact_id, value_text, attempts, max_attempts
        FROM claim_memory_embeddings(${input.worker_id}, 1, ${leaseSeconds})
      `);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        result.deadline_reached = true;
        break;
      }
      throw error;
    }
    const memory = rows[0];
    if (!memory) break;
    result.claimed += 1;

    try {
      const vector = await deadline.run('embed-selected-memory', (signal) => embed({
        title: 'selected memory',
        text: memory.value_text,
        kind: 'selected-memory',
      }, { signal, timeout_ms: deadline.remainingMs() }));
      const completed = await runDeadlineQuery(deadline, 'complete-selected-memory', () => sql<Array<{ id: string }>>`
          UPDATE selected_memories
          SET embedding = ${JSON.stringify(vector)}::extensions.vector,
              embedding_epoch = ${EMBEDDING_EPOCH},
              embedding_state = 'ready',
              embedding_last_error = NULL,
              embedding_updated_at = now(),
              lease_until = NULL,
              leased_by = NULL
          WHERE id = ${memory.memory_id}::uuid
            AND contact_id = ${memory.contact_id}::uuid
            AND status IN ('accepted', 'active')
            AND embedding_state = 'leased'
            AND leased_by = ${input.worker_id}
            AND lease_until > now()
          RETURNING id
      `);
      if (completed.length === 1) result.completed += 1;
      else result.lease_lost += 1;
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        result.deadline_reached = true;
        break;
      }
      const terminalConfiguration = isTerminalEmbeddingConfigurationError(error);
      const terminal = terminalConfiguration || memory.attempts >= memory.max_attempts;
      let failed: Array<{ id: string }>;
      try {
        failed = await runDeadlineQuery(deadline, 'fail-selected-memory', () => sql<Array<{ id: string }>>`
          UPDATE selected_memories
          SET embedding_state = ${terminal ? 'dead_letter' : 'failed_retryable'},
              embedding_available_at = now() + make_interval(secs => ${backoffSeconds(memory.attempts)}),
              embedding_last_error = ${String(error).slice(0, 1000)},
              embedding_updated_at = now(),
              lease_until = NULL,
              leased_by = NULL
          WHERE id = ${memory.memory_id}::uuid
            AND embedding_state = 'leased'
            AND leased_by = ${input.worker_id}
            AND lease_until > now()
          RETURNING id
        `);
      } catch (failureError) {
        if (failureError instanceof WorkerDeadlineExceeded) {
          result.deadline_reached = true;
          break;
        }
        throw failureError;
      }
      if (failed.length === 1) result.failed += 1;
      else result.lease_lost += 1;
    }
  }

  return result;
}
