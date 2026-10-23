import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repair: vi.fn(),
}));

vi.mock('@/features/orchestration/adapters/postgres-turn-recovery', () => ({
  repairExhaustedInboundBatch: mocks.repair,
}));
vi.mock('@/lib/config', () => ({
  loadAgentACommercialConfig: () => ({ workspaceSlug: 'studyx' }),
}));
vi.mock('@/lib/observability/structured-log', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  timedStage: async (_stage: string, _fields: unknown, run: () => Promise<unknown>) => run(),
}));

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const TRACE_ID = '44444444-4444-4444-8444-444444444444';

describe('exhausted batch repair route', () => {
  beforeEach(() => {
    mocks.repair.mockReset().mockResolvedValue({ outcome: 'reopened', replayed: false });
  });

  it('passes the exact repair identity to the transactional adapter', async () => {
    const route = await import('@/app/api/agent/batches/[batch_id]/repair/route').catch(() => null);
    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.POST(new NextRequest(
      `http://localhost/api/agent/batches/${BATCH_ID}/repair`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        trace_id: TRACE_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
      }) },
    ), { params: Promise.resolve({ batch_id: BATCH_ID }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: 'reopened', replayed: false });
    expect(mocks.repair).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      traceId: TRACE_ID,
      workspaceSlug: 'studyx',
    });
  });
});
