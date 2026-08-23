import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { evaluateReadiness, probeEnvironment } from '@/features/observability/domain/readiness';
import {
  probeDerivedBacklog,
  probeGeminiEmbedding,
  probePgvector,
  probePostgres,
} from '@/features/observability/adapters/probes';
import { runDiagnosticsProbes } from '@/features/observability/application/run-diagnostics-probes';
import { withTrace } from '@/lib/observability/structured-log';

/**
 * GET /api/diagnostics — the degradable half.
 *
 * Separate from `/api/ready` on purpose. Everything reported here can be down
 * while the agent keeps holding conversations, so none of it may influence
 * whether the process receives traffic. Mixing the two would mean a pgvector
 * outage silently removes a perfectly capable process from rotation.
 *
 * Always 200 when the process can answer: the *body* carries the bad news.
 * Requires `CRON_SECRET`, because the backlog counts describe operational
 * state and there is no reason to publish them anonymously.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const traceId = request.headers.get('x-trace-id') ?? randomUUID();
  const log = withTrace({ trace_id: traceId });

  // Gemini is a real, bounded embedding call here — not a key-presence check.
  // /api/diagnostics is the ops-facing poll, not the hot path, so the cost of
  // one small request is acceptable; it must never run on every turn.
  const [postgres, pgvector, backlog, gemini] = await runDiagnosticsProbes({
    postgres: probePostgres,
    pgvector: probePgvector,
    backlog: probeDerivedBacklog,
    gemini: probeGeminiEmbedding,
  });

  const verdict = evaluateReadiness([
    postgres,
    pgvector,
    gemini,
    backlog,
    ...probeEnvironment((name: string) => process.env[name]).filter((probe) => !probe.required),
  ]);

  if (verdict.degraded.length > 0) {
    log.warn({ event: 'diagnostics.degraded', degraded: verdict.degraded });
  }

  return NextResponse.json(
    {
      status: verdict.status,
      ready: verdict.ready,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      probes: verdict.probes,
      degraded: verdict.degraded,
      failed_required: verdict.failed_required,
    },
    // A degraded dependency is news, not an error: the caller polls this to
    // learn what is degraded, and a 503 here would be indistinguishable from
    // the endpoint itself being down.
    { status: 200 }
  );
}
