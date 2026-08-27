import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_A_REQUIRED_ENVIRONMENT } from '@/lib/config';

const probePostgres = vi.hoisted(() => vi.fn());
const probeCommercialSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/features/observability/adapters/probes', () => ({
  probePostgres,
  probeCommercialSnapshot,
}));

describe('GET /api/ready', () => {
  beforeEach(() => {
    for (const name of AGENT_A_REQUIRED_ENVIRONMENT) vi.stubEnv(name, 'configured');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    probePostgres.mockResolvedValue({
      name: 'postgres', required: true, status: 'ok', detail: null, latency_ms: 1,
    });
    probeCommercialSnapshot.mockResolvedValue({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'workspace_not_found_or_inactive',
      latency_ms: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('refuses traffic when the same commercial snapshot used by claim is unavailable', async () => {
    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ready: false,
      failed_required: ['commercial_snapshot'],
    });
  });
});
