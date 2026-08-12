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

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'studyx-agente-ventas',
      timestamp: new Date().toISOString(),
      // Set by Vercel; absent locally. Useful for telling two deployments apart
      // in a log drain.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    { status: 200 }
  );
}
