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

/**
 * Los planes también se nombran en letras.
 *
 * El backend deriva el plan del mensaje del cliente y exige que coincida con
 * el que autorizó el modelo; si difieren, el commit muere con
 * `PAYMENT_PLAN_MISMATCH`, el workflow queda en `paused_error` y el turno sale
 * MUDO. Aceptar sólo numerales significaba que quien escribe "me quedo con las
 * seis cuotas" no podía comprar, aunque el modelo lo entendiera perfecto.
 *
 * Ninguna suite lo detectaba: todos sus guiones dicen "las 6 cuotas". Lo
 * encontró el arnés de workflow con una paráfrasis nueva.
 */
const PLAN_PATTERNS: ReadonlyArray<{ readonly code: PaymentPlanCode; readonly pattern: RegExp }> = [
  {
    code: 'monthly_12',
    pattern:
      /(?:\b(?:12|doce)\s*(?:meses|cuotas|pagos)\b|\b(?:usd\s*)?30\s*(?:usd|dolares?)?\s*(?:por\s+mes|mensuales?)\b|\bcuotas?\s+de\s*(?:usd\s*)?30(?:\s*(?:usd|dolares?))?\b)/,
  },
  {
    code: 'monthly_6',
    pattern:
      /(?:\b(?:6|seis)\s*(?:meses|cuotas|pagos)\b|\b(?:usd\s*)?60\s*(?:usd|dolares?)?\s*(?:por\s+mes|mensuales?)\b|\bcuotas?\s+de\s*(?:usd\s*)?60(?:\s*(?:usd|dolares?))?\b)/,
  },
  {
    code: 'one_time',
    pattern:
      /\b(?:contado|pago\s+unico|todo\s+junto|un\s+solo\s+pago|pago\s+total|(?:un\s+)?unico\s+pago)\b/,
  },
];

const NARRATIVE_CONTADO_PATTERN =
  /\b(?:(?:me|te|le|nos|les)\s+)?(?:habia|habias|habiamos|habian|he|has|ha|hemos|han)\s+contado\b/;
const EXPLICIT_ONE_TIME_WITHOUT_CONTADO_PATTERN =
  /\b(?:pago\s+unico|todo\s+junto|un\s+solo\s+pago|pago\s+total|(?:un\s+)?unico\s+pago)\b/;

const ONE_TIME_AMOUNT_PATTERN =
  /\bun\s+pago\s+de\s+(?:usd\s*)?360(?:\s*(?:usd|dolares?))?\b/;
const SHORT_ONE_TIME_AMOUNT_SELECTION_PATTERN =
  /^(?:un\s+pago\s+de\s+(?:usd\s*)?360(?:\s*(?:usd|dolares?))?)(?:\s+(?:por\s+favor|porfa|me\s+sirve|esta\s+bien))?$/u;
const COMMITTED_ONE_TIME_AMOUNT_SELECTION_PATTERN =
  /\b(?:confirmo|prefiero|elijo|elegi|me\s+quedo\s+con|voy\s+con|quiero(?:\s+pagar)?)\b[^.!?;,\n]{0,48}\bun\s+pago\s+de\s+(?:usd\s*)?360(?:\s*(?:usd|dolares?))?\b/u;
const NEGATED_ONE_TIME_AMOUNT_PATTERN = /\b(?:no|nunca|ni|tampoco)\b/u;
const SHORT_PAYMENT_SELECTION_REVOCATION_PATTERN =
  /^(?:no|no\s+mejor\s+no|mejor\s+no|dejalo|dejala|cancelo)(?:\s+gracias)?$/u;

function hasExplicitOneTimeAmountSelection(normalized: string): boolean {
  return normalized.split(/[.!?;,\n]+/u).some((rawClause) => {
    const clause = rawClause.trim();
    if (!ONE_TIME_AMOUNT_PATTERN.test(clause) || NEGATED_ONE_TIME_AMOUNT_PATTERN.test(clause)) {
      return false;
    }
    return SHORT_ONE_TIME_AMOUNT_SELECTION_PATTERN.test(clause)
      || COMMITTED_ONE_TIME_AMOUNT_SELECTION_PATTERN.test(clause);
  });
}

const TEMPORAL_PAYMENT_DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\bno\s+me\s+(?:mandes|envies|pases|compartas)\s+(?:el\s+)?(?:link|enlace)\b/,
  /\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b[^.!?\n]{0,64}\b(?:pagar|pago|pagos|cuotas?|meses?|abonar|comprar|compra|inscribir(?:me)?|anotar(?:me)?|matricular(?:me)?|link|enlace)\b/,
  /\b(?:pagar|pago|pagos|cuotas?|meses?|abonar|comprar|compra|inscribir(?:me)?|anotar(?:me)?|matricular(?:me)?|link|enlace)\b[^.!?\n]{0,64}\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b/,
  /\b(?:mandamelo|enviamelo|pasamelo|compartimelo)\b[^.!?\n]{0,32}\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b/,
  /\b(?:prefiero|quiero)\s+(?:esperar|postergar|dejarlo)\b[^.!?\n]{0,32}\b(?:para|antes\s+de)\s+(?:pagar|abonar|comprar|inscribirme|anotarme|matricularme)\b/,
  /\bno\s+(?:puedo|quiero)\s+(?:pagar|abonar|comprar|inscribirme|anotarme|matricularme)\b[^.!?\n]{0,32}\b(?:ahora|en\s+este\s+momento|todavia|por\s+ahora)\b/,
  /\bno\s+me\s+(?:voy\s+a\s+(?:inscribir|anotar|matricular)|interesa\s+(?:pagar|abonar|comprar|inscribirme|anotarme|matricularme))\b[^.!?\n]{0,32}\b(?:ahora|en\s+este\s+momento|todavia|por\s+ahora)\b/,
];

const SHORT_CONTEXTUAL_PAYMENT_DEFERRAL_PATTERN =
  /^\s*(?:todavia\s+no|por\s+ahora\s+no|mas\s+adelante|despues)[.!…]?\s*$/u;

const EXPLICIT_PURCHASE_DECLINE_PATTERNS: readonly RegExp[] = [
  /\bno\s+(?:quiero|voy\s+a)\s+(?:pagar|comprar|inscribirme|anotarme|matricularme)\b/,
  /\bno\s+me\s+(?:interesa\s+(?:pagar|comprar|inscribirme|anotarme|matricularme)|voy\s+a\s+(?:inscribir|anotar|matricular))\b/,
];

function hasTemporalPaymentDeferralIn(
  normalized: string,
  allowShortContextual: boolean,
): boolean {
  return TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(normalized))
    || (allowShortContextual && SHORT_CONTEXTUAL_PAYMENT_DEFERRAL_PATTERN.test(normalized));
}

function hasExplicitPurchaseDeclineIn(normalized: string): boolean {
  // A phrase such as "por ahora no me voy a anotar" postpones the decision;
  // it does not permanently close the sale.
  if (hasTemporalPaymentDeferralIn(normalized, false)) return false;
  return EXPLICIT_PURCHASE_DECLINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const NON_COMMITTAL_PAYMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:solo|solamente)\s+(?:consultaba|preguntaba|averiguaba)\b/,
  /\bsi\s+(?:comprara|me\s+anotara|me\s+inscribiera|eligiera)\b/,
  /[?¿]/,
  /\b(?:estoy\s+(?:pensando|viendo)|capaz|quizas|tal\s+vez|podria)\b/,
];

const EXPLICIT_PAYMENT_RESUME_PATTERN =
  /\bahora\s+si\b/u;

const EXPLICIT_PAYMENT_COMMITMENT_PATTERN =
  /\b(?:confirmo|quiero\s+pagar(?:l[oa]s?)?|lo\s+quiero\s+pagar|me\s+quedo\s+con|elijo|elegi|ya\s+(?:elegi|me\s+decidi)|me\s+decido|voy\s+con)\b/u;

const EXPLICIT_PAYMENT_LINK_REQUEST_PATTERN =
  /(?:\b(?:manda|mandame|mandamelo|envia|enviame|pasame|comparti|compartime)\b.{0,24}\b(?:link|enlace)\b|\b(?:link|enlace)\b.{0,24}\b(?:manda|mandame|envia|enviame|pasame|comparti|compartime)\b|\bquiero\s+(?:(?:avanzar|seguir|continuar)\s+y\s+)?(?:recibir|obtener|tener)\s+(?:el\s+)?(?:link|enlace)\b)/u;

function isExplicitPaymentLinkRequest(messages: readonly PolicyBatchMessage[]): boolean {
  return messages.some((message) => {
    const normalized = normalize(message.content ?? '');
    if (TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
    return EXPLICIT_PAYMENT_LINK_REQUEST_PATTERN.test(normalized);
  });
}

function plansMentionedIn(normalized: string): Set<PaymentPlanCode> {
  const matched = new Set<PaymentPlanCode>();
  for (const { code, pattern } of PLAN_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    if (
      code === 'one_time'
      && NARRATIVE_CONTADO_PATTERN.test(normalized)
      && !EXPLICIT_ONE_TIME_WITHOUT_CONTADO_PATTERN.test(normalized)
    ) continue;
    matched.add(code);
  }
  if (hasExplicitOneTimeAmountSelection(normalized)) matched.add('one_time');
  return matched;
}

function hasTrailingPaymentSelectionRevocation(
  normalizedMessages: readonly string[],
): boolean {
  let selectionSeen = false;
  let revoked = false;
  for (const normalized of normalizedMessages) {
    for (const rawClause of normalized.split(/[.!?;,\n]+/u)) {
      const clause = rawClause.trim();
      if (!clause) continue;
      if (plansMentionedIn(clause).size > 0) {
        selectionSeen = true;
        revoked = false;
      } else if (selectionSeen && SHORT_PAYMENT_SELECTION_REVOCATION_PATTERN.test(clause)) {
        revoked = true;
      }
    }
  }
  return revoked;
}

export type CurrentPaymentIntent =
  | { readonly kind: 'direct'; readonly planCode: PaymentPlanCode | null }
  | { readonly kind: 'resume' }
  | { readonly kind: 'veto' }
  | { readonly kind: 'none' };

/** Current-batch authority. Any veto wins before direct or resume intent. */
export function classifyCurrentPaymentIntent(
  messages: readonly PolicyBatchMessage[]
): CurrentPaymentIntent {
  const normalizedMessages = messages.map((message) => normalize(message.content ?? ''));
  if (normalizedMessages.some((message) => (
    hasTemporalPaymentDeferralIn(message, false)
    || hasExplicitPurchaseDeclineIn(message)
  ))) {
    return { kind: 'veto' };
  }
  if (hasTrailingPaymentSelectionRevocation(normalizedMessages)) {
    return { kind: 'veto' };
  }

  const matched = new Set<PaymentPlanCode>();
  for (const message of normalizedMessages) {
    for (const plan of plansMentionedIn(message)) matched.add(plan);
  }
  if (matched.size > 1) return { kind: 'none' };
  const nonCommittal = normalizedMessages.some((message) => (
    NON_COMMITTAL_PAYMENT_PATTERNS.some((pattern) => pattern.test(message))
  ));
  const explicitlyCommitted = normalizedMessages.some((message) => (
    EXPLICIT_PAYMENT_COMMITMENT_PATTERN.test(message)
    || isExplicitPaymentLinkRequest([{ content: message }])
  ));
  if (nonCommittal) return { kind: 'none' };
  if (matched.size === 1) {
    return { kind: 'direct', planCode: [...matched][0]! };
  }
  if (explicitlyCommitted) return { kind: 'direct', planCode: null };
  if (normalizedMessages.some((message) => EXPLICIT_PAYMENT_RESUME_PATTERN.test(message))) {
    return { kind: 'resume' };
  }
  return { kind: 'none' };
}

/**
 * The unique plan mentioned in the current batch, independent from checkout
 * authority. A tentative question or a temporal deferral can select a plan
 * for durable context while still being unable to authorize a link.
 */
export function derivePaymentPlanSelectionFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const normalizedMessages = messages.map((message) => normalize(message.content ?? ''));
  if (hasTrailingPaymentSelectionRevocation(normalizedMessages)) return null;
  const matched = new Set<PaymentPlanCode>();
  for (const normalized of normalizedMessages) {
    for (const plan of plansMentionedIn(normalized)) matched.add(plan);
  }
  if (matched.size !== 1) return null;
  return [...matched][0] ?? null;
}

export function hasTemporalPaymentDeferral(
  messages: readonly PolicyBatchMessage[],
  allowShortContextual = false,
): boolean {
  return messages.some((message) => {
    const normalized = normalize(message.content ?? '');
    return hasTemporalPaymentDeferralIn(normalized, allowShortContextual);
  });
}

/** Current-batch proof required before `decline_purchase` may close a sale. */
export function hasExplicitPurchaseDecline(
  messages: readonly PolicyBatchMessage[],
): boolean {
  return messages.some((message) => hasExplicitPurchaseDeclineIn(normalize(message.content ?? '')));
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
    if (hasTemporalPaymentDeferralIn(normalized, false)) {
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
