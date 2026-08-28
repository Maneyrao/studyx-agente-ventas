import { auditLog } from '@/lib/audit/logger';
import { jsonbParam } from '@/lib/db/json';
import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { DecisionMemoryCandidate } from '@/features/orchestration/domain/decision';
import { selectMemories } from '@/features/orchestration/application/select-memories';
import { PostgresMemoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { normalizeMemoryText } from '@/features/orchestration/domain/memory-selection';
import {
  isAgentAMemoryCandidateProhibited,
  type AgentAMemoryCandidateV1,
} from '../domain/agent-a-memory-candidate';

const MEMORY_TYPES = new Set([
  'study_goal', 'study_context', 'preference', 'constraint',
  'objection', 'timeline', 'contact_preference',
]);

export async function enqueueAgentAMemoryProjectionJobs(input: {
  readonly db: DbClient;
  readonly decision_id: string;
  readonly turn_id: string;
  readonly candidates: readonly DecisionMemoryCandidate[];
}): Promise<number> {
  let enqueued = 0;
  for (const [candidateIndex, candidate] of input.candidates.slice(0, 20).entries()) {
    const type = normalizeMemoryText(candidate.type);
    const normalizedKey = normalizeMemoryText(candidate.key).replace(/[^a-z0-9_]/gu, '_').slice(0, 64);
    const key = normalizedKey.length > 0 ? normalizedKey : `candidate_${candidateIndex}`;
    const rows = await input.db<Array<{ decision_id: string }>>`
      INSERT INTO agent_a_memory_projection_jobs (
        decision_id, candidate_index, turn_id, idempotency_key, candidate
      ) VALUES (
        ${input.decision_id}::uuid,
        ${candidateIndex},
        ${input.turn_id}::uuid,
        ${`agent-a-memory:${input.turn_id}:${type}:${key}`},
        ${jsonbParam(input.db, candidate)}
      )
      ON CONFLICT DO NOTHING
      RETURNING decision_id
    `;
    enqueued += rows.length;
  }
  return enqueued;
}

interface ClaimedMemoryJob {
  decision_id: string;
  candidate_index: number;
  turn_id: string;
  candidate: unknown;
  attempt_count: number;
}

interface ProjectionContext {
  contact_id: string;
  conversation_id: string;
  batch_id: string | null;
  trace_id: string;
  contact_name: string | null;
  contact_status: 'prospecto' | 'cliente' | 'inactivo';
  consent_status: 'unknown' | 'granted' | 'revoked' | null;
}

function parseCandidate(value: unknown): AgentAMemoryCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MEMORY_CANDIDATE_INVALID');
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.type !== 'string' || !MEMORY_TYPES.has(candidate.type)
    || typeof candidate.key !== 'string' || candidate.key.trim() === ''
    || typeof candidate.value !== 'string' || candidate.value.trim() === ''
    || typeof candidate.source_quote !== 'string' || candidate.source_quote.trim() === ''
    || typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)
  ) throw new Error('MEMORY_CANDIDATE_INVALID');
  return candidate as unknown as AgentAMemoryCandidateV1;
}

async function completeJob(
  db: DbClient,
  job: ClaimedMemoryJob,
  result: 'accepted' | 'duplicate' | 'rejected',
): Promise<void> {
  await db`
    UPDATE agent_a_memory_projection_jobs
    SET status = 'completed', result = ${result}, completed_at = now(),
        lease_until = NULL, last_error_code = NULL
    WHERE decision_id = ${job.decision_id}::uuid
      AND candidate_index = ${job.candidate_index}
      AND status = 'processing'
  `;
}

export async function projectAgentAMemories(
  input: { readonly limit?: number } = {},
  deps: {
    readonly db?: DbClient;
    readonly log?: (event: string, fields: Record<string, unknown>) => void;
    readonly audit?: typeof auditLog;
  } = {},
): Promise<{ examined: number; completed: number; rejected: number; failed: number }> {
  const db = deps.db ?? sql;
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const jobs = await db<ClaimedMemoryJob[]>`
    WITH claimable AS (
      SELECT decision_id, candidate_index
      FROM agent_a_memory_projection_jobs
      WHERE (
        status IN ('pending', 'failed') AND available_at <= now()
      ) OR (
        status = 'processing' AND lease_until <= now()
      )
      ORDER BY created_at, decision_id, candidate_index
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE agent_a_memory_projection_jobs AS job
    SET status = 'processing', attempt_count = job.attempt_count + 1,
        lease_until = now() + interval '2 minutes', last_error_code = NULL
    FROM claimable
    WHERE job.decision_id = claimable.decision_id
      AND job.candidate_index = claimable.candidate_index
      AND job.attempt_count < 3
    RETURNING job.decision_id, job.candidate_index, job.turn_id,
              job.candidate, job.attempt_count
  `;

  let completed = 0;
  let rejected = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const candidate = parseCandidate(job.candidate);
      const contexts = await db<ProjectionContext[]>`
        SELECT message.contact_id, message.conversation_id, message.batch_id,
               decision.trace_id, contact.name AS contact_name,
               contact.status AS contact_status, permission.consent_status
        FROM messages AS message
        JOIN agent_decisions AS decision ON decision.id = ${job.decision_id}::uuid
          AND decision.turn_id = message.id
        JOIN contacts AS contact ON contact.id = message.contact_id
        JOIN conversations AS conversation ON conversation.id = message.conversation_id
        LEFT JOIN contact_channel_permissions AS permission
          ON permission.contact_id = contact.id
         AND permission.channel = conversation.channel
        WHERE message.id = ${job.turn_id}::uuid
          AND message.direction = 'inbound'
        LIMIT 1
      `;
      const context = contexts[0];
      if (!context) throw new Error('MEMORY_PROJECTION_CONTEXT_NOT_FOUND');

      if (isAgentAMemoryCandidateProhibited(candidate)) {
        rejected += 1;
        await deps.audit?.({
          action: 'agent.decision.memory_candidate_rejected',
          entity_type: 'agent_decision', entity_id: job.decision_id,
          payload: { rejected: [{ type: candidate.type, key: candidate.key, reason: 'URL_OR_PRICE_LIKE' }] },
          event_key: `decision:${job.decision_id}:memory:${job.candidate_index}:rejected`,
          correlation_id: context.trace_id, causation_id: job.turn_id,
        }, db);
        await completeJob(db, job, 'rejected');
        completed += 1;
        continue;
      }

      const batchMessages = await db<Array<{ id: string; content: string }>>`
        SELECT id, content FROM messages
        WHERE direction = 'inbound'
          AND contact_id = ${context.contact_id}::uuid
          AND conversation_id = ${context.conversation_id}::uuid
          AND (
            (${context.batch_id}::uuid IS NOT NULL AND batch_id = ${context.batch_id}::uuid)
            OR (${context.batch_id}::uuid IS NULL AND id = ${job.turn_id}::uuid)
          )
        ORDER BY conversation_seq NULLS LAST, created_at, id
      `;
      const outcome = await selectMemories({
        contact_id: context.contact_id,
        conversation_id: context.conversation_id,
        source_batch_id: context.batch_id,
        decision_id: job.decision_id,
        trace_id: context.trace_id,
        batch_messages: batchMessages,
        structured_facts: {
          contact_name: context.contact_name,
          contact_status: context.contact_status,
          consent_status: context.consent_status ?? 'unknown',
        },
        candidates: [candidate],
      }, {
        store: new PostgresMemoryStore(db),
        log: deps.log,
      });
      if (outcome.failed > 0) throw new Error('MEMORY_PROJECTION_STORE_FAILED');
      const result = outcome.accepted.length > 0
        ? 'accepted'
        : outcome.duplicates > 0
          ? 'duplicate'
          : 'rejected';
      if (result === 'rejected') rejected += 1;
      await completeJob(db, job, result);
      completed += 1;
    } catch (error) {
      failed += 1;
      const code = error instanceof Error ? error.message.slice(0, 128) : 'MEMORY_PROJECTION_FAILED';
      await db`
        UPDATE agent_a_memory_projection_jobs
        SET status = 'failed', available_at = now() + interval '1 minute',
            lease_until = NULL, last_error_code = ${code}
        WHERE decision_id = ${job.decision_id}::uuid
          AND candidate_index = ${job.candidate_index}
      `;
      deps.log?.('orchestration.agent_a_memory_projection.failed', {
        decision_id: job.decision_id,
        candidate_index: job.candidate_index,
        error_code: code,
      });
    }
  }
  return { examined: jobs.length, completed, rejected, failed };
}
