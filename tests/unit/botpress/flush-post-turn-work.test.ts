import { describe, expect, it, vi } from 'vitest';
import { flushPostTurnWork } from '../../../botpress-agent/src/actions/flushLeadProjection';

describe('flushPostTurnWork', () => {
  it('drains Sheets and selected-memory work together after delivery', async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith('/flush-projections')
        ? { completed: 1 }
        : { completed: 2 }), { status: 200 });
    });
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    const result = await flushPostTurnWork({
      api_base_url: 'http://studyx.test',
      cron_secret: 'test-secret',
      trace_id: '11111111-1111-4111-8111-111111111111',
      fetch_impl: fetchImpl,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      'http://studyx.test/api/cron/flush-projections',
      'http://studyx.test/api/cron/memory-maintenance',
    ]));
    expect(result).toEqual({ status: 'flushed', completed: 1, memory_completed: 2 });
  });

  it('keeps one failed projection independent from the other', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => String(input).endsWith('/flush-projections')
      ? new Response('', { status: 503 })
      : new Response(JSON.stringify({ completed: 1 }), { status: 200 })) as unknown as typeof fetch;

    await expect(flushPostTurnWork({
      api_base_url: 'http://studyx.test',
      cron_secret: 'test-secret',
      trace_id: '11111111-1111-4111-8111-111111111111',
      fetch_impl: fetchImpl,
    })).resolves.toEqual({ status: 'flushed', completed: 0, memory_completed: 1 });
  });
});
