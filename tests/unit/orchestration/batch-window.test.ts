import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATCH_WINDOW_POLICY,
  planBatchWait,
  BatchWaitPlanError,
} from '@/features/orchestration/domain/batch-window';

/**
 * The window itself is owned by PostgreSQL. This is the caller-side half: given
 * the deadlines the backend handed back, decide whether the workflow sleeps,
 * claims, or stops. It has to stay pure so the Botpress workflow and the
 * reconciler reason about the window identically without a database.
 */

const policy = DEFAULT_BATCH_WINDOW_POLICY;
const t0 = Date.parse('2026-08-11T12:00:00.000Z');

function at(offsetMs: number): number {
  return t0 + offsetMs;
}

describe('planBatchWait', () => {
  it('sleeps until the due time when the window is still open', () => {
    const plan = planBatchWait({
      now: t0,
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('sleep');
    expect(plan.sleepMs).toBe(2000);
  });

  it('claims as soon as the due time has passed', () => {
    const plan = planBatchWait({
      now: at(2000),
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('claim');
    expect(plan.sleepMs).toBe(0);
  });

  it('never sleeps past the hard deadline even if due_at was pushed out', () => {
    // A backend that returned an inconsistent pair must not make the workflow
    // wait forever; the hard deadline is the ceiling by definition.
    const plan = planBatchWait({
      now: t0,
      dueAt: at(9000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('sleep');
    expect(plan.sleepMs).toBe(4000);
  });

  it('clamps a very short remaining window up to the minimum sleep', () => {
    const plan = planBatchWait({
      now: at(1995),
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('sleep');
    expect(plan.sleepMs).toBe(policy.minSleepMs);
  });

  it('clamps a long window down to the maximum sleep so steps stay bounded', () => {
    const plan = planBatchWait({
      now: t0,
      dueAt: at(60_000),
      hardDeadlineAt: at(60_000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('sleep');
    expect(plan.sleepMs).toBe(policy.maxSleepMs);
  });

  it('gives up once the claim attempts are exhausted', () => {
    const plan = planBatchWait({
      now: t0,
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: policy.maxClaimAttempts + 1,
      policy,
    });

    expect(plan.action).toBe('give_up');
    expect(plan.reasonCode).toBe('CLAIM_ATTEMPTS_EXHAUSTED');
  });

  it('gives up when the hard deadline is far behind, so a zombie never loops', () => {
    const plan = planBatchWait({
      now: at(4000 + policy.hardDeadlineGraceMs + 1),
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('give_up');
    expect(plan.reasonCode).toBe('HARD_DEADLINE_EXCEEDED');
  });

  it('still claims inside the grace period after the hard deadline', () => {
    const plan = planBatchWait({
      now: at(4000 + policy.hardDeadlineGraceMs - 1),
      dueAt: at(2000),
      hardDeadlineAt: at(4000),
      attempt: 1,
      policy,
    });

    expect(plan.action).toBe('claim');
  });

  it('rejects a non-positive attempt number', () => {
    expect(() =>
      planBatchWait({ now: t0, dueAt: at(1), hardDeadlineAt: at(2), attempt: 0, policy })
    ).toThrow(BatchWaitPlanError);
  });

  it('rejects timestamps that are not finite', () => {
    expect(() =>
      planBatchWait({ now: Number.NaN, dueAt: at(1), hardDeadlineAt: at(2), attempt: 1, policy })
    ).toThrow(BatchWaitPlanError);
  });
});

describe('DEFAULT_BATCH_WINDOW_POLICY', () => {
  it('matches the frozen 2s rolling window and 4s hard deadline', () => {
    expect(policy.windowMs).toBe(2000);
    expect(policy.hardDeadlineMs).toBe(4000);
  });

  it('keeps the hard deadline at or beyond the rolling window', () => {
    expect(policy.hardDeadlineMs).toBeGreaterThanOrEqual(policy.windowMs);
  });
});
