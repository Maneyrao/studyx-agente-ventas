import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares secret material without leaking either value or its length. */
export function constantTimeSecretEqual(actual: string | null, expected: string): boolean {
  if (actual === null || expected.length === 0) return false;
  const actualHash = createHash('sha256').update(actual, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(actualHash, expectedHash);
}
