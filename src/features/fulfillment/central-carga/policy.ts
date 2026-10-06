import type { EnrollmentSource } from './contract';

/** CLAUDE.md: at most three attempts, whatever the row says. */
export const HARD_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3600;

export function effectiveMaxAttempts(rowMaxAttempts: number): number {
  return Math.min(Math.max(rowMaxAttempts, 1), HARD_MAX_ATTEMPTS);
}

/** Exponential backoff with +/-25% jitter. `random` is injectable for tests. */
export function computeBackoffSeconds(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    MAX_BACKOFF_SECONDS,
    BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attemptCount - 1),
  );
  const jitter = 0.75 + random() * 0.5;
  return Math.max(1, Math.round(base * jitter));
}

export type PreflightDecision =
  | { action: 'proceed' }
  | { action: 'skip'; code: string }
  | { action: 'dead_letter'; code: string };

/**
 * Checks that must pass before the Central is ever contacted. Order matters:
 * skips (this payment is not ours to enroll) come before dead letters (it is,
 * but a human has to fix the data).
 */
export function preflight(input: {
  source: EnrollmentSource;
  paymentStatus: string;
  sandboxContact: boolean;
  environment: 'test' | 'live';
  paidAfter: Date;
}): PreflightDecision {
  const { source } = input;
  if (input.paymentStatus !== 'paid') return { action: 'skip', code: 'payment_not_paid' };
  if (input.sandboxContact) return { action: 'skip', code: 'sandbox_contact' };
  if (source.provider !== 'stripe') return { action: 'skip', code: 'unsupported_provider' };
  if (source.environment !== input.environment) {
    return { action: 'skip', code: 'environment_mismatch' };
  }
  if (!source.paid_at || source.paid_at.getTime() < input.paidAfter.getTime()) {
    return { action: 'skip', code: 'before_enrollment_cutoff' };
  }
  if (!source.contact_name?.trim() || !source.contact_email?.trim()) {
    return { action: 'dead_letter', code: 'missing_student_identity' };
  }
  return { action: 'proceed' };
}
