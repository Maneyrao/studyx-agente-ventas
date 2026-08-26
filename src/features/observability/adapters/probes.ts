import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { DependencyProbe } from '../domain/readiness';
import {
  EMBEDDING_EPOCH,
  EmbeddingProviderError,
  generateQueryEmbedding,
  isTerminalEmbeddingConfigurationError,
  type EmbeddingRequestOptions,
} from '@/lib/embeddings/gemini';

/**
 * The actual I/O behind each readiness probe.
 *
 * Every probe is bounded and read-only. A readiness endpoint that could block
 * indefinitely is worse than no readiness endpoint: the orchestrator waits on
 * it instead of failing over.
 */

const PROBE_TIMEOUT_MS = 2_000;

async function withTimeout<T>(operation: Promise<T>, ms = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Required: without the source of truth every write would be a lie. */
export async function probePostgres(db: DbClient = sql): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    // Reads a canonical table rather than `SELECT 1`, so a database that is up
    // but missing its schema is reported as down instead of healthy.
    await withTimeout(db`SELECT 1 FROM contacts LIMIT 1`);
    return {
      name: 'postgres',
      required: true,
      status: 'ok',
      detail: null,
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: 'postgres',
      required: true,
      status: 'down',
      detail: String(error).slice(0, 200),
      latency_ms: Date.now() - startedAt,
    };
  }
}

/**
 * Degradable: pgvector powers recall. Without it a turn still has structured
 * facts, recent messages and the summary — a worse answer, not a wrong one.
 */
export async function probePgvector(db: DbClient = sql): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    const rows = await withTimeout(db<Array<{ ready: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS ready
    `);
    const ready = rows[0]?.ready === true;
    return {
      name: 'pgvector',
      required: false,
      status: ready ? 'ok' : 'down',
      detail: ready ? null : 'extension "vector" is not installed',
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: 'pgvector',
      required: false,
      status: 'down',
      detail: String(error).slice(0, 200),
      latency_ms: Date.now() - startedAt,
    };
  }
}

const GEMINI_SMOKE_TIMEOUT_MS = 3_000;

/**
 * Degradable: Gemini writes embeddings and summaries, both derived and
 * reconstructible. A *real* bounded embedding call rather than a presence
 * check on the key — a key can be set and still be revoked or wrong, and a
 * presence-only check would keep reporting `ok` right through that (the
 * "healthy-empty" false positive §6 forbids). Never logs the key: only fixed,
 * safe `EmbeddingProviderError` codes (e.g. `GEMINI_EMBED_HTTP_401`) ever
 * appear in the detail. Reports the embedding epoch so a caller can tell
 * current from legacy coverage. One short request (`"ping"`, capped at
 * `GEMINI_SMOKE_TIMEOUT_MS`) — cheap enough for an ops-facing poll
 * (`/api/diagnostics`), but must never be called on the hot path.
 */
export async function probeGeminiEmbedding(
  embed: (
    text: string,
    options?: EmbeddingRequestOptions,
  ) => Promise<number[]> = generateQueryEmbedding,
): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    const values = await embed('ping', { timeout_ms: GEMINI_SMOKE_TIMEOUT_MS });
    const finite =
      values.length === 768 && values.every((value) => Number.isFinite(value));
    return {
      name: 'gemini_embedding',
      required: false,
      status: finite ? 'ok' : 'degraded',
      detail: JSON.stringify({
        epoch: EMBEDDING_EPOCH,
        smoke: finite ? 'ok' : 'unavailable',
        reason: finite ? null : 'GEMINI_EMBED_INVALID_VALUES',
      }),
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    // Never the key: EmbeddingProviderError.message is always one of a fixed
    // set of safe codes (GEMINI_EMBED_HTTP_401, GEMINI_EMBED_TIMEOUT, ...).
    const reason = error instanceof EmbeddingProviderError
      ? error.message
      : 'GEMINI_EMBED_UNKNOWN_ERROR';
    // A bad/revoked key (401/403/...) is a configuration problem, not a
    // transient blip — reported as 'down' rather than 'degraded' so it does
    // not read like something that will clear itself on the next poll.
    const status = isTerminalEmbeddingConfigurationError(error) ? 'down' : 'degraded';
    return {
      name: 'gemini_embedding',
      required: false,
      status,
      detail: JSON.stringify({ epoch: EMBEDDING_EPOCH, smoke: 'unavailable', reason }),
      latency_ms: Date.now() - startedAt,
    };
  }
}

/** Degradable: how much derived work is queued and how much gave up. */
export async function probeDerivedBacklog(db: DbClient = sql): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    const rows = await withTimeout(db<Array<{
      queues: {
        message_queue: { dead_letter: number };
        selected_memory_queue: { dead_letter: number };
        knowledge_queue: { dead_letter: number };
        ambiguous_deliveries: number;
      };
    }>>`
      SELECT
        jsonb_build_object(
          'embedding_epoch', ${EMBEDDING_EPOCH}::text,
          'message_queue', jsonb_build_object(
            'claimable', (SELECT count(*) FROM embedding_jobs
              WHERE available_at <= now() AND (
                status IN ('pending', 'failed_retryable')
                OR (status = 'leased' AND lease_until <= now())
              )),
            'leased', (SELECT count(*) FROM embedding_jobs
              WHERE status = 'leased' AND lease_until > now()),
            'dead_letter', (SELECT count(*) FROM embedding_jobs WHERE status = 'dead_letter'),
            'oldest_age_seconds', (SELECT floor(extract(epoch FROM now() - min(created_at)))
              FROM embedding_jobs WHERE status IN ('pending', 'failed_retryable')),
            'last_error', (SELECT last_error_detail FROM embedding_jobs
              WHERE last_error_detail IS NOT NULL ORDER BY updated_at DESC LIMIT 1)
          ),
            'selected_memory_queue', jsonb_build_object(
            'claimable', (SELECT count(*) FROM selected_memories
              WHERE embedding_available_at <= now() AND (
                embedding_state IN ('pending', 'failed_retryable')
                OR (embedding_state = 'leased' AND lease_until <= now())
              )),
            'leased', (SELECT count(*) FROM selected_memories
              WHERE embedding_state = 'leased' AND lease_until > now()),
            'dead_letter', (SELECT count(*) FROM selected_memories
              WHERE embedding_state IN ('dead_letter', 'failed')),
            'ready_current', (SELECT count(*) FROM selected_memories
              WHERE status = 'active'
                AND embedding_state = 'ready'
                AND embedding_epoch = ${EMBEDDING_EPOCH}),
            'ready_rate', (
              SELECT coalesce(round(
                count(*) FILTER (
                  WHERE embedding_state = 'ready' AND embedding_epoch = ${EMBEDDING_EPOCH}
                )::numeric / nullif(count(*) FILTER (WHERE status = 'active'), 0),
                4
              ), 1)
              FROM selected_memories
              WHERE status = 'active'
            ),
            -- A sandbox identity is an explicit hard boundary. Report both
            -- populations so test debt cannot be mistaken for a real-contact
            -- memory outage (or vice versa).
            'real', jsonb_build_object(
              'claimable', (SELECT count(*) FROM selected_memories sm
                WHERE NOT EXISTS (SELECT 1 FROM sandbox_identities si WHERE si.contact_id = sm.contact_id)
                  AND sm.embedding_available_at <= now()
                  AND (sm.embedding_state IN ('pending', 'failed_retryable')
                    OR (sm.embedding_state = 'leased' AND sm.lease_until <= now()))),
              'dead_letter', (SELECT count(*) FROM selected_memories sm
                WHERE NOT EXISTS (SELECT 1 FROM sandbox_identities si WHERE si.contact_id = sm.contact_id)
                  AND sm.embedding_state IN ('dead_letter', 'failed'))
            ),
            'sandbox', jsonb_build_object(
              'claimable', (SELECT count(*) FROM selected_memories sm
                WHERE EXISTS (SELECT 1 FROM sandbox_identities si WHERE si.contact_id = sm.contact_id)
                  AND sm.embedding_available_at <= now()
                  AND (sm.embedding_state IN ('pending', 'failed_retryable')
                    OR (sm.embedding_state = 'leased' AND sm.lease_until <= now()))),
              'dead_letter', (SELECT count(*) FROM selected_memories sm
                WHERE EXISTS (SELECT 1 FROM sandbox_identities si WHERE si.contact_id = sm.contact_id)
                  AND sm.embedding_state IN ('dead_letter', 'failed'))
            ),
            'oldest_age_seconds', (SELECT floor(extract(epoch FROM now() - min(created_at)))
              FROM selected_memories WHERE embedding_state IN ('pending', 'failed_retryable')),
            'last_error', (SELECT embedding_last_error FROM selected_memories
              WHERE embedding_last_error IS NOT NULL ORDER BY embedding_updated_at DESC NULLS LAST LIMIT 1)
          ),
          'knowledge_queue', jsonb_build_object(
            'claimable', (SELECT count(*) FROM knowledge_projection_jobs
              WHERE available_at <= now() AND (
                status IN ('pending', 'failed_retryable')
                OR (status = 'leased' AND lease_until <= now())
              )),
            'leased', (SELECT count(*) FROM knowledge_projection_jobs
              WHERE status = 'leased' AND lease_until > now()),
            'dead_letter', (SELECT count(*) FROM knowledge_projection_jobs WHERE status = 'dead_letter'),
            'oldest_age_seconds', (SELECT floor(extract(epoch FROM now() - min(created_at)))
              FROM knowledge_projection_jobs WHERE status IN ('pending', 'failed_retryable')),
            'last_error', (SELECT last_error_detail FROM knowledge_projection_jobs
              WHERE last_error_detail IS NOT NULL ORDER BY updated_at DESC LIMIT 1)
          ),
          'epoch_coverage', jsonb_build_object(
            'messages_current', (SELECT count(*) FROM message_embeddings
              WHERE status = 'indexed' AND embedding_epoch = ${EMBEDDING_EPOCH}),
            'messages_legacy', (SELECT count(*) FROM message_embeddings
              WHERE status = 'indexed' AND embedding_epoch IS DISTINCT FROM ${EMBEDDING_EPOCH}),
            'selected_current', (SELECT count(*) FROM selected_memories
              WHERE embedding_state = 'ready' AND embedding_epoch = ${EMBEDDING_EPOCH}),
            'selected_legacy', (SELECT count(*) FROM selected_memories
              WHERE embedding_state = 'ready' AND embedding_epoch IS DISTINCT FROM ${EMBEDDING_EPOCH}),
            'knowledge_current', (SELECT count(*) FROM knowledge_chunks
              WHERE embedding_epoch = ${EMBEDDING_EPOCH}),
            'knowledge_legacy', (SELECT count(*) FROM knowledge_chunks
              WHERE embedding_epoch IS DISTINCT FROM ${EMBEDDING_EPOCH})
          ),
          'ambiguous_deliveries', (SELECT count(*) FROM outbound_deliveries
            WHERE reconciliation_state = 'ambiguous_paused')
        ) AS queues
    `);
    const detail = rows[0]?.queues ?? {
      message_queue: { dead_letter: 0 },
      selected_memory_queue: { dead_letter: 0 },
      knowledge_queue: { dead_letter: 0 },
      ambiguous_deliveries: 0,
    };
    // A queue with claimable work is not "ok" — the memory contract (`§6`)
    // requires the KB and selected-memory layers to actually be caught up, not
    // merely alive. Reporting 'ok' with 23 sources still stuck in
    // knowledge_projection_jobs would be exactly the "healthy-empty" false
    // positive the contract forbids.
    const hasClaimableBacklog = ['message_queue', 'selected_memory_queue', 'knowledge_queue'].some(
      (key) => ((detail as Record<string, { claimable?: number }>)[key]?.claimable ?? 0) > 0
    );
    const degraded = detail.ambiguous_deliveries > 0
      || detail.message_queue.dead_letter > 0
      || detail.selected_memory_queue.dead_letter > 0
      || detail.knowledge_queue.dead_letter > 0
      || hasClaimableBacklog;
    return {
      name: 'derived_backlog',
      required: false,
      // An ambiguous delivery is a customer who may or may not have been
      // answered. It is the one number here that needs a person.
      status: degraded ? 'degraded' : 'ok',
      detail: JSON.stringify(detail),
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: 'derived_backlog',
      required: false,
      status: 'degraded',
      detail: String(error).slice(0, 200),
      latency_ms: Date.now() - startedAt,
    };
  }
}
