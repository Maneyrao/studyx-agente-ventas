#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { isIP } from 'node:net';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ADK = resolve(ROOT, 'botpress-agent/node_modules/.bin/adk');
const WHATSAPP_CANARY_ATTESTATION_PREFIX = 'STUDYX_WHATSAPP_CANARY_ATTESTATION=';

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

function privateIpv4(hostname) {
  const [a, b] = hostname.split('.').map(Number);
  return a === 127 || a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

function privateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  const first = Number.parseInt(normalized.split(':', 1)[0], 16);
  if (!Number.isInteger(first)) return true;

  // Fail closed to the currently allocated global-unicast block. This also
  // excludes IPv4-mapped, unique-local, link-local, site-local and multicast.
  if ((first & 0xe000) !== 0x2000) return true;
  return normalized.startsWith('2001:db8:') || normalized.startsWith('2001:2:');
}

function publicHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
    const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ''));
    if (ipVersion === 4 && privateIpv4(hostname)) return false;
    if (ipVersion === 6 && privateIpv6(hostname)) return false;
    return hostname !== '';
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
  const missingBotpressSecrets = [
    ['WHATSAPP_CANARY_PHONE_E164S', botpress.whatsappCanaryAllowlistConfigured],
    ['STUDYX_ORCHESTRATOR_KEY', botpress.orchestratorSecretConfigured],
    ['STUDYX_SIGNING_SECRET', botpress.signingSecretConfigured],
  ].filter(([, configured]) => configured !== true).map(([name]) => name);
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
      'botpress_secrets',
      missingBotpressSecrets.length === 0,
      missingBotpressSecrets.length ? `MISSING:${missingBotpressSecrets.join(',')}` : null,
    ),
    result(
      'whatsapp_canary_attestation',
      botpress.whatsappCanaryAttestation?.valid === true &&
        botpress.whatsappCanaryAttestation?.count === 1,
      'WHATSAPP_CANARY_ATTESTATION_INVALID',
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

async function adkStdout(args) {
  try {
    const { stdout } = await execFileAsync(ADK, args, {
      cwd: resolve(ROOT, 'botpress-agent'),
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function adkJson(args) {
  const stdout = await adkStdout(args);
  if (typeof stdout !== 'string') return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export function parseWhatsAppCanaryAttestation(stdout) {
  if (typeof stdout !== 'string') return null;
  const framed = stdout.split(/\r?\n/).filter((line) =>
    line.startsWith(WHATSAPP_CANARY_ATTESTATION_PREFIX));
  if (framed.length !== 1) return null;

  try {
    const parsed = JSON.parse(framed[0].slice(WHATSAPP_CANARY_ATTESTATION_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed).sort();
    if (keys.length !== 2 || keys[0] !== 'count' || keys[1] !== 'valid') return null;
    if (typeof parsed.valid !== 'boolean' || !Number.isInteger(parsed.count) || parsed.count < 0) return null;
    return { valid: parsed.valid, count: parsed.count };
  } catch {
    return null;
  }
}

async function adkWhatsAppCanaryAttestation(args) {
  return parseWhatsAppCanaryAttestation(await adkStdout(args));
}

function adkTargetName(target) {
  if (target === 'development') return 'dev';
  if (target === 'production') return 'prod';
  return null;
}

export function configuredSecret(status, name, target) {
  const adkTarget = adkTargetName(target);
  if (!adkTarget || !status || typeof status !== 'object' || status.success !== true) return false;
  const entries = status[adkTarget];
  if (!Array.isArray(entries)) return false;
  const matches = entries.filter((entry) =>
    entry && typeof entry === 'object' && entry.name === name);
  return matches.length === 1 && matches[0].set === true;
}

export function availableWhatsAppIntegration(status, target) {
  const adkTarget = adkTargetName(target);
  if (
    !adkTarget ||
    !status ||
    typeof status !== 'object' ||
    status.ok !== true ||
    status.target !== adkTarget ||
    !status.data ||
    typeof status.data !== 'object' ||
    !Array.isArray(status.data.integrations)
  ) return false;
  const matches = status.data.integrations.filter((entry) =>
    entry && typeof entry === 'object' && entry.alias === 'whatsapp');
  return matches.length === 1 &&
    matches[0].name === 'whatsapp' &&
    matches[0].version === '4.18.5' &&
    matches[0].enabled === true;
}

async function readBotpressState(target) {
  const prod = target === 'production' ? ['--prod'] : [];
  const integrationTarget = target === 'production' ? 'prod' : 'dev';
  const [apiBaseUrl, orchestratorKeyId, automationEnabled, whatsappCanaryEnabled, secretStatus, integrations, canaryAttestation] = await Promise.all([
    adkJson(['config:get', 'apiBaseUrl', ...prod, '--format', 'json']),
    adkJson(['config:get', 'orchestratorKeyId', ...prod, '--format', 'json']),
    adkJson(['config:get', 'automationEnabled', ...prod, '--format', 'json']),
    adkJson(['config:get', 'whatsappCanaryEnabled', ...prod, '--format', 'json']),
    adkJson(['secret', ...prod, '--format', 'json']),
    adkJson(['integrations', 'list', '--target', integrationTarget, '--format', 'json']),
    adkWhatsAppCanaryAttestation(['run', './scripts/attest-whatsapp-canary.ts', ...prod]),
  ]);
  return {
    apiBaseUrl: unwrapValue(apiBaseUrl),
    orchestratorKeyId: unwrapValue(orchestratorKeyId),
    automationEnabled: unwrapValue(automationEnabled),
    whatsappCanaryEnabled: unwrapValue(whatsappCanaryEnabled),
    whatsappCanaryAllowlistConfigured: configuredSecret(
      secretStatus,
      'WHATSAPP_CANARY_PHONE_E164S',
      target,
    ),
    orchestratorSecretConfigured: configuredSecret(
      secretStatus,
      'STUDYX_ORCHESTRATOR_KEY',
      target,
    ),
    signingSecretConfigured: configuredSecret(
      secretStatus,
      'STUDYX_SIGNING_SECRET',
      target,
    ),
    whatsappCanaryAttestation: canaryAttestation,
    whatsappDevelopmentIntegrationAvailable: availableWhatsAppIntegration(integrations, target),
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
