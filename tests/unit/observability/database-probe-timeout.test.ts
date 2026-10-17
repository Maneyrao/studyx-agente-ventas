import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';

type PostgresProbe = (db: DbClient) => Promise<{
  name: string;
  required: boolean;
  status: string;
  detail: string | null;
}>;

let probePostgres: PostgresProbe;

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  ({ probePostgres } = await import('@/features/observability/adapters/probes'));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('database probe timeout', () => {
  it('cancels a PostgreSQL probe query when its deadline expires', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stalled = Object.assign(new Promise<never>(() => {}), { cancel });
    const database = vi.fn(() => stalled) as unknown as DbClient;

    const outcome = probePostgres(database);
    await vi.advanceTimersByTimeAsync(2_000);
    const probe = await outcome;

    expect(probe).toMatchObject({ name: 'postgres', required: true, status: 'down' });
    expect(probe.detail).toContain('probe timed out after 2000ms');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a probe that resolves before its deadline', async () => {
    const cancel = vi.fn();
    const healthy = Object.assign(Promise.resolve([{ '?column?': 1 }]), { cancel });
    const database = vi.fn(() => healthy) as unknown as DbClient;

    const probe = await probePostgres(database);

    expect(probe).toMatchObject({ name: 'postgres', required: true, status: 'ok' });
    expect(cancel).not.toHaveBeenCalled();
  });
});
