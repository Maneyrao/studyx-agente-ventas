import { describe, expect, it } from 'vitest';
import { resolveProviderOccurrenceV1 } from '@/lib/heuristics/provider-occurrence';

describe('resolveProviderOccurrenceV1', () => {
  const receivedAt = '2026-09-23T12:00:00.000Z';

  it('trusts a valid provider timestamp inside the bounded skew window', () => {
    expect(resolveProviderOccurrenceV1({
      providerOccurredAt: '2026-09-23T11:59:58.000Z',
      receivedAt,
    })).toEqual({
      provider_occurred_at: '2026-09-23T11:59:58.000Z',
      occurred_at: '2026-09-23T11:59:58.000Z',
      occurred_at_trusted: true,
    });
  });

  it.each([
    ['invalid', 'not-a-date'],
    ['too old', '2026-09-23T11:54:59.999Z'],
    ['too far in the future', '2026-09-23T12:02:00.001Z'],
  ])('falls back to receive time when provider time is %s', (_label, providerOccurredAt) => {
    expect(resolveProviderOccurrenceV1({ providerOccurredAt, receivedAt })).toEqual({
      provider_occurred_at: providerOccurredAt,
      occurred_at: receivedAt,
      occurred_at_trusted: false,
    });
  });
});
