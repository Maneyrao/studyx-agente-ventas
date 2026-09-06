import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';

type SchemaProbe = (db: DbClient) => Promise<{
  name: string;
  required: boolean;
  status: string;
  detail: string | null;
}>;

let probeAgentLoopSchema: SchemaProbe;

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  ({ probeAgentLoopSchema } = await import('@/features/observability/adapters/probes'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function databaseRows(rows: unknown[]) {
  return vi.fn().mockResolvedValue(rows) as unknown as DbClient;
}

describe('probeAgentLoopSchema', () => {
  it('refuses traffic when the delivery schema required by the running code is incomplete', async () => {
    const probe = await probeAgentLoopSchema(databaseRows([{
      deferred_state_patch: false,
      deferred_patch_applied_on: false,
      deferred_lead_projection: false,
      deferred_lead_projection_applied_on: false,
    }]));

    expect(probe).toMatchObject({
      name: 'agent_loop_schema',
      required: true,
      status: 'down',
    });
    expect(probe.detail).toBe('missing: deferred_state_patch, deferred_patch_applied_on, deferred_lead_projection, deferred_lead_projection_applied_on');
  });

  it('reports ready only when every delivery column used by the running code exists', async () => {
    const probe = await probeAgentLoopSchema(databaseRows([{
      deferred_state_patch: true,
      deferred_patch_applied_on: true,
      deferred_lead_projection: true,
      deferred_lead_projection_applied_on: true,
    }]));

    expect(probe).toMatchObject({
      name: 'agent_loop_schema',
      required: true,
      status: 'ok',
      detail: null,
    });
  });
});
