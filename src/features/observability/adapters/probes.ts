import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { DependencyProbe } from '../domain/readiness';

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
      pending_memory_embeddings: string;
      failed_memory_embeddings: string;
      ambiguous_deliveries: string;
    }>>`
      SELECT
        (SELECT count(*) FROM selected_memories WHERE embedding_state = 'pending')::text
          AS pending_memory_embeddings,
        (SELECT count(*) FROM selected_memories WHERE embedding_state = 'failed')::text
          AS failed_memory_embeddings,
        (SELECT count(*) FROM outbound_deliveries WHERE reconciliation_state = 'ambiguous_paused')::text
          AS ambiguous_deliveries
    `);
    const row = rows[0];
    const ambiguous = Number(row?.ambiguous_deliveries ?? 0);
    return {
      name: 'derived_backlog',
      required: false,
      // An ambiguous delivery is a customer who may or may not have been
      // answered. It is the one number here that needs a person.
      status: ambiguous > 0 ? 'degraded' : 'ok',
      detail: JSON.stringify(row ?? {}),
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
