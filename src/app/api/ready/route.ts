import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  evaluateReadiness,
  probeEnvironment,
} from '@/features/observability/domain/readiness';
import { probePostgres } from '@/features/observability/adapters/probes';
import { withTrace } from '@/lib/observability/structured-log';

/**
 * GET /api/ready — readiness.
 *
 * "May this process take traffic?" Only two things decide that: the
 * configuration it needs to sign and authenticate requests, and PostgreSQL,
 * which is the source of truth.
 *
 * Everything degradable — Gemini, pgvector, derived backlogs — is deliberately
 * NOT here. It lives in `/api/diagnostics`, so a vector index outage can never
 * take a healthy process out of rotation.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const traceId = randomUUID();
  const log = withTrace({ trace_id: traceId });

  const verdict = evaluateReadiness([
    ...probeEnvironment((name: string) => process.env[name]).filter((probe) => probe.required),
    await probePostgres(),
  ]);

  if (!verdict.ready) {
    log.error({
      event: 'readiness.not_ready',
      failed_required: verdict.failed_required,
    });
  }

  return NextResponse.json(
    {
      status: verdict.status,
      ready: verdict.ready,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      probes: verdict.probes,
      failed_required: verdict.failed_required,
    },
    { status: verdict.http_status }
  );
}
