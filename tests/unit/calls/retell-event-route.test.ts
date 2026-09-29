import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Retell event route boundary', () => {
  it('rejects an anonymous request before selecting a provider branch', async () => {
    vi.stubEnv('XENDRA_ORCHESTRATOR_SECRET', 'configured-xendra-secret');
    vi.stubEnv('RETELL_API_KEY', '');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres@127.0.0.1:55433/studyx_test');
    const { POST } = await import('@/app/retell/eventos/route');

    const response = await POST(new Request('http://localhost/retell/eventos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('runs no-answer follow-up immediately instead of sleeping in request-scoped background work', async () => {
    const runPostCallFollowup = vi.fn(async () => ({
      trace_id: 'trace',
      examined: 1,
      sent: 1,
      revoked: 0,
      skipped: 0,
      failed: 0,
      findings: [],
    }));
    const after = vi.fn();

    vi.doMock('next/server', () => ({ after }));
    vi.doMock('@/lib/db/orchestrator', () => ({ sql: {} }));
    vi.doMock('@/features/calls/adapters/postgres-call-store', () => ({
      PostgresCallStore: class {},
    }));
    vi.doMock('@/features/calls/adapters/postgres-post-call-followup-store', () => ({
      PostgresPostCallFollowupStore: class {},
    }));
    vi.doMock('@/features/messaging/adapters/managed-outbound', () => ({
      createManagedOutboundSender: vi.fn(() => vi.fn()),
    }));
    vi.doMock('@/features/calls/application/post-call-followup', () => ({ runPostCallFollowup }));
    vi.doMock('@/features/calls/application/retell-webhook', () => ({
      handleRetellWebhook: vi.fn(),
      handleXendraRelayedRetellWebhook: vi.fn(async (_request, dependencies) => {
        await dependencies.afterPersisted({
          callId: '7c2c4052-54dd-4125-bf6f-b7cf91a244df',
          eventType: 'ended',
          callStatus: 'no_answer',
        });
        return new Response(null, { status: 204 });
      }),
    }));

    vi.stubEnv('XENDRA_ORCHESTRATOR_SECRET', 'configured-xendra-secret');
    vi.stubEnv('RETELL_API_KEY', '');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres@127.0.0.1:55433/studyx_test');

    const { POST } = await import('@/app/retell/eventos/route');
    const response = await POST(new Request('http://localhost/retell/eventos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-studyx-orchestrator-secret': 'configured-xendra-secret',
        'x-studyx-event': 'call_ended',
      },
      body: '{}',
    }));

    expect(response.status).toBe(204);
    expect(runPostCallFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: '7c2c4052-54dd-4125-bf6f-b7cf91a244df',
        grace_seconds: 0,
      }),
      expect.any(Object),
    );
    expect(after).not.toHaveBeenCalled();
  });
});
