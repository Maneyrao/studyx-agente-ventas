import { describe, expect, it, vi } from 'vitest';
import { transportRecoveryCanary } from '../../../botpress-agent/src/workflows/transportRecoveryCanary';
import type { DeliveryReportStep } from '../../../botpress-agent/src/lib/delivery/durable-delivery-report';
import * as http from '../../../botpress-agent/src/utils/http';

describe('transport recovery Cloud probe', () => {
  it('replays acknowledgement and rejected commit receipts through JSON without repeating fixtures', async () => {
    const backend = vi.spyOn(http, 'requestStudyxJson').mockImplementation(async (request) => ({
      trace_id: request.traceId, persisted_message_ids: [],
    }));
    const state = {
      firstSendCount: 0, continuationCount: 0, reportAttempts: 0,
      pendingSuspensions: 0, fixtureAcknowledged: false,
      rejectedCommitCount: 0, rejectionContinuationCount: 0,
    };
    const cached = new Map<string, unknown>();
    const suspended = { kind: 'durable-suspension' };
    const schedules: number[] = [];
    const step: DeliveryReportStep = Object.assign(
      async <T>(name: string, run: () => Promise<T>): Promise<T> => {
        if (cached.has(name)) {
          const stored = cached.get(name) as { output?: T; error?: string };
          if (stored.error) throw new Error(`${stored.error} [step="${name}"]`);
          return structuredClone(stored.output) as T;
        }
        try {
          const value = await run();
          cached.set(name, JSON.parse(JSON.stringify({ output: value })));
          return value;
        } catch (error) {
          if (error instanceof Error) cached.set(name, { error: error.message });
          throw error;
        }
      },
      { sleep: async (name: string, delay: number) => {
        if (cached.has(name)) return;
        cached.set(name, true);
        schedules.push(delay);
        throw suspended;
      } },
    );
    const workflow = { setTimeout: vi.fn(async () => {}) };
    const probe = transportRecoveryCanary as unknown as {
      definition: { handler: (ctx: {
        input: { scenario: 'ack-committed-response-lost' };
        state: typeof state; step: DeliveryReportStep; workflow: typeof workflow;
      }) => Promise<unknown> };
    };
    const invoke = () => probe.definition.handler({
      input: { scenario: 'ack-committed-response-lost' }, state, step, workflow,
    });

    await expect(invoke()).rejects.toBe(suspended);
    expect(state).toMatchObject({ firstSendCount: 1, continuationCount: 0, fixtureAcknowledged: true });
    await expect(invoke()).rejects.toBe(suspended);
    expect(state).toMatchObject({ firstSendCount: 1, continuationCount: 0, reportAttempts: 2 });
    await expect(invoke()).rejects.toBe(suspended);
    expect(state).toMatchObject({ rejectedCommitCount: 1, rejectionContinuationCount: 0 });
    await expect(invoke()).resolves.toMatchObject({
      first_send_count: 1, continuation_count: 1, report_attempts: 3,
      pending_suspensions: 2, external_sends: 0, model_calls: 0,
      rejected_commit_count: 1, rejection_continuation_count: 1,
      rejection_reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
      rejection_subjects: ['forbidden_promise'],
    });
    expect(schedules).toHaveLength(3);
    expect(schedules.every(delay => delay >= 10_000)).toBe(true);
    // A replay after the success receipt also keeps both fixture sends unique.
    await expect(invoke()).resolves.toMatchObject({ first_send_count: 1, continuation_count: 1 });
    expect(state.reportAttempts).toBe(3);
    expect(state.rejectedCommitCount).toBe(1);
    expect(state.rejectionContinuationCount).toBe(1);
    expect(backend).toHaveBeenCalledTimes(2);
    expect(backend.mock.calls.every(([request]) => request.path === '/api/agent/inbound/receipts'
      && (request.body as { external_message_ids: string[] }).external_message_ids.join() === 'transport-canary-no-message')).toBe(true);
  });
});
