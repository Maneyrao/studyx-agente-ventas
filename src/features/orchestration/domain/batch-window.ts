/**
 * Caller-side half of the inbound batching window.
 *
 * PostgreSQL owns the window itself: `open_or_join_inbound_batch` sets
 * `due_at = now + windowMs` on the first message and slides it forward on each
 * additional message without ever passing `hard_deadline_at`. This module
 * answers the complementary question — given the deadlines the backend just
 * returned, does the caller sleep, claim, or stop?
 *
 * It is deliberately dependency-free (no Next.js, Botpress, Supabase, Zod or
 * clock access) so the Botpress workflow, the HTTP route and the reconciler all
 * reason about the same window, and so it is testable without a database.
 */

export class BatchWaitPlanError extends Error {
  readonly code = 'INVALID_BATCH_WAIT_INPUT';
  constructor(reason: string) {
    super(reason);
    this.name = 'BatchWaitPlanError';
  }
}

export interface BatchWindowPolicy {
  /** Rolling window opened by the first message and extended by each new one. */
  readonly windowMs: number;
  /** Ceiling the rolling window can never pass. */
  readonly hardDeadlineMs: number;
  /** How many claim round-trips one workflow may make before stopping. */
  readonly maxClaimAttempts: number;
  /** Floor for a sleep step, so we never issue a pile of near-zero waits. */
  readonly minSleepMs: number;
  /** Ceiling for a single sleep step, so one step stays observable. */
  readonly maxSleepMs: number;
  /**
   * How far past the hard deadline a late workflow may still claim. Beyond it
   * the workflow is a zombie — a reconciler, not a retry loop, owns the batch.
   */
  readonly hardDeadlineGraceMs: number;
}

export const DEFAULT_BATCH_WINDOW_POLICY: BatchWindowPolicy = {
  windowMs: 2_000,
  hardDeadlineMs: 4_000,
  maxClaimAttempts: 4,
  minSleepMs: 250,
  maxSleepMs: 5_000,
  hardDeadlineGraceMs: 30_000,
};

export type BatchWaitAction = 'sleep' | 'claim' | 'give_up';

export interface BatchWaitPlan {
  readonly action: BatchWaitAction;
  readonly sleepMs: number;
  readonly reasonCode: string | null;
}

export interface BatchWaitInput {
  /** Epoch milliseconds. */
  readonly now: number;
  readonly dueAt: number;
  readonly hardDeadlineAt: number;
  /** 1 for the first claim round-trip. */
  readonly attempt: number;
  readonly policy: BatchWindowPolicy;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new BatchWaitPlanError(`${name} must be a finite number`);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function planBatchWait(input: BatchWaitInput): BatchWaitPlan {
  const { now, dueAt, hardDeadlineAt, attempt, policy } = input;

  assertFinite('now', now);
  assertFinite('dueAt', dueAt);
  assertFinite('hardDeadlineAt', hardDeadlineAt);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new BatchWaitPlanError('attempt must be a positive integer');
  }

  if (attempt > policy.maxClaimAttempts) {
    return { action: 'give_up', sleepMs: 0, reasonCode: 'CLAIM_ATTEMPTS_EXHAUSTED' };
  }

  if (now > hardDeadlineAt + policy.hardDeadlineGraceMs) {
    return { action: 'give_up', sleepMs: 0, reasonCode: 'HARD_DEADLINE_EXCEEDED' };
  }

  // A backend that hands back due_at beyond the hard deadline is inconsistent;
  // the hard deadline wins rather than letting the workflow wait indefinitely.
  const wakeAt = Math.min(dueAt, hardDeadlineAt);
  const remaining = wakeAt - now;
  if (remaining <= 0) {
    return { action: 'claim', sleepMs: 0, reasonCode: null };
  }

  return {
    action: 'sleep',
    sleepMs: clamp(remaining, policy.minSleepMs, policy.maxSleepMs),
    reasonCode: null,
  };
}
