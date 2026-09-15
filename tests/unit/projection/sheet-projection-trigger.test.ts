import { describe, expect, it, vi } from 'vitest';
import { flushSheetProjectionsAfterMutation } from '@/lib/services/sheet-projection-trigger';

describe('near-real-time Sheet projection trigger', () => {
  it('drains pending CRM rows with a bounded background worker', async () => {
    const flush = vi.fn().mockResolvedValue({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      lease_lost: 0,
      deadline_reached: false,
    });

    await flushSheetProjectionsAfterMutation({
      traceId: 'trace-123',
      source: 'ingest',
    }, { flush });

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith({
      worker_id: 'after-ingest:trace-123',
      limit: 10,
      lease_seconds: 45,
      deadline_ms: 15_000,
    });
  });

  it('fails soft so a Google outage never breaks the customer turn', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('google unavailable'));

    await expect(flushSheetProjectionsAfterMutation({
      traceId: 'trace-456',
      source: 'delivery',
    }, { flush })).resolves.toBeUndefined();
  });
});
