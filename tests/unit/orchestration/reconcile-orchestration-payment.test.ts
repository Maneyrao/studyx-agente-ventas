import { describe, expect, it } from 'vitest';
import { paymentProjectionReconciliationHttpStatus } from '@/features/orchestration/application/reconcile-orchestration';

describe('payment projection reconciliation observability', () => {
  it.each([
    ['ready', 200],
    ['disabled', 503],
    ['error', 500],
  ] as const)('maps %s to an unambiguous cron status', (status, expected) => {
    expect(paymentProjectionReconciliationHttpStatus(status)).toBe(expected);
  });
});
