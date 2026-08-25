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

export function derivePaymentChoiceFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const matched = new Set<PaymentPlanCode>()
  for (const message of messages) {
    const normalized = normalize(message.content ?? '')
    for (const { code, pattern } of PLAN_PATTERNS) {
      if (pattern.test(normalized)) matched.add(code)
    }
  }
  if (matched.size !== 1) return null
  const [only] = matched
  return only ?? null
}
