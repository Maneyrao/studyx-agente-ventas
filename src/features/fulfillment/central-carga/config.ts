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
  readonly canaryContactIds?: readonly string[];
  readonly canaryPhoneE164s?: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parseCanaryContactIds(value: string | undefined): readonly string[] {
  return [...new Set((value ?? '')
    .split(',')
    .map((candidate) => candidate.trim().toLowerCase())
    .filter((candidate) => UUID.test(candidate)))];
}

function normalizedCanaryPhone(value: string | null | undefined): string | null {
  const compact = value?.trim().replace(/[ ()-]/gu, '') ?? '';
  const phone = /^\d+$/u.test(compact) ? `+${compact}` : compact;
  return /^\+[1-9]\d{7,14}$/u.test(phone) && !phone.startsWith('+999') ? phone : null;
}

function isCanaryContact(config: CentralCargaBonusConfig, contactId: string, storedPhone?: string | null): boolean {
  if ((config.canaryContactIds ?? []).includes(contactId.trim().toLowerCase())) return true;
  const phone = normalizedCanaryPhone(storedPhone);
  return phone !== null && (config.canaryPhoneE164s ?? []).includes(phone);
}

export function isCentralCargaBonusEnabledForContact(
  config: CentralCargaBonusConfig,
  contactId: string,
  storedPhone?: string | null,
): boolean {
  if (config.enabled) return true;
  return isCanaryContact(config, contactId, storedPhone);
}

export function isCentralCargaBonusConfigured(config: CentralCargaBonusConfig): boolean {
  return config.enabled || (config.canaryContactIds?.length ?? 0) > 0 || (config.canaryPhoneE164s?.length ?? 0) > 0;
}

export function isCentralCargaBonusFulfillmentAllowedForContact(
  config: CentralCargaBonusConfig,
  contactId: string,
  storedPhone?: string | null,
): boolean {
  return !config.fulfillmentPaused
    || isCanaryContact(config, contactId, storedPhone);
}

export function loadCentralCargaBonusConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CentralCargaBonusConfig {
  return {
    enabled: environment.CENTRAL_CARGA_BONUS_ENABLED?.trim().toLowerCase() === 'true',
    fulfillmentPaused: environment.CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED?.trim().toLowerCase() === 'true',
    canaryContactIds: parseCanaryContactIds(environment.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS),
    canaryPhoneE164s: [...new Set((environment.CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S ?? '')
      .split(',').map(normalizedCanaryPhone).filter((phone): phone is string => phone !== null))],
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
