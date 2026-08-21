import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { DependencyProbe } from '../domain/readiness';
import { EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';

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

/**
 * Degradable: Gemini writes embeddings and summaries, both derived and
 * reconstructible. Checked by configuration only — a diagnostics endpoint that
 * spent a real API call per poll would be a bill, not a signal.
 */
export function probeGemini(read: (name: string) => string | undefined): DependencyProbe {
  const configured = Boolean(read('GEMINI_API_KEY')?.trim());
  return {
    name: 'gemini',
    required: false,
    status: configured ? 'ok' : 'down',
    detail: configured ? null : 'GEMINI_API_KEY is not set; embeddings and summaries will degrade',
    latency_ms: null,
  };
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
    const degraded = detail.ambiguous_deliveries > 0
      || detail.message_queue.dead_letter > 0
      || detail.selected_memory_queue.dead_letter > 0
      || detail.knowledge_queue.dead_letter > 0;
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
