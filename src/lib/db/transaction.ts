import { sql } from './orchestrator';
import type { DbClient } from './types';
import { getPostgresError } from './types';

const RETRYABLE_TRANSACTION_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
]);

const DEFAULT_MAX_ATTEMPTS = 3;

export interface TransactionRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const postgresError = getPostgresError(error);
  return Boolean(postgresError?.code && RETRYABLE_TRANSACTION_CODES.has(postgresError.code));
}

export function transactionRetryDelay(
  failedAttempt: number,
  baseDelayMs = 25,
  maxDelayMs = 250,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, failedAttempt - 1));
  return Math.floor(random() * ceiling);
}

export async function withSerializableTransaction<T>(
  operation: (transaction: DbClient) => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 3));
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return (await sql.begin('isolation level serializable', operation)) as T;
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) throw error;
      await wait(transactionRetryDelay(attempt, options.baseDelayMs, options.maxDelayMs, options.random));
    }
  }

  throw new Error('Transaction retry loop exhausted unexpectedly');
}
