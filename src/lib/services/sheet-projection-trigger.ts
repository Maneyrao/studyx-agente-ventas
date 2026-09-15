import { logger } from '@/lib/observability/structured-log';

type ProjectionFlusher = typeof import('./projection.service').flushSheetProjections;

/**
 * Best-effort, near-real-time drain for CRM updates scheduled with Next.js
 * `after()`. PostgreSQL remains authoritative and the daily cron remains the
 * recovery path if either Google or this background attempt is unavailable.
 */
export async function flushSheetProjectionsAfterMutation(input: {
  traceId: string;
  source: 'ingest' | 'decision' | 'delivery';
}, deps: {
  flush?: ProjectionFlusher;
} = {}): Promise<void> {
  try {
    const flush = deps.flush
      ?? (await import('./projection.service')).flushSheetProjections;
    await flush({
      worker_id: `after-${input.source}:${input.traceId}`,
      limit: 10,
      lease_seconds: 45,
      deadline_ms: 15_000,
    });
  } catch (error) {
    logger.warn({
      event: 'sheet_projection.after_mutation_failed',
      trace_id: input.traceId,
      source: input.source,
      error: String(error).slice(0, 500),
    });
  }
}
