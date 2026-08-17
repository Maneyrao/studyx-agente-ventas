import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

/**
 * The proxy matcher is `/api/:path*`, so it sits in front of EVERY route —
 * including the ones whose whole purpose is to be reachable without a Botpress
 * credential.
 *
 * A load balancer, an uptime probe and Vercel's own health checks have no
 * orchestrator key. If the proxy answers them with 401, the endpoints exist and
 * are useless: the process reports "unhealthy" precisely because the check is
 * unauthenticated, which is the one thing it will always be.
 */

const originalKey = process.env.ORCHESTRATOR_API_KEY;

beforeEach(() => {
  process.env.ORCHESTRATOR_API_KEY = 'orchestrator-key';
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ORCHESTRATOR_API_KEY;
  else process.env.ORCHESTRATOR_API_KEY = originalKey;
});

function unauthenticatedGet(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`, { method: 'GET' });
}

describe('unauthenticated operational endpoints', () => {
  it.each(['/api/health', '/api/ready'])('lets %s through without any credential', async (path) => {
    const response = await proxy(unauthenticatedGet(path));
    expect(response.status).not.toBe(401);
  });

  it('lets /api/diagnostics through so its own bearer check can answer', async () => {
    // The route itself requires CRON_SECRET. A 401 from the proxy would be
    // indistinguishable from a 401 from the handler, which makes the operator
    // debug the wrong credential.
    const response = await proxy(unauthenticatedGet('/api/diagnostics'));
    expect(response.status).not.toBe(401);
  });

  it('lets only the exact Telegram Agent B webhook reach its own secret validation', async () => {
    const response = await proxy(unauthenticatedGet('/api/webhooks/voice/telegram'));
    expect(response.status).not.toBe(401);
    const nearMiss = await proxy(unauthenticatedGet('/api/webhooks/voice/telegram-admin'));
    expect(nearMiss.status).toBe(401);
  });

  it('lets only the exact Stripe payments webhook reach its own signature validation', async () => {
    const response = await proxy(unauthenticatedGet('/api/webhooks/payments/stripe'));
    expect(response.status).not.toBe(401);
    const nearMiss = await proxy(unauthenticatedGet('/api/webhooks/payments/stripe-admin'));
    expect(nearMiss.status).toBe(401);
    const prefixMiss = await proxy(unauthenticatedGet('/api/webhooks/payments/stripe/replay'));
    expect(prefixMiss.status).toBe(401);
  });

  it('lets the cron routes through, as before', async () => {
    const response = await proxy(unauthenticatedGet('/api/cron/reconcile-orchestration'));
    expect(response.status).not.toBe(401);
  });
});

describe('everything else still needs the orchestrator key', () => {
  it.each([
    '/api/agent/ingest',
    '/api/agent/tools/catalog',
    '/api/messages',
    '/api/memory/search',
  ])('rejects %s without a credential', async (path) => {
    const response = await proxy(unauthenticatedGet(path));
    expect(response.status).toBe(401);
  });

  it('does not treat a path that merely starts with the same prefix as public', async () => {
    // `/api/healthcheck-admin` is not `/api/health`.
    const response = await proxy(unauthenticatedGet('/api/healthcheck-admin'));
    expect(response.status).toBe(401);
  });
});
