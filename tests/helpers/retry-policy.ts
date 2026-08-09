export interface RetryContext {
  attempt: number;
  statusCode?: number;
  errorCode?: 'timeout' | 'network' | 'unknown';
  retryAfterMs?: number;
  providerSupportsIdempotency?: boolean;
}

export interface RetryPolicyOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type RetryDecision =
  | { action: 'retry'; delayMs: number }
  | { action: 'reconcile'; reason: 'ambiguous_delivery' | 'provider_conflict' }
  | { action: 'dead_letter'; reason: 'attempts_exhausted' | 'permanent_error' };

export const DEFAULT_RETRY_POLICY: RetryPolicyOptions = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

export function decideRetry(
  context: RetryContext,
  policy: RetryPolicyOptions = DEFAULT_RETRY_POLICY
): RetryDecision {
  if (!Number.isInteger(context.attempt) || context.attempt < 1) {
    throw new Error('attempt must be a positive integer');
  }

  if (context.attempt >= policy.maxAttempts) {
    return { action: 'dead_letter', reason: 'attempts_exhausted' };
  }

  const status = context.statusCode;
  if (status === 409) {
    return { action: 'reconcile', reason: 'provider_conflict' };
  }

  const retryableStatus = status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
  const retryableTransport = context.errorCode === 'timeout' || context.errorCode === 'network' || context.errorCode === 'unknown';

  if (retryableTransport && !context.providerSupportsIdempotency) {
    return { action: 'reconcile', reason: 'ambiguous_delivery' };
  }

  if (!retryableStatus && !retryableTransport) {
    return { action: 'dead_letter', reason: 'permanent_error' };
  }

  const exponentialDelay = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (context.attempt - 1)
  );
  const delayMs = Math.min(
    policy.maxDelayMs,
    Math.max(exponentialDelay, context.retryAfterMs ?? 0)
  );

  return { action: 'retry', delayMs };
}
