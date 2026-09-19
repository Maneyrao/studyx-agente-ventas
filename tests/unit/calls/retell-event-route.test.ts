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
});
