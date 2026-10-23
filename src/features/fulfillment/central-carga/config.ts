import { z } from 'zod';

export class CentralCargaConfigError extends Error {
  constructor(public readonly fields: string) {
    super(`Invalid Central de Carga configuration: ${fields}`);
    this.name = 'CentralCargaConfigError';
  }
}

const ConfigSchema = z.object({
  CENTRAL_CARGA_BASE_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  }, 'must be https (http only for localhost)'),
  CENTRAL_CARGA_SIGNING_SECRET: z.string().min(16),
  CENTRAL_CARGA_ENVIRONMENT: z.enum(['test', 'live']),
  CENTRAL_CARGA_ENROLL_PAID_AFTER: z.string().datetime({ offset: true }),
  CENTRAL_CARGA_SANDBOX_LIVE_UNTIL: z.string().datetime({ offset: true }).optional(),
});

export type CentralCargaConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseUrl: string;
      signingSecret: string;
      environment: 'test' | 'live';
      paidAfter: Date;
      allowSandboxContacts?: boolean;
      sandboxLiveUntil?: Date;
    };

export interface CentralCargaBonusConfig {
  readonly enabled: boolean;
  readonly fulfillmentPaused: boolean;
}

export function loadCentralCargaBonusConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CentralCargaBonusConfig {
  return {
    enabled: environment.CENTRAL_CARGA_BONUS_ENABLED?.trim().toLowerCase() === 'true',
    fulfillmentPaused: environment.CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED?.trim().toLowerCase() === 'true',
  };
}

/**
 * The worker is off unless CENTRAL_CARGA_ENABLED is exactly "true". When on,
 * every other setting is mandatory: a missing cutoff would let the worker
 * enroll students that were already onboarded by hand. Errors name the
 * offending variables only, never their values.
 */
export function loadCentralCargaConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CentralCargaConfig {
  if (environment.CENTRAL_CARGA_ENABLED?.trim().toLowerCase() !== 'true') {
    return { enabled: false };
  }
  const parsed = ConfigSchema.safeParse({
    CENTRAL_CARGA_BASE_URL: environment.CENTRAL_CARGA_BASE_URL?.trim(),
    CENTRAL_CARGA_SIGNING_SECRET: environment.CENTRAL_CARGA_SIGNING_SECRET?.trim(),
    CENTRAL_CARGA_ENVIRONMENT: environment.CENTRAL_CARGA_ENVIRONMENT?.trim().toLowerCase(),
    CENTRAL_CARGA_ENROLL_PAID_AFTER: environment.CENTRAL_CARGA_ENROLL_PAID_AFTER?.trim(),
    CENTRAL_CARGA_SANDBOX_LIVE_UNTIL: environment.CENTRAL_CARGA_SANDBOX_LIVE_UNTIL?.trim() || undefined,
  });
  if (!parsed.success) {
    throw new CentralCargaConfigError(
      [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(','),
    );
  }
  return {
    enabled: true,
    baseUrl: parsed.data.CENTRAL_CARGA_BASE_URL.replace(/\/+$/, ''),
    signingSecret: parsed.data.CENTRAL_CARGA_SIGNING_SECRET,
    environment: parsed.data.CENTRAL_CARGA_ENVIRONMENT,
    paidAfter: new Date(parsed.data.CENTRAL_CARGA_ENROLL_PAID_AFTER),
    allowSandboxContacts: parsed.data.CENTRAL_CARGA_ENVIRONMENT === 'test'
      && environment.CENTRAL_CARGA_ALLOW_SANDBOX_CONTACTS === 'true',
    ...(parsed.data.CENTRAL_CARGA_SANDBOX_LIVE_UNTIL
      ? { sandboxLiveUntil: new Date(parsed.data.CENTRAL_CARGA_SANDBOX_LIVE_UNTIL) }
      : {}),
  };
}
