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
import { evaluatePromptParityV1 } from '@/features/observability/domain/prompt-parity';
import type { DependencyProbe } from '@/features/observability/domain/readiness';
import { sql } from '@/lib/db/orchestrator';
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
  const promptEvidencePromise = sql<Array<{
    template_sha: string | null;
    prompt_sha: string | null;
    agent_loop_active: boolean;
  }>>`
    SELECT
      (
        SELECT release_manifest ->> 'prompt_template_sha256'
        FROM agent_decisions
        WHERE release_manifest IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) AS template_sha,
      (
        SELECT release_manifest ->> 'prompt_sha256'
        FROM agent_decisions
        WHERE release_manifest IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) AS prompt_sha,
      EXISTS (
        SELECT 1 FROM agent_loop_rollout_v3
        WHERE mode IN ('shadow', 'authoritative')
      ) AS agent_loop_active
  `.then((rows) => ({
    template_sha: rows[0]?.template_sha ?? null,
    prompt_sha: rows[0]?.prompt_sha ?? null,
    agent_loop_active: rows[0]?.agent_loop_active ?? false,
    query_failed: false,
  })).catch(() => ({
    template_sha: null,
    prompt_sha: null,
    // Fail visibly if diagnostics cannot prove whether an active rollout exists.
    agent_loop_active: true,
    query_failed: true,
  }));

  // Gemini is a real, bounded embedding call here — not a key-presence check.
  // /api/diagnostics is the ops-facing poll, not the hot path, so the cost of
  // one small request is acceptable; it must never run on every turn.
  const [postgres, pgvector, backlog, gemini] = await runDiagnosticsProbes({
    postgres: probePostgres,
    pgvector: probePgvector,
    backlog: probeDerivedBacklog,
    gemini: probeGeminiEmbedding,
  });

  const promptEvidence = await promptEvidencePromise;
  const promptParity = evaluatePromptParityV1({
    agent_loop_active: promptEvidence.agent_loop_active,
    expected_template_sha256: process.env.AGENT_A_PROMPT_TEMPLATE_SHA256 ?? null,
    observed_template_sha256: promptEvidence.template_sha,
    observed_prompt_sha256: promptEvidence.prompt_sha,
    query_failed: promptEvidence.query_failed,
  });
  const promptParityProbe: DependencyProbe = {
    name: 'agent_loop_prompt_parity',
    required: false,
    status: promptParity.status === 'mismatch' || promptParity.status === 'unavailable'
      ? 'degraded'
      : 'ok',
    detail: promptParity.detail,
    latency_ms: null,
  };
  const verdict = evaluateReadiness([
    postgres,
    pgvector,
    gemini,
    backlog,
    promptParityProbe,
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
      prompt_parity: promptParity,
    },
    // A degraded dependency is news, not an error: the caller polls this to
    // learn what is degraded, and a 503 here would be indistinguishable from
    // the endpoint itself being down.
    { status: 200 }
  );
}
