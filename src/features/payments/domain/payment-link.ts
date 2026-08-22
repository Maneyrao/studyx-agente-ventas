/**
 * The three owner-approved StudyX payment plans (spec §3 of
 * docs/contracts/agent-a-operational-mvp.md). This module is the single
 * source of truth for what a plan IS: its code, its human presentation, and
 * what counts as a canonical link. It never touches configuration or the
 * network — see config-payment-link.resolver.ts for where the actual URLs
 * come from (env only, fail closed) and materialize-payment-link-action.ts
 * for how a typed action turns into the fixed block the customer sees.
 *
 * `PaymentPlanCode` is declared here once, as the single source of truth for
 * the feature. orchestration/domain/business-context.ts:147 aliases this
 * exact type instead of re-declaring it, so there is exactly one union to
 * keep in sync with the three plans below.
 */

export type PaymentPlanCode = 'monthly_12' | 'monthly_6' | 'one_time';

export const PAYMENT_PLAN_CODES: readonly PaymentPlanCode[] = ['monthly_12', 'monthly_6', 'one_time'];

export function isPaymentPlanCode(value: unknown): value is PaymentPlanCode {
  return typeof value === 'string' && (PAYMENT_PLAN_CODES as readonly string[]).includes(value);
}

export interface PaymentPlanPresentation {
  readonly code: PaymentPlanCode;
  readonly label: string;
  readonly installments: number;
  readonly installment_amount: string;
  readonly total_amount: string;
  readonly currency: 'USD';
}

/** Presentation facts only — never a URL. Links are configuration, resolved elsewhere. */
export const PAYMENT_PLAN_PRESENTATIONS: Readonly<Record<PaymentPlanCode, PaymentPlanPresentation>> = {
  monthly_12: {
    code: 'monthly_12',
    label: '12 pagos mensuales de USD 30',
    installments: 12,
    installment_amount: '30.00',
    total_amount: '360.00',
    currency: 'USD',
  },
  monthly_6: {
    code: 'monthly_6',
    label: '6 pagos mensuales de USD 60',
    installments: 6,
    installment_amount: '60.00',
    total_amount: '360.00',
    currency: 'USD',
  },
  one_time: {
    code: 'one_time',
    label: 'Pago único de USD 360',
    installments: 1,
    installment_amount: '360.00',
    total_amount: '360.00',
    currency: 'USD',
  },
};

/**
 * Mirrors the Stripe hostname check at
 * src/features/orchestration/domain/business-context.ts:280 — only an
 * https://buy.stripe.com/... link is ever trusted as a payment URL,
 * regardless of where the candidate string came from (env or model text).
 */
export function isStripePaymentLinkUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'buy.stripe.com';
  } catch {
    return false;
  }
}

/** The fixed block appended to the model's text — never model-authored. */
export interface PaymentLinkBlock {
  readonly label: string;
  readonly url: string;
}

/**
 * The v4 business action, mirrored in
 * src/features/orchestration/domain/decision-v4.ts (which imports and
 * re-exports this exact declaration) and in
 * botpress-agent/src/schemas/contracts.ts (a separately-maintained Zod
 * mirror, since that package cannot import from this one). `offering_sku` is
 * a canonical sku string or null — never a URL or an amount; the parser at
 * decision-v4.ts rejects those shapes before materializePaymentLinkAction
 * ever runs.
 */
export interface SendPaymentLinkAction {
  readonly type: 'send_payment_link';
  readonly plan_code: PaymentPlanCode;
  readonly offering_sku: string | null;
}

const URL_PATTERN = /https?:\/\/[^\s)\]}"']+/gi;

/** Result of sanitizing model-authored text for URLs. */
export interface UrlStripResult {
  readonly text: string;
  /**
   * Every URL that was removed, in encounter order (duplicates included). A
   * non-empty list here is an injection/jailbreak signal — the model wrote a
   * URL it has no authority to write — and callers (see
   * materialize-payment-link-action.ts) MUST surface it so it can be
   * audit-logged, even though the action itself is not refused for it.
   */
  readonly stripped_urls: readonly string[];
}

/**
 * The model never earns trust for a URL, canonical or not: this only ever
 * KEEPS a URL that is byte-identical to the one already resolved from
 * configuration for this turn, and removes every other URL a response
 * happened to contain. Callers that want the link in the reply rely on the
 * fixed block (`PaymentLinkBlock`) instead, never on this passing text
 * through unmodified. The removed URLs are returned, not swallowed, so a
 * rogue one stays observable to the caller.
 */
export function stripUnauthorizedUrls(text: string, canonicalUrl: string | null): UrlStripResult {
  const stripped_urls: string[] = [];
  const sanitizedText = text.replace(URL_PATTERN, (match) => {
    if (canonicalUrl !== null && match === canonicalUrl) return match;
    stripped_urls.push(match);
    return '';
  });
  return { text: sanitizedText, stripped_urls };
}
