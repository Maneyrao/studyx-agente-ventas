import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimBatch: vi.fn(),
  readerInstances: [] as Array<{ readonly workspaceSlug: string }>,
}));

vi.mock('@/features/orchestration/application/claim-batch', () => ({
  claimBatch: mocks.claimBatch,
  BatchFactsMissingError: class BatchFactsMissingError extends Error {
    readonly code = 'BATCH_FACTS_MISSING';
  },
  DEFAULT_CONTEXT_LIMITS: {
    recentTurns: 10,
    memoryResults: 5,
    knowledgeResults: 5,
    knowledgeMinSimilarity: 0.75,
  },
}));
vi.mock('@/features/orchestration/adapters/postgres-orchestration-store', () => ({
  orchestrationStore: {},
}));
vi.mock('@/features/orchestration/adapters/postgres-retrievers', () => ({
  knowledgeRetriever: {},
  memoryRetriever: {},
  queryEmbedder: {},
}));
vi.mock('@/features/orchestration/adapters/postgres-business-context', () => ({
  businessContextStore: {},
}));
vi.mock('@/features/sales/adapters/postgres-sales-context-store', () => ({
  salesContextStore: { load: vi.fn() },
}));
vi.mock('@/features/conversation/adapters/postgres-conversation-state-store', () => ({
  PostgresConversationStateStoreV1: class PostgresConversationStateStoreV1 {
    load = vi.fn();
  },
}));
vi.mock('@/features/orchestration/adapters/postgres-agent-loop-rollout', () => ({
  PostgresAgentLoopRolloutReaderV3: class PostgresAgentLoopRolloutReaderV3 {
    constructor(readonly workspaceSlug: string) {
      mocks.readerInstances.push(this);
    }

    load = vi.fn();
  },
}));
vi.mock('@/features/orchestration/domain/business-context', () => ({
  buildBusinessContextView: vi.fn(),
  buildCatalogIndexView: vi.fn(),
}));
vi.mock('@/lib/config', () => ({
  config: {
    recentTurnsLimit: 10,
    ltmResultsLimit: 5,
    kbResultsLimit: 5,
    kbMinSimilarity: 0.75,
  },
  loadAgentACommercialConfig: () => ({ workspaceSlug: 'studyx' }),
  loadAgentABrainConfig: () => ({ enabled: false, shadow: false, ready: true }),
  loadAgentARolloutConfig: () => ({
    contextScoping: false,
    repairEnabled: false,
    stateAssertions: false,
    singleRoute: false,
  }),
  loadConversationPipelineConfig: () => ({ enabled: false }),
}));
vi.mock('@/lib/observability/structured-log', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  timedStage: async (_stage: string, _fields: unknown, run: () => Promise<unknown>) => run(),
}));
vi.mock('@/lib/observability/counters', () => ({
  counter: { increment: vi.fn() },
}));

import { POST } from '@/app/api/agent/batches/[batch_id]/claim/route';

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = '22222222-2222-4222-8222-222222222222';

describe('claim route agent-loop rollout wiring', () => {
  beforeEach(() => {
    mocks.readerInstances.length = 0;
    mocks.claimBatch.mockResolvedValue({
      outcome: 'claimed',
      batch: { stolen: false },
      context: { long_term_memory_available: true, knowledge_base_available: true },
    });
  });

  it('injects the configured-workspace Postgres reader into the real claim application seam', async () => {
    const response = await POST(
      new NextRequest(`http://localhost/api/agent/batches/${BATCH_ID}/claim`, {
        method: 'POST',
        body: JSON.stringify({ trace_id: TRACE_ID, claimed_by: 'route-wiring-test' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ batch_id: BATCH_ID }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.readerInstances).toHaveLength(1);
    expect(mocks.readerInstances[0]).toMatchObject({ workspaceSlug: 'studyx' });
    expect(mocks.claimBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: BATCH_ID, trace_id: TRACE_ID }),
      expect.objectContaining({ agentLoopRollout: mocks.readerInstances[0] }),
    );
  });
});
