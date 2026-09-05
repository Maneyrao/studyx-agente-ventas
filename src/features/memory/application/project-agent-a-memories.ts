import { auditLog } from '@/lib/audit/logger';
import { jsonbParam } from '@/lib/db/json';
import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { DecisionMemoryCandidate } from '@/features/orchestration/domain/decision';
import { selectMemories } from '@/features/orchestration/application/select-memories';
import { PostgresMemoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import type { MemoryStore } from '@/features/orchestration/ports/memory-store';
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
  /**
   * The workspace durably linked to this turn's conversation
   * (`conversation_sales_context_states_v1`), NOT inferred from
   * `workspace_contacts` membership — see P1-A (2026-09-05): a global
   * contact can be an active member of several workspaces at once, so
   * membership alone cannot identify which workspace a given memory
   * originated in. LEFT JOINed: pre-Agent-Loop conversations have no such
   * row, and only the prepared-identity path below needs this value.
   */
  workspace_id: string | null;
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

interface PreparedMemoryIdentityV1 {
  readonly id: string;
  readonly supersedes: readonly string[];
}

function parsePreparedMemoryIdentity(value: unknown): PreparedMemoryIdentityV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.id === undefined && candidate.supersedes === undefined) return null;
  if (
    typeof candidate.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(candidate.id)
    || !Array.isArray(candidate.supersedes)
    || candidate.supersedes.some((id) => (
      typeof id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        .test(id)
    ))
  ) throw new Error('MEMORY_CANDIDATE_INVALID');
  return { id: candidate.id, supersedes: candidate.supersedes as string[] };
}

/**
 * The projection worker never reclaims a job past its third attempt
 * (`attempt_count < 3` below): a job stuck at `status = 'failed'` with
 * `attempt_count = 3` is TERMINAL, not merely delayed. Kept as one named
 * constant so the claim query and the reconciliation sweep below can never
 * drift apart on what "terminal" means.
 */
const MAX_MEMORY_PROJECTION_ATTEMPTS = 3;

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
      WHERE attempt_count < ${MAX_MEMORY_PROJECTION_ATTEMPTS}
        AND (
          (status IN ('pending', 'failed') AND available_at <= now())
          OR (status = 'processing' AND lease_until <= now())
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
      AND job.attempt_count < ${MAX_MEMORY_PROJECTION_ATTEMPTS}
    RETURNING job.decision_id, job.candidate_index, job.turn_id,
              job.candidate, job.attempt_count
  `;

  let completed = 0;
  let rejected = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const candidate = parseCandidate(job.candidate);
      const preparedIdentity = parsePreparedMemoryIdentity(job.candidate);
      const contexts = await db<ProjectionContext[]>`
        SELECT message.contact_id, message.conversation_id, state.workspace_id,
               message.batch_id, decision.trace_id, contact.name AS contact_name,
               contact.status AS contact_status, permission.consent_status
        FROM messages AS message
        JOIN agent_decisions AS decision ON decision.id = ${job.decision_id}::uuid
          AND decision.turn_id = message.id
        JOIN contacts AS contact ON contact.id = message.contact_id
        JOIN conversations AS conversation ON conversation.id = message.conversation_id
        LEFT JOIN conversation_sales_context_states_v1 AS state
          ON state.conversation_id = message.conversation_id
         AND state.contact_id = message.contact_id
        LEFT JOIN contact_channel_permissions AS permission
          ON permission.contact_id = contact.id
         AND permission.channel = conversation.channel
        WHERE message.id = ${job.turn_id}::uuid
          AND message.direction = 'inbound'
        LIMIT 1
      `;
      const context = contexts[0];
      if (!context) throw new Error('MEMORY_PROJECTION_CONTEXT_NOT_FOUND');
      // The prepared-identity path activates through
      // `record_prepared_agent_memory_v1`, which requires the authoritative
      // workspace to validate every `supersedes` target against (P1-A,
      // 2026-09-05). Every Agent Loop turn has a
      // `conversation_sales_context_states_v1` row by construction; a
      // prepared candidate without one is an invariant violation, not a
      // pre-Agent-Loop conversation, so this fails closed rather than
      // silently recording without workspace authority.
      if (preparedIdentity && context.workspace_id === null) {
        throw new Error('MEMORY_PROJECTION_WORKSPACE_NOT_FOUND');
      }

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
      const postgresStore = new PostgresMemoryStore(db);
      // Narrowed once, right after the fail-closed guard above, so the
      // closure below does not have to re-derive `string | null` on every
      // call — `preparedIdentity` implies `context.workspace_id` is set.
      const preparedWorkspaceId = context.workspace_id;
      const store: MemoryStore = preparedIdentity && preparedWorkspaceId
        ? {
            recordAccepted: (accepted) => postgresStore.recordPreparedAccepted({
              ...accepted,
              memory_id: preparedIdentity.id,
              supersedes_memory_ids: preparedIdentity.supersedes,
              workspace_id: preparedWorkspaceId,
            }),
            recordRejected: (rejected) => postgresStore.recordRejected(rejected),
            expireDueMemories: (limit) => postgresStore.expireDueMemories(limit),
          }
        : postgresStore;
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
        store,
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

interface StrandedSupersessionRow {
  memory_id: string;
  contact_id: string;
  workspace_id: string;
  memory_type: string;
  memory_key: string;
  successor_decision_id: string;
  successor_trace_id: string;
  successor_candidate_index: number;
  successor_job_status: 'completed' | 'failed';
  successor_job_result: 'rejected' | null;
  attempt_count: number;
  last_error_code: string | null;
}

/**
 * P1 (independent review, 2026-09-05): `commitAgentTurnV3` parks a
 * predecessor at `status = 'pending_supersession'` (20260905000007) INSIDE
 * the decision transaction, ahead of the successor's own row even existing —
 * see the header of that migration and `commit-agent-turn-v3.ts:957-971`.
 * The async worker above normally completes that link to `superseded` once
 * the successor becomes durable. But if the successor's OWN job either hits
 * a DETERMINISTIC failure (an invalid prepared candidate or a durable context/
 * store invariant that fails the same way on every retry) or completes as
 * `rejected` without creating the reserved successor. The failed job becomes
 * unclaimable at the attempt cap; the rejected job is already completed.
 * Nothing else revisits either terminal outcome, so the predecessor would sit
 * at `pending_supersession` forever — invisible to
 * `search_selected_memories` (`status = 'active'` only) and to both sweepers
 * that only touch `'active'` rows (`expire_selected_memories`, the embedding
 * worker) — a silent, permanent loss of whatever the customer told us.
 *
 * `agent_a_memory_projection_jobs` rows are never deleted (DELETE is
 * REVOKEd from `orchestrator_role`, 20260828020001), so this can key
 * directly off the job's own terminal state rather than a separate
 * time-based heuristic. A predecessor is eligible only when the terminal
 * job's source turn and the predecessor's origin state prove the SAME
 * workspace and contact; candidate JSON is never tenant authority. An
 * eligible predecessor still parked at `pending_supersession` is reverted to
 * `active` — the SAME `status = 'active', embedding_state =
 * 'pending'` shape `record_prepared_agent_memory_v1` itself uses for a
 * freshly recorded memory, so the embedding worker re-embeds it normally.
 * This restores the pre-P1-B behaviour (a stale recall) rather than losing
 * the memory outright: strictly safer, per the review's own ruling, and
 * genuinely observable — the terminal job itself is left exactly as it was,
 * while the recovery audit points back to its status, result, attempt/error
 * metadata and immutable decision evidence. Reverting the memory does not
 * erase the cause an operator needs to investigate.
 *
 * Idempotent by construction: once reverted to `active`, the `WHERE
 * memory.status = 'pending_supersession'` guard no longer matches it, so a
 * repeat sweep reclaims nothing for that row.
 *
 * Wired into the existing reconciliation sweep
 * (`reconcile-orchestration.ts` / `/api/cron/reconcile-orchestration`)
 * rather than a new parallel scheduler — the one place in this codebase
 * allowed to repair work another process abandoned.
 */
export async function reclaimStrandedMemorySupersessions(
  input: { readonly limit?: number } = {},
  deps: {
    readonly db?: DbClient;
    readonly log?: (event: string, fields: Record<string, unknown>) => void;
    readonly audit?: typeof auditLog;
  } = {},
): Promise<{ examined: number; reclaimed: number }> {
  const db = deps.db ?? sql;
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  const recover = async (transaction: DbClient): Promise<{
    readonly stats: { examined: number; reclaimed: number };
    readonly rows: StrandedSupersessionRow[];
  }> => {
    const stranded = await transaction<StrandedSupersessionRow[]>`
      SELECT DISTINCT ON (memory.id)
        memory.id AS memory_id,
        memory.contact_id,
        successor_state.workspace_id,
        memory.memory_type,
        memory.memory_key,
        decision.id AS successor_decision_id,
        decision.trace_id AS successor_trace_id,
        job.candidate_index AS successor_candidate_index,
        job.status AS successor_job_status,
        job.result AS successor_job_result,
        job.attempt_count,
        job.last_error_code
      FROM agent_a_memory_projection_jobs AS job
      JOIN agent_decisions AS decision
        ON decision.id = job.decision_id
       AND decision.turn_id = job.turn_id
      JOIN messages AS turn
        ON turn.id = job.turn_id
       AND turn.direction = 'inbound'
      JOIN conversation_sales_context_states_v1 AS successor_state
        ON successor_state.conversation_id = turn.conversation_id
       AND successor_state.contact_id = turn.contact_id
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(job.candidate -> 'supersedes') = 'array'
            THEN job.candidate -> 'supersedes'
          ELSE '[]'::jsonb
        END
      ) AS supersedes(value)
      JOIN selected_memories AS memory
        ON lower(memory.id::text) = lower(supersedes.value)
       AND memory.contact_id = turn.contact_id
       AND memory.status = 'pending_supersession'
      JOIN conversation_sales_context_states_v1 AS origin_state
        ON origin_state.conversation_id = memory.conversation_id
       AND origin_state.contact_id = memory.contact_id
       AND origin_state.workspace_id = successor_state.workspace_id
      WHERE (
          job.status = 'failed'
          AND job.attempt_count >= ${MAX_MEMORY_PROJECTION_ATTEMPTS}
        ) OR (
          job.status = 'completed'
          AND job.result = 'rejected'
        )
      ORDER BY memory.id, job.created_at, job.decision_id, job.candidate_index
      LIMIT ${limit}
    `;
    if (stranded.length === 0) {
      return { stats: { examined: 0, reclaimed: 0 }, rows: [] };
    }

    const strandedIds = stranded.map((row) => row.memory_id);
    const updated = await transaction<Array<{ memory_id: string }>>`
      UPDATE selected_memories AS memory
      SET status = 'active', embedding_state = 'pending', embedding_updated_at = now()
      WHERE memory.id = ANY(${strandedIds}::uuid[])
        AND memory.status = 'pending_supersession'
      RETURNING memory.id AS memory_id
    `;
    const updatedIds = new Set(updated.map((row) => row.memory_id));
    const reclaimed = stranded.filter((row) => updatedIds.has(row.memory_id));

    // Audit inside the same transaction as the status restoration. If the
    // audit sink fails, the UPDATE rolls back and a later sweep can retry;
    // there is never an active memory whose recovery evidence was lost.
    for (const row of reclaimed) {
      await deps.audit?.({
        action: 'agent.decision.memory_supersession_reclaimed',
        entity_type: 'selected_memory',
        entity_id: row.memory_id,
        payload: {
          contact_id: row.contact_id,
          workspace_id: row.workspace_id,
          memory_type: row.memory_type,
          memory_key: row.memory_key,
          successor_decision_id: row.successor_decision_id,
          successor_candidate_index: row.successor_candidate_index,
          successor_job_status: row.successor_job_status,
          successor_job_result: row.successor_job_result,
          attempt_count: row.attempt_count,
          last_error_code: row.last_error_code,
          reason: 'SUCCESSOR_PROJECTION_TERMINAL_WITHOUT_MEMORY',
          new_status: 'active',
        },
        event_key: `memory:${row.memory_id}:supersession_reclaimed`,
        correlation_id: row.successor_trace_id,
        causation_id: row.successor_decision_id,
      }, transaction);
    }

    return {
      stats: { examined: stranded.length, reclaimed: reclaimed.length },
      rows: reclaimed,
    };
  };

  const outcome = 'begin' in db
    ? await db.begin(async (transaction) => recover(transaction))
    : await recover(db);

  // Emit operational logs only after the enclosing transaction commits, so
  // a rolled-back repair can never look successful in telemetry.
  for (const row of outcome.rows) {
    deps.log?.('orchestration.agent_a_memory_supersession.reclaimed', {
      memory_id: row.memory_id,
      contact_id: row.contact_id,
      workspace_id: row.workspace_id,
      memory_type: row.memory_type,
      memory_key: row.memory_key,
      successor_decision_id: row.successor_decision_id,
      successor_candidate_index: row.successor_candidate_index,
      successor_job_status: row.successor_job_status,
      successor_job_result: row.successor_job_result,
      attempt_count: row.attempt_count,
      last_error_code: row.last_error_code,
      reason: 'SUCCESSOR_PROJECTION_TERMINAL_WITHOUT_MEMORY',
    });
  }

  return outcome.stats;
}
