import { describe, expect, it } from 'vitest';
import {
  decideDeliveryReconciliation,
  type DeliveryReconciliationFacts,
} from '@/features/orchestration/domain/delivery-reconciliation';

const NOW = Date.parse('2026-08-11T12:00:00.000Z');

function facts(overrides: Partial<DeliveryReconciliationFacts> = {}): DeliveryReconciliationFacts {
  return {
    state: 'leased',
    provider_message_id: null,
    attempt_count: 1,
    max_attempts: 3,
    lease_until: '2026-08-11T11:55:00.000Z',
    reported_status: null,
    reconciliation_state: null,
    now: NOW,
    ...overrides,
  };
}

describe('proof of send always wins', () => {
  it('never resends when a Botpress message id exists, whatever the state says', () => {
    expect(
      decideDeliveryReconciliation(
        facts({ state: 'failed_retryable', provider_message_id: 'bp-123', reported_status: 'failed' })
      )
    ).toEqual({ action: 'mark_sent', reason: 'PROVIDER_MESSAGE_ID_PRESENT' });
  });

  it('never resends a delivery already reported as submitted', () => {
    expect(
      decideDeliveryReconciliation(facts({ reported_status: 'submitted_to_botpress' })).action
    ).toBe('mark_sent');
  });

  it.each(['submitted', 'delivered'] as const)('treats %s as sent', (state) => {
    expect(decideDeliveryReconciliation(facts({ state })).action).toBe('mark_sent');
  });
});

describe('ambiguity pauses, it never resends', () => {
  it('pauses a lease that expired with nothing reported', () => {
    expect(decideDeliveryReconciliation(facts())).toEqual({
      action: 'pause_ambiguous',
      reason: 'LEASE_EXPIRED_WITHOUT_REPORT',
    });
  });

  it('stays paused once paused, no matter how many sweeps run', () => {
    expect(
      decideDeliveryReconciliation(facts({ reconciliation_state: 'ambiguous_paused' })).action
    ).toBe('wait');
  });

  it('does not resend an ambiguous delivery even with attempts to spare', () => {
    expect(decideDeliveryReconciliation(facts({ attempt_count: 0 })).action).toBe(
      'pause_ambiguous'
    );
  });

  it('pauses a failed_retryable whose report is missing', () => {
    expect(
      decideDeliveryReconciliation(facts({ state: 'failed_retryable', lease_until: null }))
    ).toEqual({ action: 'pause_ambiguous', reason: 'FAILED_WITHOUT_REPORT' });
  });
});

describe('affirmative evidence of no send authorizes a resend', () => {
  it('authorizes a resend when the failure was reported before any send', () => {
    expect(
      decideDeliveryReconciliation(
        facts({ state: 'failed_retryable', lease_until: null, reported_status: 'failed' })
      )
    ).toEqual({ action: 'authorize_resend', reason: 'REPORTED_FAILED_BEFORE_SEND' });
  });

  it('authorizes a resend for a delivery no workflow ever leased', () => {
    expect(
      decideDeliveryReconciliation(
        facts({ state: 'pending', lease_until: null, attempt_count: 0 })
      )
    ).toEqual({ action: 'authorize_resend', reason: 'NEVER_LEASED' });
  });

  it('abandons instead of resending once the attempt budget is spent', () => {
    expect(
      decideDeliveryReconciliation(
        facts({
          state: 'failed_retryable',
          lease_until: null,
          reported_status: 'failed',
          attempt_count: 3,
          max_attempts: 3,
        })
      )
    ).toEqual({ action: 'abandon', reason: 'MAX_ATTEMPTS_EXHAUSTED' });
  });
});

describe('live work is left alone', () => {
  it('waits while a lease is still held', () => {
    expect(
      decideDeliveryReconciliation(facts({ lease_until: '2026-08-11T12:05:00.000Z' }))
    ).toEqual({ action: 'wait', reason: 'LEASE_STILL_HELD' });
  });

  it.each(['dead_letter', 'cancelled'] as const)('waits on the terminal state %s', (state) => {
    expect(decideDeliveryReconciliation(facts({ state })).action).toBe('wait');
  });

  it('treats an unparseable lease as expired rather than as protection', () => {
    expect(decideDeliveryReconciliation(facts({ lease_until: 'not-a-date' })).action).toBe(
      'pause_ambiguous'
    );
  });
});
