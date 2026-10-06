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
});

export type CentralCargaConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseUrl: string;
      signingSecret: string;
      environment: 'test' | 'live';
      paidAfter: Date;
    };

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
  };
}
