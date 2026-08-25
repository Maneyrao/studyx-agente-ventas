import { describe, expect, it, vi } from 'vitest';
import * as readinessModule from '../../../scripts/verify-whatsapp-release-readiness.mjs';

const {
  availableWhatsAppIntegration,
  configuredSecret,
  evaluateWhatsAppReleaseReadiness,
} = readinessModule;

const requiredEnv = {
  DATABASE_URL: 'secret-database',
  ORCHESTRATOR_API_KEY: 'secret-api',
  ORCHESTRATOR_KEY_ID: 'botpress-production',
  STUDYX_SIGNING_SECRET: 'secret-signing',
  CRON_SECRET: 'secret-cron',
  GEMINI_API_KEY: 'secret-gemini',
  GOOGLE_SHEETS_CLIENT_EMAIL: 'service@example.invalid',
  GOOGLE_SHEETS_PRIVATE_KEY: 'secret-private-key',
  PAYMENT_PROVIDER: 'stripe_test',
  STRIPE_SECRET_KEY: 'sk_test_secret',
  STRIPE_WEBHOOK_SECRET: 'whsec_secret',
  STRIPE_SUCCESS_URL: 'https://studyx.example/pago/ok',
  STRIPE_CANCEL_URL: 'https://studyx.example/pago/cancelado',
  BUSINESS_WORKSPACE_SLUG: 'studyx',
};

const botpress = {
  apiBaseUrl: 'https://api.studyx.example',
  orchestratorKeyId: 'botpress-production',
  automationEnabled: false,
  whatsappCanaryEnabled: true,
  whatsappCanaryAllowlistConfigured: true,
  whatsappDevelopmentIntegrationAvailable: true,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function healthyFetch() {
  return vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/health')
    ? response({ status: 'ok' })
    : response({ status: 'ready', ready: true }));
}

function check(result: Awaited<ReturnType<typeof evaluateWhatsAppReleaseReadiness>>, name: string) {
  return result.checks.find((item) => item.name === name);
}

describe('Botpress structured readiness metadata', () => {
  it('accepts a set required secret even though optional is false', () => {
    const status = [{
      name: 'WHATSAPP_CANARY_PHONE_E164S',
      description: 'Canary tester allowlist',
      optional: false,
      set: true,
    }];

    expect(configuredSecret(status, 'WHATSAPP_CANARY_PHONE_E164S')).toBe(true);
  });

  it.each([
    [[{
      name: 'WHATSAPP_CANARY_PHONE_E164S',
      description: 'Canary tester allowlist',
      optional: false,
      set: false,
    }]],
    [[{
      name: 'ANOTHER_SECRET',
      description: 'Unrelated',
      optional: false,
      set: true,
    }]],
  ])('rejects an unset or missing canary secret', (status) => {
    expect(configuredSecret(status, 'WHATSAPP_CANARY_PHONE_E164S')).toBe(false);
  });

  it('accepts only the enabled pinned official WhatsApp integration', () => {
    const status = [{
      alias: 'whatsapp',
      name: 'whatsapp',
      version: '4.18.5',
      enabled: true,
    }];

    expect(availableWhatsAppIntegration(status)).toBe(true);
  });

  it.each([
    [[{ alias: 'whatsapp', name: 'whatsapp', version: '4.18.5', enabled: false }]],
    [[{ alias: 'telegram', name: 'telegram', version: '1.0.0', enabled: true }]],
    [[{ alias: 'whatsapp', name: 'whatsapp', version: '4.19.0', enabled: true }]],
  ])('rejects disabled, missing, or wrong-version WhatsApp metadata', (status) => {
    expect(availableWhatsAppIntegration(status)).toBe(false);
  });
});

describe('WhatsApp release readiness', () => {
  it('passes only the safe development preflight shape', async () => {
    const result = await evaluateWhatsAppReleaseReadiness({
      target: 'development', env: requiredEnv, botpress, fetchImpl: healthyFetch(),
    });
    expect(result.ready).toBe(true);
    expect(result.checks.every(({ ok, reason }) => ok && reason === null)).toBe(true);
  });

  it.each([
    ['localhost API', { botpress: { ...botpress, apiBaseUrl: 'https://localhost:3000' } }, 'api_base_url'],
    ['non-HTTPS API', { botpress: { ...botpress, apiBaseUrl: 'http://api.studyx.example' } }, 'api_base_url'],
    ['wrong workspace', { env: { ...requiredEnv, BUSINESS_WORKSPACE_SLUG: 'other' } }, 'workspace_slug'],
    ['fake payments', { env: { ...requiredEnv, PAYMENT_PROVIDER: 'fake' } }, 'stripe_test'],
    ['disabled canary', { botpress: { ...botpress, whatsappCanaryEnabled: false } }, 'whatsapp_canary'],
    ['enabled automation', { botpress: { ...botpress, automationEnabled: true } }, 'global_automation'],
    ['missing integration', { botpress: { ...botpress, whatsappDevelopmentIntegrationAvailable: false } }, 'whatsapp_development_integration'],
  ])('rejects %s', async (_label, overrides, expectedCheck) => {
    const result = await evaluateWhatsAppReleaseReadiness({
      target: 'development',
      env: 'env' in overrides ? overrides.env : requiredEnv,
      botpress: 'botpress' in overrides ? overrides.botpress : botpress,
      fetchImpl: healthyFetch(),
    });
    expect(result.ready).toBe(false);
    expect(check(result, expectedCheck)?.ok).toBe(false);
  });

  it.each([
    'ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_KEY_ID', 'STUDYX_SIGNING_SECRET', 'CRON_SECRET',
    'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET', 'STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL',
  ])('rejects missing required variable %s without printing its value', async (missing) => {
    const env = { ...requiredEnv, [missing]: '' };
    const result = await evaluateWhatsAppReleaseReadiness({
      target: 'development', env, botpress, fetchImpl: healthyFetch(),
    });
    expect(result.ready).toBe(false);
    expect(check(result, 'backend_environment')?.reason).toContain(missing);
    expect(JSON.stringify(result)).not.toContain('secret-signing');
    expect(JSON.stringify(result)).not.toContain('secret-private-key');
  });

  it('rejects a backend that is live but not ready', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/health')
      ? response({ status: 'ok' })
      : response({ status: 'not_ready', ready: false }, 503));
    const result = await evaluateWhatsAppReleaseReadiness({
      target: 'development', env: requiredEnv, botpress, fetchImpl,
    });
    expect(result.ready).toBe(false);
    expect(check(result, 'backend_ready')).toEqual({
      name: 'backend_ready', ok: false, reason: 'BACKEND_NOT_READY',
    });
  });

  it('does not call a local or insecure backend', async () => {
    const fetchImpl = vi.fn();
    await evaluateWhatsAppReleaseReadiness({
      target: 'development', env: requiredEnv,
      botpress: { ...botpress, apiBaseUrl: 'http://localhost:3000' }, fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
