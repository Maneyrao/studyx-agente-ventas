#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ADK = resolve(ROOT, 'botpress-agent/node_modules/.bin/adk');

const REQUIRED_BACKEND_ENV = [
  'DATABASE_URL',
  'ORCHESTRATOR_API_KEY',
  'ORCHESTRATOR_KEY_ID',
  'STUDYX_SIGNING_SECRET',
  'CRON_SECRET',
  'GEMINI_API_KEY',
  'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SUCCESS_URL',
  'STRIPE_CANCEL_URL',
];

function result(name, ok, reason) {
  return { name, ok, reason: ok ? null : reason };
}

function hasValue(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

function publicHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function probe(fetchImpl, baseUrl, path, predicate, failureReason) {
  try {
    const response = await fetchImpl(new URL(path, `${baseUrl}/`).toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json();
    return response.ok && predicate(body)
      ? result(path === '/api/health' ? 'backend_health' : 'backend_ready', true, null)
      : result(path === '/api/health' ? 'backend_health' : 'backend_ready', false, failureReason);
  } catch {
    return result(path === '/api/health' ? 'backend_health' : 'backend_ready', false, failureReason);
  }
}

export async function evaluateWhatsAppReleaseReadiness({
  target,
  env,
  botpress,
  fetchImpl = globalThis.fetch,
}) {
  const missing = REQUIRED_BACKEND_ENV.filter((name) => !hasValue(env, name));
  const apiIsPublicHttps = publicHttpsUrl(botpress.apiBaseUrl);
  const checks = [
    result('target', target === 'development', 'TARGET_MUST_BE_DEVELOPMENT'),
    result('api_base_url', apiIsPublicHttps, 'API_BASE_URL_MUST_BE_PUBLIC_HTTPS'),
    result('workspace_slug', env.BUSINESS_WORKSPACE_SLUG === 'studyx', 'BUSINESS_WORKSPACE_SLUG_MUST_BE_STUDYX'),
    result('backend_environment', missing.length === 0, missing.length ? `MISSING:${missing.join(',')}` : null),
    result(
      'orchestrator_key_id',
      hasValue(env, 'ORCHESTRATOR_KEY_ID') && botpress.orchestratorKeyId === env.ORCHESTRATOR_KEY_ID,
      'ORCHESTRATOR_KEY_ID_MISSING_OR_MISMATCHED',
    ),
    result(
      'stripe_test',
      env.PAYMENT_PROVIDER === 'stripe_test' && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? ''),
      'STRIPE_TEST_CONFIGURATION_REQUIRED',
    ),
    result('global_automation', botpress.automationEnabled === false, 'GLOBAL_AUTOMATION_MUST_BE_DISABLED'),
    result('whatsapp_canary', botpress.whatsappCanaryEnabled === true, 'WHATSAPP_CANARY_MUST_BE_ENABLED'),
    result(
      'whatsapp_canary_allowlist_secret',
      botpress.whatsappCanaryAllowlistConfigured === true,
      'WHATSAPP_CANARY_ALLOWLIST_SECRET_MISSING',
    ),
    result(
      'whatsapp_development_integration',
      botpress.whatsappDevelopmentIntegrationAvailable === true,
      'WHATSAPP_DEVELOPMENT_INTEGRATION_UNAVAILABLE',
    ),
  ];

  if (apiIsPublicHttps) {
    checks.push(await probe(fetchImpl, botpress.apiBaseUrl, '/api/health', (body) => body?.status === 'ok', 'BACKEND_UNHEALTHY'));
    checks.push(await probe(fetchImpl, botpress.apiBaseUrl, '/api/ready', (body) => body?.ready === true && body?.status === 'ready', 'BACKEND_NOT_READY'));
  } else {
    checks.push(result('backend_health', false, 'BACKEND_NOT_PROBED'));
    checks.push(result('backend_ready', false, 'BACKEND_NOT_PROBED'));
  }

  return { ready: checks.every((check) => check.ok), checks };
}

function unwrapValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}

async function adkJson(args) {
  try {
    const { stdout } = await execFileAsync(ADK, args, {
      cwd: resolve(ROOT, 'botpress-agent'),
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function structuredEntries(status, collectionName) {
  if (Array.isArray(status)) return status;
  if (
    status &&
    typeof status === 'object' &&
    Array.isArray(status[collectionName])
  ) {
    return status[collectionName];
  }
  return [];
}

export function configuredSecret(status, name) {
  const matches = structuredEntries(status, 'secrets').filter((entry) =>
    entry && typeof entry === 'object' && entry.name === name);
  return matches.length === 1 && matches[0].set === true;
}

export function availableWhatsAppIntegration(status) {
  const matches = structuredEntries(status, 'integrations').filter((entry) =>
    entry && typeof entry === 'object' && entry.alias === 'whatsapp');
  return matches.length === 1 &&
    matches[0].name === 'whatsapp' &&
    matches[0].version === '4.18.5' &&
    matches[0].enabled === true;
}

async function readBotpressState(target) {
  const prod = target === 'production' ? ['--prod'] : [];
  const integrationTarget = target === 'production' ? 'prod' : 'dev';
  const [apiBaseUrl, orchestratorKeyId, automationEnabled, whatsappCanaryEnabled, secretStatus, integrations] = await Promise.all([
    adkJson(['config:get', 'apiBaseUrl', ...prod, '--format', 'json']),
    adkJson(['config:get', 'orchestratorKeyId', ...prod, '--format', 'json']),
    adkJson(['config:get', 'automationEnabled', ...prod, '--format', 'json']),
    adkJson(['config:get', 'whatsappCanaryEnabled', ...prod, '--format', 'json']),
    adkJson(['secret', ...prod, '--format', 'json']),
    adkJson(['integrations', 'list', '--target', integrationTarget, '--format', 'json']),
  ]);
  return {
    apiBaseUrl: unwrapValue(apiBaseUrl),
    orchestratorKeyId: unwrapValue(orchestratorKeyId),
    automationEnabled: unwrapValue(automationEnabled),
    whatsappCanaryEnabled: unwrapValue(whatsappCanaryEnabled),
    whatsappCanaryAllowlistConfigured: configuredSecret(secretStatus, 'WHATSAPP_CANARY_PHONE_E164S'),
    whatsappDevelopmentIntegrationAvailable: availableWhatsAppIntegration(integrations),
  };
}

function parseArgs(argv) {
  const targetIndex = argv.indexOf('--target');
  const formatIndex = argv.indexOf('--format');
  return {
    target: targetIndex >= 0 ? argv[targetIndex + 1] : 'development',
    format: formatIndex >= 0 ? argv[formatIndex + 1] : 'json',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const botpress = await readBotpressState(args.target);
  const readiness = await evaluateWhatsAppReleaseReadiness({
    target: args.target,
    env: process.env,
    botpress,
  });
  process.stdout.write(`${JSON.stringify(readiness, null, args.format === 'json' ? 2 : 0)}\n`);
  process.exitCode = readiness.ready ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
