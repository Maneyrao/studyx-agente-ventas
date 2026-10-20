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

export type KnownContactIntakeV1 = {
  readonly nombre: string | null;
  readonly apellido: string | null;
  readonly correo: string | null;
  readonly telefono: string | null;
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function unwrapContactDatum(text: string): string {
  return normalize(text)
    .replace(
      /^(?:mi\s+)?(?:nombre(?:\s+completo)?|apellido|correo(?:\s+electronico)?|e-?mail|mail|telefono|celular|numero)(?:\s+(?:es|seria))?\s*[:=\-]?\s*/u,
      '',
    )
    .replace(/^[¿¡!.,;:\s]+|[¿¡!.,;:\s]+$/gu, '')
    .trim();
}

/**
 * Detects a turn that contributes only literal profile data. This is not a
 * language classifier: it compares the current text with the canonical
 * values already persisted for the contact. Its purpose is to keep a final
 * email/name/phone from doubling as consent to start a call.
 */
export function isBatchOnlyKnownContactDataV1(
  texts: readonly string[],
  intake: KnownContactIntakeV1 | null | undefined,
): boolean {
  if (!intake) return false;
  const values = texts.map(unwrapContactDatum).filter(Boolean);
  if (values.length === 0) return false;

  const knownWords = new Set([
    intake.nombre,
    intake.apellido,
    [intake.nombre, intake.apellido].filter(Boolean).join(' '),
    intake.correo,
  ].filter((value): value is string => Boolean(value?.trim())).map(unwrapContactDatum));
  const knownEmail = intake.correo?.trim().toLowerCase() ?? null;
  const knownPhoneDigits = intake.telefono?.replace(/\D/gu, '') ?? '';

  return values.every((value) => {
    if (knownWords.has(value)) return true;
    if (knownEmail !== null && value.toLowerCase() === knownEmail) return true;
    if (!/^\+?[\d\s().-]+$/u.test(value)) return false;
    const digits = value.replace(/\D/gu, '');
    return knownPhoneDigits.length >= 8 && digits === knownPhoneDigits;
  });
}

// Broader than a call decline: the customer wants no further contact at all,
// not just no phone call.
// Call-specific: the customer does not want to be called, but did not ask to
// stop all contact.
const CALL_DECLINE_PATTERNS: RegExp[] = [
  /\bno\s+(?:me\s+)?llam(?:es|en)?\b/,
  /\bno\s+quiero\s+(?:una\s+|la\s+)?llamadas?\b/,
  /\bno\s+(?:quisiera|me\s+gustaria)\s+(?:(?:una\s+)?llamada|que\s+me\s+(?:llam\w*|contact\w*)(?:\s+por\s+telefono)?)\b/,
  /\bno\s+quiero\s+que\s+me\s+llam(?:es|en)\b/,
  /\bsin\s+llamadas?\b/,
  /\bno\s+por\s+telefono\b/,
  /\bno\s+por\s+llamada\b/,
  /\bprefiero\s+(?:whatsapp|chat|texto)\b/,
  /\bsolo\s+(?:whatsapp|chat|texto)\b/,
  /\bno\s+puedo\s+atender\s+llamadas?\b/,
  /\b(?:ahora\s+)?no\s+puedo\s+(?:atender|hablar)\b/,
  /\bno\s+estoy\s+disponible\b/,
  /\bdeja\s+de\s+llamarme\b/,
];

const DIRECT_CALL_REQUEST_PATTERNS: RegExp[] = [
  /\bllamame\b/,
  /\bllamenme\b/,
  /\bpodes llamarme\b/,
  /\b(?:quiero|necesito)\s+que\s+me\s+llam(?:es|en)\b/,
  /\b(?:pueden|podrian|podes)\s+llamarme\b/,
  /\bme\s+(?:pueden|podrian|podes|puedes)\s+llamar\b/,
  /\bme\s+llamas\b/,
  /^que\s+me\s+llam(?:es|en)\b.{0,32}\bpuede\s+ser\b/,
  /\bme\s+volves\s+a\s+llamar\b/,
  /\bvolveme\s+a\s+llamar\b/,
  /\b(?:quiero|necesito)\s+una\s+llamada\b/,
  /\b(?:quisiera|desearia|me\s+gustaria)\s+(?:(?:una\s+)?llamada|(?:que\s+me\s+)?(?:llam\w*|contact\w*)(?:\s+por\s+telefono)?|(?:hablar|conversar)\s+por\s+telefono)\b/,
  /\bque\s+me\s+llame\s+(?:un|una)\s+asesor(?:a)?\b/,
  /\bnecesito\s+hablar\s+por\s+telefono\b/,
  /\bcomuniquense\s+conmigo\b/,
  /\bpor\s+llamada\b/,
  /^(?:llamar|llamada)$/,
];

// These phrases are affirmative only in the presence of a durable retry
// prompt produced after a failed/interrupted call. The classifier reports the
// linguistic signal; the call-offer policy still refuses it without that
// persisted context.
const RETRY_ACCEPTANCE_PATTERNS: RegExp[] = [
  /^(?:(?:si|dale)\s+)?(?:intenta|intenten|intentemos|proba|probe|probemos|prueba|prueben|reintenta|reintentemos)\s+(?:nuevamente|de\s+nuevo|otra\s+vez)$/,
];

// Only an exact short reply counts — the moment the customer adds words
// ("sí, contame más") the affirmative is no longer unambiguous on its own,
// so it falls through to `model_required`.
const SHORT_ACCEPTANCE_REPLIES = new Set(['si', 'dale', 'de una', 'dale de una']);

export function classifyDeterministicSalesSignal(text: string): DeterministicSalesSignal {
  const normalized = normalize(text);
  const phrase = normalized
    .replace(/[¿¡!.,;:]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  if (RETRY_ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(phrase))) {
    return { type: 'call_acceptance' };
  }

  const bareReply = normalized
    .replace(/^[¿¡!.,;: ]+|[¿¡!.,;: ]+$/g, '')
    .replace(/^bueno,?\s+/u, '');
  // Chat commonly stretches the final letter for emphasis ("sii",
  // "daleee"). Canonicalize only that terminal repetition and only for the
  // bounded short-reply check below; longer prose still requires the model.
  const canonicalShortReply = bareReply.replace(/(.)\1+$/u, '$1');
  if (SHORT_ACCEPTANCE_REPLIES.has(canonicalShortReply)) {
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
import { isExplicitOptOut } from '../../../lib/heuristics/opt-out';
