import { describe, expect, it } from 'vitest';
import { messageIndexOfSentenceV1 } from '@/shared/conversation/sentence-locator';

describe('messageIndexOfSentenceV1', () => {
  it('finds the bubble despite punctuation, emoji and case differences', () => {
    const messages = ['Hola, mucho gusto.', 'El plan sale USD 699 hoy 😀'];
    expect(messageIndexOfSentenceV1(messages, 'El plan sale USD 699 hoy!')).toEqual({ message_index: 1 });
    expect(messageIndexOfSentenceV1(messages, 'No está en ningún lado.')).toEqual({});
  });
});
