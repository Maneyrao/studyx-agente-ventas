import { describe, expect, it } from 'vitest';

import { formatBridgeWorkerError } from '../../../scripts/lib/bridge-worker-error';

describe('formatBridgeWorkerError', () => {
  it('keeps only a bounded diagnostic code and schema path', () => {
    const error = Object.assign(new Error('BRAIN_INVALID_SCHEMA'), {
      detail: 'move.confidence:Too big: expected number to be <=1 CANARY SECRET',
    });

    const formatted = formatBridgeWorkerError(error);

    expect(formatted).toBe('BRAIN_INVALID_SCHEMA:move.confidence');
    expect(formatted).not.toMatch(/CANARY|SECRET|<=/u);
  });

  it('collapses arbitrary errors to a non-sensitive code', () => {
    expect(formatBridgeWorkerError(new Error('request failed with sk-secret')))
      .toBe('WORKER_ERROR');
  });

  it('keeps an uppercase backend policy reason without exposing response data', () => {
    const error = Object.assign(new Error('LOCAL_STUDYX_DECISION_REJECTED'), {
      reason: 'PAYMENT_PLAN_MISMATCH',
    });

    expect(formatBridgeWorkerError(error))
      .toBe('LOCAL_STUDYX_DECISION_REJECTED:PAYMENT_PLAN_MISMATCH');
  });
});
