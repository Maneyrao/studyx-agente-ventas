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
  orchestratorSecretConfigured: true,
  signingSecretConfigured: true,
  whatsappCanaryAttestation: { valid: true, count: 1 },
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
  it('reads the set canary secret from the real ADK development envelope', () => {
    const status = {
      success: true,
      dev: [{
        name: 'WHATSAPP_CANARY_PHONE_E164S',
        description: 'Canary tester allowlist',
        optional: false,
        set: true,
      }],
      prod: [{
        name: 'WHATSAPP_CANARY_PHONE_E164S',
        description: 'Canary tester allowlist',
        optional: false,
        set: false,
      }],
    };

    expect(configuredSecret(status, 'WHATSAPP_CANARY_PHONE_E164S', 'development')).toBe(true);
  });

  it.each([
    [{ success: false, dev: [], prod: [] }, 'development'],
    [{ success: true, dev: [{ name: 'WHATSAPP_CANARY_PHONE_E164S', optional: false, set: false }], prod: [] }, 'development'],
    [{ success: true, dev: [{ name: 'ANOTHER_SECRET', optional: false, set: true }], prod: [] }, 'development'],
    [{ success: true, dev: [{ name: 'WHATSAPP_CANARY_PHONE_E164S', optional: false, set: true }], prod: [] }, 'production'],
    [{ success: true, dev: [], prod: [] }, 'staging'],
    [{ success: true, dev: 'malformed', prod: [] }, 'development'],
  ])('rejects failed, unset, missing, wrong-target, or malformed secret envelopes', (status, target) => {
    expect(configuredSecret(status, 'WHATSAPP_CANARY_PHONE_E164S', target)).toBe(false);
  });

  it('reads the pinned enabled integration from the real ADK development envelope', () => {
    const status = {
      ok: true,
      target: 'dev',
      data: {
        integrations: [{
          alias: 'whatsapp',
          name: 'whatsapp',
          version: '4.18.5',
          enabled: true,
        }],
      },
    };

    expect(availableWhatsAppIntegration(status, 'development')).toBe(true);
  });

  it.each([
    [{ ok: false, target: 'dev', data: { integrations: [] } }, 'development'],
    [{ ok: true, target: 'prod', data: { integrations: [{ alias: 'whatsapp', name: 'whatsapp', version: '4.18.5', enabled: true }] } }, 'development'],
    [{ ok: true, target: 'dev', data: { integrations: [{ alias: 'whatsapp', name: 'whatsapp', version: '4.18.5', enabled: false }] } }, 'development'],
    [{ ok: true, target: 'dev', data: { integrations: [{ alias: 'telegram', name: 'telegram', version: '1.0.0', enabled: true }] } }, 'development'],
    [{ ok: true, target: 'dev', data: { integrations: [{ alias: 'whatsapp', name: 'whatsapp', version: '4.19.0', enabled: true }] } }, 'development'],
    [{ ok: true, target: 'dev', data: { integrations: 'malformed' } }, 'development'],
    [{ ok: true, target: 'dev' }, 'development'],
  ])('rejects failed, wrong-target, disabled, missing, wrong-version, or malformed integration envelopes', (status, target) => {
    expect(availableWhatsAppIntegration(status, target)).toBe(false);
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
    ['missing orchestrator secret', { botpress: { ...botpress, orchestratorSecretConfigured: false } }, 'botpress_secrets'],
    ['missing signing secret', { botpress: { ...botpress, signingSecretConfigured: false } }, 'botpress_secrets'],
    ['invalid canary attestation', { botpress: { ...botpress, whatsappCanaryAttestation: { valid: false, count: 1 } } }, 'whatsapp_canary_attestation'],
    ['multi-tester attestation', { botpress: { ...botpress, whatsappCanaryAttestation: { valid: false, count: 2 } } }, 'whatsapp_canary_attestation'],
    ['missing canary attestation', { botpress: { ...botpress, whatsappCanaryAttestation: null } }, 'whatsapp_canary_attestation'],
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

  it.each([
    'http://localhost:3000',
    'https://api.localhost',
    'https://127.1',
    'https://10.1.2.3',
    'https://172.16.0.1',
    'https://172.31.255.255',
    'https://192.168.1.1',
    'https://169.254.1.1',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fdff::1]',
    'https://[fe80::1]',
    'https://user:password@api.studyx.example',
    'not a url',
  ])('does not call a non-public backend target %s', async (apiBaseUrl) => {
    const fetchImpl = vi.fn();
    const result = await evaluateWhatsAppReleaseReadiness({
      target: 'development', env: requiredEnv,
      botpress: { ...botpress, apiBaseUrl }, fetchImpl,
    });
    expect(check(result, 'api_base_url')?.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
