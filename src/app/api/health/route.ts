import { NextResponse } from 'next/server';

/**
 * GET /api/health — liveness.
 *
 * Answers exactly one question: is this process running and able to respond?
 * It touches no dependency on purpose. A liveness probe that queried
 * PostgreSQL would restart every healthy process during a database blip,
 * turning a recoverable outage into a restart storm.
 *
 * Readiness — "should this process receive traffic" — is `/api/ready`.
 */
export const dynamic = 'force-dynamic';

function releaseCommit(): string | null {
  const candidate = process.env.STUDYX_RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  return candidate && /^[a-f0-9]{40}$/u.test(candidate) ? candidate : null;
}

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'studyx-agente-ventas',
      timestamp: new Date().toISOString(),
      // Vercel fills its native value for Git deployments. CLI deployments
      // inject STUDYX_RELEASE_SHA explicitly so the same endpoint always
      // proves the exact source commit instead of returning an empty marker.
      commit: releaseCommit(),
      region: process.env.VERCEL_REGION ?? null,
    },
    { status: 200 }
  );
}
