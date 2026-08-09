import { describe, expect, it } from 'vitest';
import { decideRetry } from '../../helpers/retry-policy';

describe('delivery retry policy executable specification', () => {
  it.each([408, 425, 429, 500, 502, 503])('retries transient HTTP %s responses', (statusCode) => {
    expect(decideRetry({ attempt: 1, statusCode })).toEqual({ action: 'retry', delayMs: 1_000 });
  });

  it.each(['timeout', 'network', 'unknown'] as const)('retries %s transport failures', (errorCode) => {
    expect(decideRetry({ attempt: 2, errorCode, providerSupportsIdempotency: true })).toEqual({
      action: 'retry',
      delayMs: 2_000,
    });
  });

  it.each([400, 401, 403, 404, 422])('dead-letters permanent HTTP %s responses', (statusCode) => {
    expect(decideRetry({ attempt: 1, statusCode })).toEqual({
      action: 'dead_letter',
      reason: 'permanent_error',
    });
  });

  it('reconciles provider conflicts instead of blindly resending', () => {
    expect(decideRetry({ attempt: 1, statusCode: 409 })).toEqual({
      action: 'reconcile',
      reason: 'provider_conflict',
    });
  });

  it('reconciles an ambiguous transport failure when replay safety is unknown', () => {
    expect(decideRetry({ attempt: 1, errorCode: 'timeout' })).toEqual({
      action: 'reconcile',
      reason: 'ambiguous_delivery',
    });
  });

  it('honors Retry-After without exceeding the configured cap', () => {
    expect(decideRetry({ attempt: 2, statusCode: 429, retryAfterMs: 45_000 })).toEqual({
      action: 'retry',
      delayMs: 45_000,
    });
    expect(decideRetry({ attempt: 2, statusCode: 429, retryAfterMs: 120_000 })).toEqual({
      action: 'retry',
      delayMs: 60_000,
    });
  });

  it('caps exponential backoff', () => {
    expect(
      decideRetry(
        { attempt: 5, statusCode: 503 },
        { maxAttempts: 10, baseDelayMs: 10_000, maxDelayMs: 60_000 }
      )
    ).toEqual({ action: 'retry', delayMs: 60_000 });
  });

  it('dead-letters after the configured attempt budget', () => {
    expect(decideRetry({ attempt: 5, statusCode: 503 })).toEqual({
      action: 'dead_letter',
      reason: 'attempts_exhausted',
    });
  });

  it('rejects an invalid attempt counter', () => {
    expect(() => decideRetry({ attempt: 0, statusCode: 503 })).toThrow(
      'attempt must be a positive integer'
    );
  });
});
