import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('post-call deployment schedule', () => {
  it('keeps fifty recovery candidates while bounding row starts within the request lifetime', async () => {
    let limit: number | undefined;
    let maxProcessingMs: number | undefined;
    vi.stubEnv('CRON_SECRET', 'unit-cron-secret');
    vi.doMock('@/features/calls/application/post-call-followup', () => ({ runPostCallFollowup: async (input: { limit?: number; max_processing_ms?: number; trace_id: string }) => {
      limit = input.limit;
      maxProcessingMs = input.max_processing_ms;
      return { trace_id: input.trace_id, examined: 0, sent: 0, revoked: 0, skipped: 0, failed: 0, findings: [] };
    } }));
    vi.doMock('@/features/calls/adapters/postgres-post-call-followup-store', () => ({ PostgresPostCallFollowupStore: class {} }));
    vi.doMock('@/features/calls/adapters/agent-a-post-call-narrative', () => ({ createAgentAPostCallComposer: () => async () => '' }));
    vi.doMock('@/features/messaging/adapters/managed-outbound', () => ({ createManagedOutboundSender: () => async () => ({ outcome: 'unreachable' }) }));
    vi.doMock('@/lib/db/orchestrator', () => ({ sql: {} }));
    const { NextRequest } = await import('next/server');
    const route = await import('@/app/api/cron/post-call-followup/route');
    const response = await route.GET(new NextRequest('http://localhost/api/cron/post-call-followup', { headers: { authorization: 'Bearer unit-cron-secret' } }));
    expect(response.status).toBe(200);
    expect(limit).toBe(50);
    expect(maxProcessingMs).toBe(120_000);
    expect(route.maxDuration * 1000).toBeGreaterThan(120_000 + 30_000 + 10_000);
  });

  it('schedules the existing Agent B to Agent A post-call worker', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(config.crons).toContainEqual({
      path: '/api/cron/post-call-followup',
      schedule: '50 3 * * *',
    });
  });
});
