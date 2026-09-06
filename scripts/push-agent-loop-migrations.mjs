#!/usr/bin/env node
/**
 * Applies Agent Loop migrations with the Supabase CLI version that supports
 * CREATE/DROP INDEX CONCURRENTLY in db-push's PostgreSQL pipeline.
 *
 * Usage:
 *   AGENT_LOOP_MIGRATION_DATABASE_URL='postgresql://...' \
 *     node scripts/push-agent-loop-migrations.mjs --dry-run
 *   AGENT_LOOP_MIGRATION_DATABASE_URL='postgresql://...' \
 *     node scripts/push-agent-loop-migrations.mjs --apply
 *
 * The connection URL is intentionally never loaded from DATABASE_URL or an
 * env file. Remote URLs retain their SSL parameters; modes that permit a
 * plaintext connection are rejected. Output is redacted before it is emitted.
 */
import { spawnSync } from 'node:child_process';

const SUPABASE_CLI_PACKAGE = 'supabase@2.116.0';
const SUPABASE_CLI_VERSION = '2.116.0';
const AGENT_LOOP_MIGRATIONS = [
  '20260905000001_agent_decisions_release_manifest.sql',
  '20260905000002_outbound_deferred_state_patch.sql',
  '20260905000003_agent_loop_rollout_v3.sql',
  '20260905000004_agent_turn_preparations.sql',
  '20260905000005_agent_loop_commit_trace.sql',
  '20260905000006_agent_loop_prepared_memory.sql',
  '20260905000007_agent_loop_prepared_memory_in_txn_supersede.sql',
  '20260905000008_agent_loop_prepared_memory_workspace.sql',
  '20260905000009_outbound_deferred_lead_projection.sql',
  '20260906170927_outbound_message_parts.sql',
];
const allowedModes = new Set(['--dry-run', '--apply']);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const plaintextSslModes = new Set(['allow', 'disable', 'prefer']);

function fail(code) {
  console.error(code);
  process.exit(1);
}

function redact(output, rawUrl, parsedUrl) {
  let redacted = String(output ?? '');
  const secrets = [
    rawUrl,
    parsedUrl.password,
    parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '',
  ].filter((value) => value.length > 0);
  for (const secret of secrets) redacted = redacted.split(secret).join('[REDACTED]');
  return redacted;
}

function runNpx(args, rawUrl, parsedUrl) {
  const result = spawnSync('npx', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_TELEMETRY_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) fail('SUPABASE_CLI_EXECUTION_FAILED');
  if (result.status !== 0) {
    const diagnostic = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, rawUrl, parsedUrl).trim();
    if (diagnostic) console.error(diagnostic);
    fail('SUPABASE_CLI_COMMAND_FAILED');
  }
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function parseAndValidateDryRun(output) {
  const combined = `${output.stdout}\n${output.stderr}`;
  const pending = [...new Set(
    [...combined.matchAll(/\b\d{14}_[a-z0-9_]+\.sql\b/gu)]
      .map((match) => match[0]),
  )];
  if (pending.length === 0) {
    if (/Remote database is up to date\.|"upToDate"\s*:\s*true|"migrations"\s*:\s*\[\s*\]/u.test(combined)) {
      return;
    }
    fail('SUPABASE_DRY_RUN_OUTPUT_INVALID');
  }
  const first = AGENT_LOOP_MIGRATIONS.indexOf(pending[0]);
  const expectedSuffix = first >= 0 ? AGENT_LOOP_MIGRATIONS.slice(first) : [];
  if (JSON.stringify(pending) !== JSON.stringify(expectedSuffix)) {
    fail('UNEXPECTED_PENDING_MIGRATIONS');
  }
}

const [mode, ...unexpected] = process.argv.slice(2);
if (!mode || unexpected.length > 0 || !allowedModes.has(mode)) {
  fail('USAGE: push-agent-loop-migrations.mjs --dry-run|--apply');
}

const rawDatabaseUrl = process.env.AGENT_LOOP_MIGRATION_DATABASE_URL?.trim() ?? '';
if (!rawDatabaseUrl) fail('AGENT_LOOP_MIGRATION_DATABASE_URL_REQUIRED');

let databaseUrl;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  fail('AGENT_LOOP_MIGRATION_DATABASE_URL_INVALID');
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  fail('AGENT_LOOP_MIGRATION_DATABASE_URL_INVALID');
}

const sslMode = databaseUrl.searchParams.get('sslmode')?.toLowerCase();
if (!loopbackHosts.has(databaseUrl.hostname) && sslMode && plaintextSslModes.has(sslMode)) {
  fail('REMOTE_TLS_DOWNGRADE_REJECTED');
}

const reportedVersion = runNpx(
  ['-y', SUPABASE_CLI_PACKAGE, '--version'],
  rawDatabaseUrl,
  databaseUrl,
).stdout.trim().split(/\s+/u)[0];
if (reportedVersion !== SUPABASE_CLI_VERSION) {
  fail('SUPABASE_CLI_VERSION_MISMATCH');
}

const dryRunOutput = runNpx(
  [
    '-y', SUPABASE_CLI_PACKAGE, 'db', 'push', '--db-url', rawDatabaseUrl,
    '--dry-run',
  ],
  rawDatabaseUrl,
  databaseUrl,
);
parseAndValidateDryRun(dryRunOutput);
const safeDryRunOutput = redact(
  `${dryRunOutput.stdout}\n${dryRunOutput.stderr}`,
  rawDatabaseUrl,
  databaseUrl,
).trim();
if (safeDryRunOutput) console.log(safeDryRunOutput);

if (mode === '--apply') {
  const applyOutput = runNpx(
    [
      '-y', SUPABASE_CLI_PACKAGE, 'db', 'push', '--db-url', rawDatabaseUrl,
      '--yes',
    ],
    rawDatabaseUrl,
    databaseUrl,
  );
  const safeApplyOutput = redact(
    `${applyOutput.stdout}\n${applyOutput.stderr}`,
    rawDatabaseUrl,
    databaseUrl,
  ).trim();
  if (safeApplyOutput) console.log(safeApplyOutput);
}
