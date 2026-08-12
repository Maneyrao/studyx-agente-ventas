/**
 * Limits and neutralization for anything retrieved into a prompt.
 *
 * Knowledge-base chunks and catalog rows are *data*. They are written by
 * whoever authored the source document, which in a sales pipeline means they
 * are effectively third-party input. Two failure modes follow, and this module
 * exists for both:
 *
 * 1. **Budget.** Retrieval that is unbounded in count or length quietly pushes
 *    the structured facts — the ones that outrank everything else — out of the
 *    model's attention. The caps here are deterministic and reported, so a
 *    dropped document is a number in a log line, never a silent omission.
 *
 * 2. **Injection.** A document that contains "ignore your instructions", or
 *    that closes the untrusted-context fence, is trying to become an
 *    instruction. Retrieved text can never be promoted to a system rule, so we
 *    strip the structural tricks and flag the semantic ones for the caller to
 *    log and downrank. Flagging rather than deleting is deliberate: a legit
 *    FAQ entry may quote such a phrase, and dropping it silently would be its
 *    own kind of wrong answer.
 *
 * Dependency-free. Same rules apply whether the text came from pgvector, the
 * catalog endpoint, or a future source.
 */

export const CONTEXT_FENCE_START = 'UNTRUSTED_CONTEXT_START';
export const CONTEXT_FENCE_END = 'UNTRUSTED_CONTEXT_END';

const FENCE_PATTERN = new RegExp(`${CONTEXT_FENCE_START}|${CONTEXT_FENCE_END}`, 'gi');

/** Everything except tab, newline and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

const INJECTION_PATTERNS: RegExp[] = [
  /ignor(a|á|e|en|ar|as)\s+(las\s+)?(instrucciones|reglas|indicaciones)/i,
  /ignore\s+(all\s+|the\s+|previous\s+|prior\s+)*(instructions|rules)/i,
  /disregard\s+(all\s+|the\s+|previous\s+|prior\s+)*(instructions|rules)/i,
  /olvid(a|á|ate|en)\s+(todo|las\s+instrucciones|las\s+reglas)/i,
  /\b(system|assistant|developer)\s*:/i,
  /\b(nuevas|new)\s+(instrucciones|instructions)\b/i,
  /\bprompt\s+(injection|del\s+sistema)\b/i,
  /\bact(ua|úa)\s+como\b/i,
  /\bact\s+as\s+(a|an|if)\b/i,
  /\bunrestricted\s+assistant\b/i,
  /\bjailbreak\b/i,
  /\bno\s+(sigas|obedezcas)\s+/i,
];

export interface SanitizedText {
  readonly text: string;
  /** true when the source contained something aimed at the agent, not the reader. */
  readonly injection_suspected: boolean;
  readonly truncated: boolean;
}

export function sanitizeRetrievedText(raw: string, maxChars: number): SanitizedText {
  const hadFence = FENCE_PATTERN.test(raw);
  FENCE_PATTERN.lastIndex = 0;

  const stripped = raw
    .replace(FENCE_PATTERN, ' ')
    .replace(CONTROL_CHARS, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const injection_suspected =
    hadFence || INJECTION_PATTERNS.some((pattern) => pattern.test(stripped));

  const truncated = stripped.length > maxChars;
  return {
    text: truncated ? stripped.slice(0, maxChars) : stripped,
    injection_suspected,
    truncated,
  };
}

export interface RetrievalLimits {
  readonly maxItems: number;
  readonly maxCharsPerItem: number;
  readonly maxTotalChars: number;
}

export interface CappedItem<T> {
  readonly item: T;
  readonly text: string;
  readonly injection_suspected: boolean;
  readonly truncated: boolean;
}

export interface CappedRetrieval<T> {
  readonly kept: Array<CappedItem<T>>;
  readonly dropped: number;
  readonly total_chars: number;
  readonly injection_suspected_count: number;
}

/**
 * Apply the three caps in the only order that is safe: per-item truncation
 * first, then the total budget. Measuring the budget against untruncated text
 * would let one oversized document evict every other result.
 */
export function capRetrievedItems<T>(
  items: readonly T[],
  extract: (item: T) => string,
  limits: RetrievalLimits
): CappedRetrieval<T> {
  const kept: Array<CappedItem<T>> = [];
  let total = 0;
  let injection = 0;

  for (const item of items) {
    if (kept.length >= limits.maxItems) break;
    const sanitized = sanitizeRetrievedText(extract(item), limits.maxCharsPerItem);
    if (total + sanitized.text.length > limits.maxTotalChars) break;

    total += sanitized.text.length;
    if (sanitized.injection_suspected) injection += 1;
    kept.push({
      item,
      text: sanitized.text,
      injection_suspected: sanitized.injection_suspected,
      truncated: sanitized.truncated,
    });
  }

  return {
    kept,
    dropped: items.length - kept.length,
    total_chars: total,
    injection_suspected_count: injection,
  };
}
