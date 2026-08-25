import { PaymentPlanCode } from './payment-link';

/**
 * Deterministic derivation of `allowed_payment_plan` from the CURRENT batch
 * only (spec §4.1). This is the one and only source the backend trusts for
 * "which plan did the customer choose": never memory, never the summary,
 * never tone, never a choice from an earlier turn. A caller that wants the
 * previous turn's choice to count must pass it in as part of the current
 * batch messages itself — this function has no other way to see it, by
 * construction.
 *
 * Matching is case- and accent-insensitive. A batch that matches two or more
 * plans, or none, is ambiguous and returns null: the backend must clarify,
 * never guess or fall back to a different plan.
 *
 * Covered phrasings per plan (spec §4 step 1):
 *   - monthly_12: "12 meses", "12 cuotas", "12 pagos", "USD 30 por mes"
 *   - monthly_6:  "6 meses", "6 cuotas", "6 pagos", "USD 60 por mes"
 *   - one_time:   "contado", "pago único", "todo junto", "un solo pago",
 *                 "pago total", "un único pago"
 */

export interface PolicyBatchMessage {
  readonly content: string;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const PLAN_PATTERNS: ReadonlyArray<{ readonly code: PaymentPlanCode; readonly pattern: RegExp }> = [
  {
    code: 'monthly_12',
    pattern:
      /(?:\b12\s*(?:meses|cuotas|pagos)\b|\b(?:usd\s*)?30\s*(?:usd|dolares?)?\s*(?:por\s+mes|mensuales?)\b|\bcuotas?\s+de\s*(?:usd\s*)?30(?:\s*(?:usd|dolares?))?\b)/,
  },
  {
    code: 'monthly_6',
    pattern:
      /(?:\b6\s*(?:meses|cuotas|pagos)\b|\b(?:usd\s*)?60\s*(?:usd|dolares?)?\s*(?:por\s+mes|mensuales?)\b|\bcuotas?\s+de\s*(?:usd\s*)?60(?:\s*(?:usd|dolares?))?\b)/,
  },
  {
    code: 'one_time',
    pattern:
      /\b(?:contado|pago\s+unico|todo\s+junto|un\s+solo\s+pago|pago\s+total|(?:un\s+)?unico\s+pago)\b/,
  },
];

const PAYMENT_DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\bno\s+me\s+(?:mandes|envies|pases|compartas)\s+(?:el\s+)?link\b/,
  /\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b/,
  /\b(?:solo|solamente)\s+(?:consultaba|preguntaba|averiguaba)\b/,
  /\bsi\s+(?:comprara|me\s+anotara|me\s+inscribiera|eligiera)\b/,
];

const TEMPORAL_PAYMENT_DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\bno\s+me\s+(?:mandes|envies|pases|compartas)\s+(?:el\s+)?link\b/,
  /\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b/,
];

const NON_COMMITTAL_PAYMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:solo|solamente)\s+(?:consultaba|preguntaba|averiguaba)\b/,
  /\bsi\s+(?:comprara|me\s+anotara|me\s+inscribiera|eligiera)\b/,
];

const EXPLICIT_PAYMENT_RESUME_PATTERN =
  /\bahora\s+si\b.{0,48}\b(?:manda|mandame|mandamelo|envia|enviame|pasame|comparti|compartime)(?:lo|la|me)?\b/u;

function plansMentionedIn(normalized: string): Set<PaymentPlanCode> {
  const matched = new Set<PaymentPlanCode>();
  for (const { code, pattern } of PLAN_PATTERNS) {
    if (pattern.test(normalized)) matched.add(code);
  }
  return matched;
}

export type CurrentPaymentIntent =
  | { readonly kind: 'direct'; readonly planCode: PaymentPlanCode }
  | { readonly kind: 'resume' }
  | { readonly kind: 'veto' }
  | { readonly kind: 'none' };

/** Current-batch authority. Any veto wins before direct or resume intent. */
export function classifyCurrentPaymentIntent(
  messages: readonly PolicyBatchMessage[]
): CurrentPaymentIntent {
  const normalizedMessages = messages.map((message) => normalize(message.content ?? ''));
  if (normalizedMessages.some((message) => (
    PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(message))
  ))) {
    return { kind: 'veto' };
  }

  const matched = new Set<PaymentPlanCode>();
  for (const message of normalizedMessages) {
    for (const plan of plansMentionedIn(message)) matched.add(plan);
  }
  if (matched.size === 1) return { kind: 'direct', planCode: [...matched][0]! };
  if (matched.size > 1) return { kind: 'none' };
  if (normalizedMessages.some((message) => EXPLICIT_PAYMENT_RESUME_PATTERN.test(message))) {
    return { kind: 'resume' };
  }
  return { kind: 'none' };
}

/**
 * Recovers only a real plan selection that was explicitly postponed. It is
 * deliberately narrower than generic deferral: hypothetical and
 * information-only phrases never become resumable purchase authority.
 */
export function deriveDeferredPaymentChoiceFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const matched = new Set<PaymentPlanCode>();
  let temporallyDeferred = false;
  for (const message of messages) {
    const normalized = normalize(message.content ?? '');
    if (NON_COMMITTAL_PAYMENT_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
    if (TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
      temporallyDeferred = true;
    }
    for (const plan of plansMentionedIn(normalized)) matched.add(plan);
  }
  if (!temporallyDeferred || matched.size !== 1) return null;
  return [...matched][0] ?? null;
}

export function derivePaymentChoiceFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const intent = classifyCurrentPaymentIntent(messages);
  return intent.kind === 'direct' ? intent.planCode : null;
}
