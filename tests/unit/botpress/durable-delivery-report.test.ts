import { describe, expect, it, vi } from 'vitest';
import { persistDeliveryReportDurably, type DeliveryReportStep, type PendingDeliveryReport } from '../../../botpress-agent/src/lib/delivery/durable-delivery-report';
import { StudyxHttpError } from '../../../botpress-agent/src/utils/http';

function durableSteps() {
  const suspension = { [Symbol.for('StepSignal')]: true };
  const saved = new Map<string, unknown>();
  const waits: number[] = [];
  const step = Object.assign(async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    if (saved.has(name)) return structuredClone(saved.get(name)) as T;
    const value = await run();
    saved.set(name, structuredClone(value));
    return value;
  }, { sleep: async (name: string, ms: number) => {
    if (saved.has(name)) return;
    waits.push(ms);
    saved.set(name, undefined);
    throw suspension;
  } }) satisfies DeliveryReportStep;
  return { step, suspension, waits };
}

describe('durable delivery receipt persistence', () => {
  it('keeps scheduling real continuations beyond the former retry budget and finishes after repair', async () => {
    const { step, suspension, waits } = durableSteps();
    const workflow = { setTimeout: vi.fn(async () => undefined) };
    const pending: PendingDeliveryReport[] = [];
    let attempts = 0;
    const report = async () => {
      attempts += 1;
      if (attempts <= 8) throw new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4);
      return { status: 'duplicate', outbound_id: 'already-recorded' };
    };
    const run = () => persistDeliveryReportDurably({ name: 'receipt', step, workflow,
      report, onPending: failure => pending.push(failure) });

    for (let wake = 0; wake < 8; wake += 1) await expect(run()).rejects.toBe(suspension);
    expect(attempts).toBe(8);
    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    await expect(run()).resolves.toEqual({ recovered: true,
      output: { status: 'duplicate', outbound_id: 'already-recorded' } });
    await run();
    expect(attempts).toBe(9);
    expect(workflow.setTimeout).toHaveBeenCalledWith({ in: '30m' });
    expect(pending.at(-1)).toMatchObject({ code: 'STUDYX_TIMEOUT', retryable: true, attempt: 8 });
  });

  it('leaves permanent configuration failures pending at a slow rate and exposes the operator reason', async () => {
    const { step, suspension, waits } = durableSteps();
    const pending: PendingDeliveryReport[] = [];
    let repaired = false;
    const run = () => persistDeliveryReportDurably({ name: 'receipt', step,
      workflow: { setTimeout: async () => undefined }, report: async () => {
        if (!repaired) throw new StudyxHttpError('INVALID_SIGNATURE', false, 401);
        return { status: 'recorded' };
      }, onPending: failure => pending.push(failure) });
    await expect(run()).rejects.toBe(suspension);
    expect(waits).toEqual([300_000]);
    expect(pending).toEqual([{ code: 'INVALID_SIGNATURE', retryable: false, attempt: 1, delayMs: 300_000 }]);
    repaired = true;
    await expect(run()).resolves.toMatchObject({ recovered: true, output: { status: 'recorded' } });
  });

  it('propagates ADK control signals without caching a failed report or scheduling another retry', async () => {
    const { step, suspension, waits } = durableSteps();
    const pending = vi.fn();
    await expect(persistDeliveryReportDurably({ name: 'receipt', step,
      workflow: { setTimeout: async () => undefined },
      report: async () => { throw suspension; }, onPending: pending })).rejects.toBe(suspension);
    expect(waits).toEqual([]);
    expect(pending).not.toHaveBeenCalled();
  });
});
