/**
 * MIRROR of `src/features/payments/domain/payment-choice-policy.ts` (the
 * Next.js backend authority). This package cannot import from the backend,
 * so the pattern table is duplicated here and kept in lockstep by the parity
 * test `tests/unit/botpress/payment-choice-mirror.test.ts`.
 *
 * Why the workflow needs its own copy: when the model emits
 * `send_payment_link` for a batch whose text does NOT deterministically name
 * exactly one plan, the backend refuses the commit with a 422
 * (AMBIGUOUS_OR_ABSENT_CHOICE / PLAN_MISMATCH) and the customer would get
 * silence. Validating the same rule locally lets the workflow downgrade the
 * decision to a clarification BEFORE committing — the link still never goes
 * out (backend keeps final authority), but the customer always gets an
 * answer.
 */

export type PaymentPlanCode = 'monthly_12' | 'monthly_6' | 'one_time'

export interface PolicyBatchMessage {
  readonly content: string
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
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
]

const NARRATIVE_CONTADO_PATTERN =
  /\b(?:(?:me|te|le|nos|les)\s+)?(?:habia|habias|habiamos|habian|he|has|ha|hemos|han)\s+contado\b/
const EXPLICIT_ONE_TIME_WITHOUT_CONTADO_PATTERN =
  /\b(?:pago\s+unico|todo\s+junto|un\s+solo\s+pago|pago\s+total|(?:un\s+)?unico\s+pago)\b/

const TEMPORAL_PAYMENT_DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\bno\s+me\s+(?:mandes|envies|pases|compartas)\s+(?:el\s+)?link\b/,
  /\b(?:todavia\s+no|despues|mas\s+adelante|por\s+ahora\s+no)\b/,
]

const NON_COMMITTAL_PAYMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:solo|solamente)\s+(?:consultaba|preguntaba|averiguaba)\b/,
  /\bsi\s+(?:comprara|me\s+anotara|me\s+inscribiera|eligiera)\b/,
  /[?¿]/,
  /\b(?:estoy\s+(?:pensando|viendo)|capaz|quizas|tal\s+vez|podria)\b/,
]

const EXPLICIT_PAYMENT_RESUME_PATTERN = /\bahora\s+si\b/u

const EXPLICIT_PAYMENT_COMMITMENT_PATTERN =
  /\b(?:confirmo|quiero\s+pagar(?:l[oa]s?)?|lo\s+quiero\s+pagar|me\s+quedo\s+con|elijo|elegi|ya\s+(?:elegi|me\s+decidi)|me\s+decido|voy\s+con)\b/u

function plansMentionedIn(normalized: string): Set<PaymentPlanCode> {
  const matched = new Set<PaymentPlanCode>()
  for (const { code, pattern } of PLAN_PATTERNS) {
    if (!pattern.test(normalized)) continue
    if (
      code === 'one_time'
      && NARRATIVE_CONTADO_PATTERN.test(normalized)
      && !EXPLICIT_ONE_TIME_WITHOUT_CONTADO_PATTERN.test(normalized)
    ) continue
    matched.add(code)
  }
  return matched
}

export type CurrentPaymentIntent =
  | { readonly kind: 'direct'; readonly planCode: PaymentPlanCode | null }
  | { readonly kind: 'resume' }
  | { readonly kind: 'veto' }
  | { readonly kind: 'none' }

export function classifyCurrentPaymentIntent(
  messages: readonly PolicyBatchMessage[]
): CurrentPaymentIntent {
  const normalizedMessages = messages.map((message) => normalize(message.content ?? ''))
  if (normalizedMessages.some((message) => (
    TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(message))
  ))) return { kind: 'veto' }

  const matched = new Set<PaymentPlanCode>()
  for (const message of normalizedMessages) {
    for (const plan of plansMentionedIn(message)) matched.add(plan)
  }
  if (matched.size > 1) return { kind: 'none' }
  const nonCommittal = normalizedMessages.some((message) => (
    NON_COMMITTAL_PAYMENT_PATTERNS.some((pattern) => pattern.test(message))
  ))
  const explicitlyCommitted = normalizedMessages.some((message) => (
    EXPLICIT_PAYMENT_COMMITMENT_PATTERN.test(message)
    || isExplicitPaymentLinkRequest([{ content: message }])
  ))
  if (nonCommittal) return { kind: 'none' }
  if (matched.size === 1) {
    return { kind: 'direct', planCode: [...matched][0]! }
  }
  if (explicitlyCommitted) return { kind: 'direct', planCode: null }
  if (normalizedMessages.some((message) => EXPLICIT_PAYMENT_RESUME_PATTERN.test(message))) {
    return { kind: 'resume' }
  }
  return { kind: 'none' }
}

export function derivePaymentPlanSelectionFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const matched = new Set<PaymentPlanCode>()
  for (const message of messages) {
    const normalized = normalize(message.content ?? '')
    for (const plan of plansMentionedIn(normalized)) matched.add(plan)
  }
  if (matched.size !== 1) return null
  return [...matched][0] ?? null
}

export function hasTemporalPaymentDeferral(
  messages: readonly PolicyBatchMessage[]
): boolean {
  return messages.some((message) => {
    const normalized = normalize(message.content ?? '')
    return TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(normalized))
  })
}

export function derivePaymentChoiceFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const intent = classifyCurrentPaymentIntent(messages)
  return intent.kind === 'direct' ? intent.planCode : null
}

const EXPLICIT_PAYMENT_LINK_REQUEST_PATTERN =
  /(?:\b(?:manda|mandame|mandamelo|envia|enviame|pasame|comparti|compartime)\b.{0,24}\b(?:link|enlace)\b|\b(?:link|enlace)\b.{0,24}\b(?:manda|mandame|envia|enviame|pasame|comparti|compartime)\b)/u

export function isExplicitPaymentLinkRequest(
  messages: readonly PolicyBatchMessage[],
): boolean {
  return messages.some((message) => {
    const normalized = normalize(message.content ?? '')
    if (TEMPORAL_PAYMENT_DEFERRAL_PATTERNS.some((pattern) => pattern.test(normalized))) return false
    return EXPLICIT_PAYMENT_LINK_REQUEST_PATTERN.test(normalized)
  })
}
