#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA_1_PATTERN = /^[a-f0-9]{40}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const REQUIRED_RELEASE_CONFIG = Object.freeze([
  'DATABASE_URL',
  'BUSINESS_WORKSPACE_SLUG',
  'ORCHESTRATOR_API_KEY',
  'ORCHESTRATOR_KEY_ID',
  'STUDYX_SIGNING_SECRET',
  'CRON_SECRET',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'PAYMENT_LINK_12M',
  'PAYMENT_LINK_6M',
  'PAYMENT_LINK_CONTADO',
  'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SHEETS_TAB_NAME',
]);

function requireNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value;
}

function requireDigest(value, code) {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) throw new Error(code);
  return value;
}

function requireGitSha(value) {
  if (typeof value !== 'string' || !SHA_1_PATTERN.test(value)) {
    throw new Error('INVALID_RELEASE_MANIFEST_GIT_SHA');
  }
  return value;
}

function checkedConfig(requiredConfig) {
  const values = {};
  for (const key of REQUIRED_RELEASE_CONFIG) {
    if (typeof requiredConfig?.[key] !== 'boolean') {
      throw new Error(`INVALID_RELEASE_MANIFEST_REQUIRED_CONFIG:${key}`);
    }
    values[key] = requiredConfig[key];
  }
  return values;
}

/**
 * Pure release-manifest constructor. It is deliberately value-safe: callers
 * pass only booleans for configuration, never secret values.
 */
export function createReleaseManifest(input) {
  const requiredConfig = checkedConfig(input?.requiredConfig);
  const missing = REQUIRED_RELEASE_CONFIG.filter((key) => requiredConfig[key] !== true);
  if (missing.length > 0) {
    throw new Error(`RELEASE_MANIFEST_INCOMPLETE:${missing.join(',')}`);
  }

  return Object.freeze({
    environment: requireNonEmptyString(input.environment, 'INVALID_RELEASE_MANIFEST_ENVIRONMENT'),
    git_sha: requireGitSha(input.gitSha),
    botpress_artifact_sha: requireDigest(
      input.botpressArtifactSha,
      'INVALID_RELEASE_MANIFEST_BOTPRESS_ARTIFACT_SHA',
    ),
    prompt_version: requireNonEmptyString(
      input.promptVersion,
      'INVALID_RELEASE_MANIFEST_PROMPT_VERSION',
    ),
    provider: requireNonEmptyString(input.provider, 'INVALID_RELEASE_MANIFEST_PROVIDER'),
    model: requireNonEmptyString(input.model, 'INVALID_RELEASE_MANIFEST_MODEL'),
    latest_migration: requireNonEmptyString(
      input.latestMigration,
      'INVALID_RELEASE_MANIFEST_LATEST_MIGRATION',
    ),
    catalog_source_sha256: requireDigest(
      input.catalogSourceSha256,
      'INVALID_RELEASE_MANIFEST_CATALOG_SOURCE_SHA256',
    ),
    required_config: Object.freeze(requiredConfig),
    complete: true,
    built_at: requireNonEmptyString(input.builtAt, 'INVALID_RELEASE_MANIFEST_BUILT_AT'),
  });
}

async function gitStdout(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function sha256Files(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const fullPath = join(ROOT, path);
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(fullPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function latestMigration() {
  const names = (await readdir(join(ROOT, 'supabase/migrations')))
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .sort();
  if (names.length === 0) throw new Error('RELEASE_MANIFEST_MIGRATIONS_MISSING');
  return names.at(-1);
}

async function activePromptVersion() {
  const source = await readFile(
    join(ROOT, 'botpress-agent/src/prompts/agent-a-sales-bridge.ts'),
    'utf8',
  );
  const match = source.match(/AGENT_A_PROMPT_VERSION\s*=\s*'([^']+)'/u);
  if (!match) throw new Error('RELEASE_MANIFEST_PROMPT_VERSION_NOT_FOUND');
  return match[1];
}

function presentConfig(environment) {
  return Object.fromEntries(
    REQUIRED_RELEASE_CONFIG.map((key) => [key, typeof environment[key] === 'string' && environment[key].trim() !== '']),
  );
}

async function collectRuntimeManifest(environment = process.env) {
  const [gitSha, trackedBotpress, migration, promptVersion] = await Promise.all([
    gitStdout(['rev-parse', 'HEAD']).then((value) => value.trim()),
    gitStdout(['ls-files', '-z', '--', 'botpress-agent']).then((value) => value.split('\0').filter(Boolean)),
    latestMigration(),
    activePromptVersion(),
  ]);
  if (trackedBotpress.length === 0) throw new Error('RELEASE_MANIFEST_BOTPRESS_SOURCE_MISSING');

  return createReleaseManifest({
    environment: environment.VERCEL_ENV ?? environment.NODE_ENV ?? 'development',
    gitSha,
    botpressArtifactSha: await sha256Files(trackedBotpress),
    promptVersion,
    provider: environment.AGENT_A_DECISION_PROVIDER ?? 'google-ai-direct',
    model: environment.GEMINI_MODEL ?? 'gemini-3.6-flash',
    latestMigration: migration,
    catalogSourceSha256: await sha256Files(['supabase/seed/studyx-manual.sql']),
    requiredConfig: presentConfig(environment),
    builtAt: environment.RELEASE_BUILT_AT ?? new Date().toISOString(),
  });
}

export async function generateReleaseManifest(environment = process.env) {
  return collectRuntimeManifest(environment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateReleaseManifest()
    .then((manifest) => process.stdout.write(`${JSON.stringify(manifest)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'RELEASE_MANIFEST_FAILED'}\n`);
      process.exitCode = 1;
    });
}
