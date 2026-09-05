import { describe, expect, it } from 'vitest';
import { parseConversationStateVersionV1 } from '@/features/conversation/domain/state-version';

describe('parseConversationStateVersionV1', () => {
  it.each([
    [1, 1],
    ['2', 2],
  ])('accepts a positive integer version %s', (value, expected) => {
    expect(parseConversationStateVersionV1(value)).toBe(expected);
  });

  it.each([0, -1, 1.5, '0', '-1', '1.5', 'nope', ''])
    ('rejects the invalid optimistic version %s', (value) => {
      expect(() => parseConversationStateVersionV1(value))
        .toThrow('CONVERSATION_STATE_VERSION_INVALID');
    });
});
