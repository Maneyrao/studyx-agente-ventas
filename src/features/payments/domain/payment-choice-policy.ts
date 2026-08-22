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
  { code: 'monthly_12', pattern: /\b12\s*(?:meses|cuotas)\b/ },
  { code: 'monthly_6', pattern: /\b6\s*(?:meses|cuotas)\b/ },
  { code: 'one_time', pattern: /\b(?:contado|pago\s+unico)\b/ },
];

export function derivePaymentChoiceFromBatch(
  messages: readonly PolicyBatchMessage[]
): PaymentPlanCode | null {
  const matched = new Set<PaymentPlanCode>();
  for (const message of messages) {
    const normalized = normalize(message.content ?? '');
    for (const { code, pattern } of PLAN_PATTERNS) {
      if (pattern.test(normalized)) matched.add(code);
    }
  }
  if (matched.size !== 1) return null;
  const [only] = matched;
  return only ?? null;
}
