import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { recordCallEvent } from '@/features/calls/application/record-call-event';
import type { CallStore } from '@/features/calls/ports/call-store';

describe('recordCallEvent', () => {
  it('recomputes from the complete ledger after both a new event and a replay', async () => {
    const callId = randomUUID();
    const store: CallStore = {
      claimDispatch: vi.fn(), attachProviderCall: vi.fn(), markDispatchAmbiguous: vi.fn(), markDispatchFailed: vi.fn(),
      appendEvent: vi.fn().mockResolvedValueOnce('recorded').mockResolvedValueOnce('duplicate'),
      recomputeProjection: vi.fn(async () => ({ status: 'in_progress' as const, analysisStatus: 'pending' as const, result: null })),
    };
    const event = {
      schema_version: 1 as const, event_id: 'telegram:started:1', call_id: callId,
      event_type: 'started' as const, sequence: 1, occurred_at: '2026-08-16T12:00:00.000Z',
      provider: 'telegram_sandbox' as const,
      payload: { event_type: 'started' as const, started_at: '2026-08-16T12:00:00.000Z' },
    };
    await expect(recordCallEvent(event, { store })).resolves.toMatchObject({ persistence: 'recorded', projection: { status: 'in_progress' } });
    await expect(recordCallEvent(event, { store })).resolves.toMatchObject({ persistence: 'duplicate', projection: { status: 'in_progress' } });
    expect(store.recomputeProjection).toHaveBeenCalledTimes(2);
  });
});
