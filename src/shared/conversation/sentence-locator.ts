/**
 * Backend and Botpress segment sentences differently (the truth guard cuts after
 * ". ! ?" plus whitespace; the claim repair also cuts at newlines). A violating
 * sentence is therefore identified by the bubble that carries it plus
 * containment after folding, never by exact equality of segments.
 */
export function foldSentenceV1(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const MIN_CONTAINED_LENGTH = 8;

/**
 * True when one folded text contains the other. A very short contained piece
 * ("dale") must match exactly, so it is never swept in by a longer sentence.
 */
export function sentencesOverlapV1(left: string, right: string): boolean {
  const a = foldSentenceV1(left);
  const b = foldSentenceV1(right);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_CONTAINED_LENGTH && longer.includes(shorter);
}

/** `{ message_index }` of the first bubble that carries the sentence, or `{}` when none does. */
export function messageIndexOfSentenceV1(messages: readonly string[], sentence: string): { message_index?: number } {
  const index = messages.findIndex((message) => sentencesOverlapV1(message, sentence));
  return index >= 0 ? { message_index: index } : {};
}
