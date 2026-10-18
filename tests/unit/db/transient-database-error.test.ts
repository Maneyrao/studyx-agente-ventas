import { describe, expect, it } from 'vitest';
import { isTransientDatabaseAvailabilityError } from '@/lib/db/types';

describe('transient database availability errors', () => {
  it.each(['CONNECTION_DESTROYED', '57014'])(
    'classifies observed production database interruption %s as retryable',
    (code) => {
      expect(isTransientDatabaseAvailabilityError(Object.assign(new Error(code), { code }))).toBe(true);
    },
  );

  it('recognizes an interruption wrapped as the cause of a service error', () => {
    const cause = Object.assign(new Error('statement timeout'), { code: '57014' });
    const error = new Error('database unavailable', { cause });

    expect(isTransientDatabaseAvailabilityError(error)).toBe(true);
  });

  it('does not classify an ordinary application error as a database interruption', () => {
    expect(isTransientDatabaseAvailabilityError(new Error('validation failed'))).toBe(false);
  });
});
