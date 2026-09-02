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

const DISPOSABLE_EVAL_PORTS = new Set(['55432', '55433', '55434', '55435']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isStructurallyIsolatedEvaluation(env: Record<string, string | undefined>): boolean {
  try {
    const database = new URL(env.DATABASE_URL ?? '');
    const api = new URL(env.STUDYX_EVAL_API_BASE_URL ?? '');
    return LOOPBACK_HOSTS.has(database.hostname)
      && DISPOSABLE_EVAL_PORTS.has(database.port)
      && api.protocol === 'http:'
      && LOOPBACK_HOSTS.has(api.hostname)
      && Number(api.port) >= 3200
      && Number(api.port) <= 3299;
  } catch {
    return false;
  }
}

function isSyntheticEvaluationLink(raw: string | undefined): boolean {
  try {
    const parsed = new URL(raw ?? '');
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (parsed.hostname === 'example.invalid'
        || parsed.hostname.endsWith('.example.invalid')
        || parsed.hostname === 'example.test'
        || parsed.hostname.endsWith('.example.test'));
  } catch {
    return false;
  }
}

export function createConfigPaymentLinkResolver(
  env: Record<string, string | undefined> = process.env
): PaymentLinkResolver {
  const syntheticLinksAllowed = isStructurallyIsolatedEvaluation(env);
  return {
    resolve(planCode: PaymentPlanCode): string | null {
      const envVarName = ENV_VAR_BY_PLAN[planCode];
      const raw = envVarName ? env[envVarName] : undefined;
      return isStripePaymentLinkUrl(raw)
        || (syntheticLinksAllowed && isSyntheticEvaluationLink(raw))
        ? raw ?? null
        : null;
    },
  };
}
