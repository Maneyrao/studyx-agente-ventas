/**
 * Deterministic classification of customer text into a small, fixed set of
 * sales signals.
 *
 * This module answers exactly one question — does the customer's own words,
 * read literally, already settle whether they want a call — without any
 * model call and without any knowledge of what offer (if any) is currently
 * open. That context-free scope is deliberate: a bare "sí" means nothing on
 * its own, so this classifier commits only to what the text itself carries.
 * Combining a `call_acceptance` classification with an actual open offer is
 * the call-offer policy's job (`call-offer-policy.ts`), not this one's.
 *
 * The pattern list stays intentionally narrow. Anything that is not an exact
 * match for a known pattern returns `model_required` rather than guessing —
 * a wrong deterministic call (offering or declining on the customer's
 * behalf) is worse than asking the model to read one more turn of context.
 */

export type DeterministicSalesSignal =
  | { type: 'direct_call_request' }
  | { type: 'call_acceptance' }
  | { type: 'call_decline' }
  | { type: 'opt_out' }
  | { type: 'model_required' };

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Broader than a call decline: the customer wants no further contact at all,
// not just no phone call.
// Call-specific: the customer does not want to be called, but did not ask to
// stop all contact.
const CALL_DECLINE_PATTERNS: RegExp[] = [
  /\bno\s+(?:me\s+)?llam(?:es|en)?\b/,
  /\bno\s+quiero\s+(?:una\s+|la\s+)?llamadas?\b/,
  /\bno\s+quiero\s+que\s+me\s+llamen\b/,
  /\bsin\s+llamadas?\b/,
  /\bno\s+por\s+telefono\b/,
  /\bprefiero\s+(?:whatsapp|chat|texto)\b/,
  /\bsolo\s+(?:whatsapp|chat|texto)\b/,
  /\bno\s+puedo\s+atender\s+llamadas?\b/,
  /\bdeja\s+de\s+llamarme\b/,
];

const DIRECT_CALL_REQUEST_PATTERNS: RegExp[] = [
  /\bllamame\b/,
  /\bllamenme\b/,
  /\bpodes llamarme\b/,
  /\b(?:quiero|necesito)\s+que\s+me\s+llamen\b/,
  /\b(?:pueden|podrian|podes)\s+llamarme\b/,
  /\bme\s+llamas\b/,
  /\b(?:quiero|necesito)\s+una\s+llamada\b/,
  /\bque\s+me\s+llame\s+(?:un|una)\s+asesor(?:a)?\b/,
  /\bnecesito\s+hablar\s+por\s+telefono\b/,
  /\bcomuniquense\s+conmigo\b/,
];

// Only an exact short reply counts — the moment the customer adds words
// ("sí, contame más") the affirmative is no longer unambiguous on its own,
// so it falls through to `model_required`.
const SHORT_ACCEPTANCE_REPLIES = new Set(['si', 'dale', 'de una']);

export function classifyDeterministicSalesSignal(text: string): DeterministicSalesSignal {
  const normalized = normalize(text);

  // Negations run before affirmative patterns: "Sí, pero no me llames" must
  // classify as a decline even though it contains an affirmative "sí".
  if (isExplicitOptOut(text)) {
    return { type: 'opt_out' };
  }
  if (CALL_DECLINE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { type: 'call_decline' };
  }

  if (DIRECT_CALL_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { type: 'direct_call_request' };
  }

  const bareReply = normalized.replace(/^[¿¡!.,;: ]+|[¿¡!.,;: ]+$/g, '');
  if (SHORT_ACCEPTANCE_REPLIES.has(bareReply)) {
    return { type: 'call_acceptance' };
  }

  return { type: 'model_required' };
}

/**
 * Classify a whole inbound burst: the customer's most recent decisive words
 * win. Scanning from the newest message backwards, the first message that
 * carries a definite signal decides the batch — "llamame" followed by
 * "gracias" is still a direct request, while "llamame" followed by
 * "no, mejor no" is a decline. A batch with no decisive message at all is
 * `model_required`, exactly like a single ambiguous message.
 */
export function classifyBatchSalesSignal(texts: readonly string[]): DeterministicSalesSignal {
  return classifyBatchSalesSignalWithIndex(texts).signal;
}

/**
 * Same scan, but also reports WHICH message decided the batch, so callers
 * that need evidence (e.g. the call-consent source message) can point at the
 * exact text that carried the signal. `index` is null for `model_required`.
 */
export function classifyBatchSalesSignalWithIndex(texts: readonly string[]): {
  signal: DeterministicSalesSignal;
  index: number | null;
} {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const signal = classifyDeterministicSalesSignal(texts[index]);
    if (signal.type !== 'model_required') return { signal, index };
  }
  return { signal: { type: 'model_required' }, index: null };
}
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
