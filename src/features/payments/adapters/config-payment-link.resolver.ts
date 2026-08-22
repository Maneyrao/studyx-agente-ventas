import { PaymentPlanCode, isStripePaymentLinkUrl } from '../domain/payment-link';

/**
 * Resolves a plan code to its owner-approved Stripe link. Reads ONLY
 * environment (PAYMENT_LINK_12M / PAYMENT_LINK_6M / PAYMENT_LINK_CONTADO,
 * per spec §3) — never the database, never model output. Partial or invalid
 * configuration fails closed to null for that plan: the caller's job is to
 * turn that into "no link, ask to confirm the payment option", never to
 * substitute a different plan's link.
 */
export interface PaymentLinkResolver {
  resolve(planCode: PaymentPlanCode): string | null;
}

const ENV_VAR_BY_PLAN: Readonly<Record<PaymentPlanCode, string>> = {
  monthly_12: 'PAYMENT_LINK_12M',
  monthly_6: 'PAYMENT_LINK_6M',
  one_time: 'PAYMENT_LINK_CONTADO',
};

export function createConfigPaymentLinkResolver(
  env: Record<string, string | undefined> = process.env
): PaymentLinkResolver {
  return {
    resolve(planCode: PaymentPlanCode): string | null {
      const envVarName = ENV_VAR_BY_PLAN[planCode];
      const raw = envVarName ? env[envVarName] : undefined;
      return isStripePaymentLinkUrl(raw) ? raw : null;
    },
  };
}
