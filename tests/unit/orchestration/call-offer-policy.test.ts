import { describe, expect, it } from 'vitest';
import {
  evaluateCallOfferPolicy,
  type CallOfferPolicyFacts,
} from '@/features/orchestration/domain/call-offer-policy';
import type { DeterministicSalesSignal } from '@/features/orchestration/domain/sales-signal';

const now = '2026-08-16T12:00:00.000Z';
const nowMs = Date.parse(now);

function minutesAgo(minutes: number): string {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(nowMs + minutes * 60_000).toISOString();
}

function facts(overrides: Partial<CallOfferPolicyFacts> = {}): CallOfferPolicyFacts {
  return {
    now,
    signal: { type: 'model_required' },
    openOffer: null,
    lastDeclineAt: null,
    optedOut: false,
    blocked: false,
    activeCall: false,
    ...overrides,
  };
}

const acceptance: DeterministicSalesSignal = { type: 'call_acceptance' };
const directRequest: DeterministicSalesSignal = { type: 'direct_call_request' };
const decline: DeterministicSalesSignal = { type: 'call_decline' };

describe('evaluateCallOfferPolicy', () => {
  it('allows offering a call when nothing blocks it and none is pending', () => {
    const result = evaluateCallOfferPolicy(facts());

    expect(result.allowedActions).toEqual(['offer_call']);
    expect(result.openOffer).toBeNull();
    expect(result.cooldownUntil).toBeNull();
    expect(result.reason).toBe('ELIGIBLE_FOR_OFFER');
  });

  it('always honors a direct call request', () => {
    const result = evaluateCallOfferPolicy(facts({ signal: directRequest }));

    expect(result.allowedActions).toEqual(['request_call_now']);
    expect(result.reason).toBe('DIRECT_REQUEST');
  });

  it('accepts a short "sí" against a 14-minute-old offer, inside the 15-minute lifetime', () => {
    const result = evaluateCallOfferPolicy(
      facts({
        signal: acceptance,
        openOffer: { decisionId: 'offer-1', offeredAt: minutesAgo(14) },
      })
    );

    expect(result.allowedActions).toEqual(['request_call_now']);
    expect(result.openOffer).toBeNull();
    expect(result.reason).toBe('OFFER_ACCEPTED');
  });

  it('rejects a short "sí" against a 16-minute-old offer, past the 15-minute lifetime', () => {
    const result = evaluateCallOfferPolicy(
      facts({
        signal: acceptance,
        openOffer: { decisionId: 'offer-1', offeredAt: minutesAgo(16) },
      })
    );

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('OFFER_EXPIRED');
  });

  it('rejects a short "sí" when there is no open offer at all', () => {
    const result = evaluateCallOfferPolicy(facts({ signal: acceptance }));

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('NO_OPEN_OFFER');
  });

  it('rejects a short "sí" during an active decline cooldown', () => {
    const result = evaluateCallOfferPolicy(
      facts({ signal: acceptance, lastDeclineAt: minutesAgo(10) })
    );

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('DECLINE_COOLDOWN_ACTIVE');
    expect(result.cooldownUntil).toBe(minutesFromNow(20));
  });

  it('still honors an explicit new direct request during an active decline cooldown', () => {
    const result = evaluateCallOfferPolicy(
      facts({ signal: directRequest, lastDeclineAt: minutesAgo(10) })
    );

    expect(result.allowedActions).toEqual(['request_call_now']);
    expect(result.reason).toBe('DIRECT_REQUEST');
    expect(result.cooldownUntil).toBe(minutesFromNow(20));
  });

  it('starts a 30-minute cooldown on a decline', () => {
    const result = evaluateCallOfferPolicy(facts({ signal: decline }));

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('DECLINED');
    expect(result.cooldownUntil).toBe(minutesFromNow(30));
    expect(result.openOffer).toBeNull();
  });

  it('does not offer again while a decline cooldown is still active', () => {
    const result = evaluateCallOfferPolicy(facts({ lastDeclineAt: minutesAgo(29) }));

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('DECLINE_COOLDOWN_ACTIVE');
  });

  it('resumes offering once the decline cooldown has elapsed', () => {
    const result = evaluateCallOfferPolicy(facts({ lastDeclineAt: minutesAgo(31) }));

    expect(result.allowedActions).toEqual(['offer_call']);
    expect(result.reason).toBe('ELIGIBLE_FOR_OFFER');
  });

  it('does not offer again while an earlier offer is still awaiting a response', () => {
    const result = evaluateCallOfferPolicy(
      facts({ openOffer: { decisionId: 'offer-1', offeredAt: minutesAgo(5) } })
    );

    expect(result.allowedActions).toEqual([]);
    expect(result.reason).toBe('OFFER_PENDING_RESPONSE');
    expect(result.openOffer).toEqual({ decisionId: 'offer-1', expiresAt: minutesFromNow(10) });
  });

  it.each([
    ['opted out', { optedOut: true }],
    ['opt-out signal this turn', { signal: { type: 'opt_out' as const } }],
    ['blocked contact', { blocked: true }],
    ['active call in progress', { activeCall: true }],
  ] as const)('returns no sales actions when %s', (_label, override) => {
    const result = evaluateCallOfferPolicy(facts(override));

    expect(result.allowedActions).toEqual([]);
    expect(result.openOffer).toBeNull();
  });
});
