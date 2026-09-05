import { describe, expect, it } from 'vitest';
import { reconcileOrchestration } from '@/features/orchestration/application/reconcile-orchestration';
import type { ReconciliationStore } from '@/features/orchestration/ports/reconciliation-store';

function emptyStore(): ReconciliationStore {
  return {
    expireStaleClaims: async () => [],
    listStaleDeliveries: async () => [],
    applyDeliveryVerdict: async () => ({
      applied: false,
      new_state: null,
      new_reconciliation_state: null,
    }),
    listOrphanedDecisions: async () => [],
  };
}

describe('memory supersession reconciliation', () => {
  it('projects pending jobs before reclaiming predecessors whose successor is terminal', async () => {
    const calls: string[] = [];

    const result = await reconcileOrchestration({ trace_id: 'trace-memory-order' }, {
      store: emptyStore(),
      projectAgentAMemories: async () => {
        calls.push('project');
        return { examined: 1, completed: 0, rejected: 0, failed: 1 };
      },
      reclaimStrandedMemorySupersessions: async () => {
        calls.push('reclaim');
        return { examined: 1, reclaimed: 1 };
      },
    });

    expect(calls).toEqual(['project', 'reclaim']);
    expect(result.memory_supersessions).toEqual({
      examined: 1,
      reclaimed: 1,
      failed: 0,
    });
  });

  it('reports a failed recovery without preventing the rest of the sweep', async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];

    const result = await reconcileOrchestration({ trace_id: 'trace-memory-failure' }, {
      store: emptyStore(),
      reclaimStrandedMemorySupersessions: async () => {
        throw new Error('RECOVERY_DB_UNAVAILABLE');
      },
      log: (event, fields) => events.push({ event, fields }),
    });

    expect(result.memory_supersessions).toEqual({
      examined: 0,
      reclaimed: 0,
      failed: 1,
    });
    expect(result.orphaned_decisions).toBe(0);
    expect(events).toContainEqual({
      event: 'orchestration.reconcile.memory_supersessions_failed',
      fields: expect.objectContaining({
        trace_id: 'trace-memory-failure',
        error_code: 'Error',
      }),
    });
  });
});
