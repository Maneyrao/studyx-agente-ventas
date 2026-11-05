import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { copyGoldenReuseObservationsV1, readGoldenReuseEvaluatedShaV1, reserveGoldenRunV1 } from './run-config.mjs';

const BASE_SHA = '028f272fc3a6f6dc4806d19b251564169b55e6d6';
const POSTGRES_PORT = '55435';
const BACKEND_PORT = '3217';
const databaseUrl = `postgresql://postgres@127.0.0.1:${POSTGRES_PORT}/studyx_test`;
const apiBaseUrl = `http://127.0.0.1:${BACKEND_PORT}`;

function command(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

function captured(commandName, args) {
  const result = spawnSync(commandName, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${commandName} failed`);
  return result.stdout.trim();
}

function portInUse(port) {
  return spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'ignore' }).status === 0;
}

function localEvalSecrets() {
  const file = existsSync('.eval/.env.local')
    ? parseEnv(readFileSync('.eval/.env.local', 'utf8'))
    : {};
  return {
    deepseek: process.env.DEEPSEEK_API_KEY?.trim() || file.DEEPSEEK_API_KEY?.trim() || null,
    nvidia: process.env.NVIDIA_API_KEY?.trim() || file.NVIDIA_API_KEY?.trim() || null,
  };
}

const headSha = captured('git', ['rev-parse', 'HEAD']);
if (spawnSync('git', ['merge-base', '--is-ancestor', BASE_SHA, headSha], { stdio: 'ignore' }).status !== 0) {
  throw new Error('GOLDEN_BASE_SHA_NOT_ANCESTOR');
}
const changedInWorktree = captured('git', ['diff', '--name-only', 'HEAD'])
  .split(/\r?\n/u).filter(Boolean);
if (changedInWorktree.some((filename) => !filename.startsWith('evals/golden/'))) {
  throw new Error('GOLDEN_AGENT_CODE_DIFFERS_FROM_BASE');
}
const unsafeUntracked = captured('git', ['ls-files', '--others', '--exclude-standard'])
  .split(/\r?\n/u).filter(Boolean)
  .filter((filename) => !filename.startsWith('evals/golden/')
    && !filename.startsWith('docs/reports/evidence/'));
if (unsafeUntracked.length > 0) throw new Error('GOLDEN_UNTRACKED_RUNTIME_FILES_PRESENT');
if (portInUse(POSTGRES_PORT)) throw new Error(`GOLDEN_POSTGRES_PORT_IN_USE:${POSTGRES_PORT}`);
if (portInUse(BACKEND_PORT)) throw new Error(`GOLDEN_BACKEND_PORT_IN_USE:${BACKEND_PORT}`);
const providerName = process.env.STUDYX_GOLDEN_PROVIDER ?? 'deepseek';
if (!['deepseek', 'nvidia_nim'].includes(providerName)) {
  throw new Error(`GOLDEN_PROVIDER_UNSUPPORTED:${providerName}`);
}
const localSecrets = localEvalSecrets();
const providerBaseUrl = process.env.STUDYX_GOLDEN_PROVIDER_BASE_URL
  ?? (providerName === 'nvidia_nim' ? 'https://integrate.api.nvidia.com/v1' : 'https://api.deepseek.com');
const providerModel = process.env.STUDYX_GOLDEN_PROVIDER_MODEL
  ?? (providerName === 'nvidia_nim' ? 'deepseek-ai/deepseek-v4-flash' : 'deepseek-v4-flash');
const judgeModel = process.env.STUDYX_GOLDEN_JUDGE_MODEL ?? 'deepseek-v4-flash';
if (providerName === 'deepseek' && !['deepseek-v4-flash', 'deepseek-v4-pro'].includes(providerModel)) {
  throw new Error('GOLDEN_OFFICIAL_AGENT_MODEL_UNSUPPORTED');
}
if (judgeModel !== 'deepseek-v4-flash') throw new Error('GOLDEN_OFFICIAL_JUDGE_MODEL_UNSUPPORTED');
if (providerName === 'deepseek' && providerBaseUrl.replace(/\/+$/u, '') !== 'https://api.deepseek.com') {
  throw new Error('GOLDEN_OFFICIAL_ORIGIN_NOT_ALLOWLISTED');
}
if (process.env.STUDYX_GOLDEN_DEEPSEEK_MODEL && process.env.STUDYX_GOLDEN_DEEPSEEK_MODEL !== 'deepseek-v4-flash') {
  throw new Error('GOLDEN_USE_PROVIDER_MODEL_FOR_EVAL_OVERRIDE');
}
const resultStem = process.env.STUDYX_GOLDEN_RESULT_STEM
  ?? (providerName === 'nvidia_nim' ? `acceptance-${headSha.slice(0, 7)}-nim` : 'baseline-v9');
const reuseObservations = process.env.STUDYX_GOLDEN_REUSE_OBSERVATIONS === 'true';
const reuseSourceStem = process.env.STUDYX_GOLDEN_REUSE_SOURCE_STEM?.trim() || null;
if (reuseObservations && !reuseSourceStem) throw new Error('GOLDEN_REUSE_SOURCE_STEM_MISSING');
const evaluatedSha = reuseObservations
  ? readGoldenReuseEvaluatedShaV1('evals/golden/results', reuseSourceStem)
  : headSha;
if (providerName === 'deepseek' && !localSecrets.deepseek) {
  throw new Error('DEEPSEEK_API_KEY_MISSING: guardala sólo en .eval/.env.local');
}
if (providerName === 'nvidia_nim' && !localSecrets.nvidia) {
  throw new Error('NVIDIA_API_KEY_MISSING: guardala sólo en .eval/.env.local');
}
const runStartedAt = new Date().toISOString();
const runStatePath = reserveGoldenRunV1('evals/golden/results', resultStem, {
  schema_version: 1, evaluated_sha: evaluatedSha, provider: providerName, model: providerModel,
  judge_model: judgeModel, case_selection: process.env.STUDYX_GOLDEN_CASE_IDS ?? null,
  suite_invocations: 1, started_at: runStartedAt, updated_at: runStartedAt,
});
if (reuseObservations) {
  copyGoldenReuseObservationsV1('evals/golden/results', reuseSourceStem, resultStem);
}

if (providerName === 'nvidia_nim') {
  const base = providerBaseUrl.replace(/\/+$/u, '');
  if (new URL(base).origin !== 'https://integrate.api.nvidia.com') {
    throw new Error('GOLDEN_NIM_BASE_URL_NOT_ALLOWLISTED');
  }
  const response = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${localSecrets.nvidia}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GOLDEN_NIM_MODEL_PREFLIGHT_HTTP_${response.status}`);
  const payload = await response.json();
  const available = Array.isArray(payload?.data)
    ? payload.data.map((item) => item?.id).filter((id) => typeof id === 'string')
    : [];
  if (!available.includes(providerModel)) {
    throw new Error(`GOLDEN_NIM_MODEL_UNAVAILABLE:${providerModel};available=${available.join(',')}`);
  }
}

function runState(status, extra = {}) {
  return `${JSON.stringify({
    schema_version: 1,
    status,
    evaluated_sha: evaluatedSha,
    provider: providerName,
    model: providerModel,
    judge_model: judgeModel,
    case_selection: process.env.STUDYX_GOLDEN_CASE_IDS ?? null,
    suite_invocations: 1,
    started_at: runStartedAt,
    updated_at: new Date().toISOString(),
    ...extra,
  }, null, 2)}\n`;
}
function writeRunState(status, extra = {}) {
  const temporary = `${runStatePath}.tmp`;
  writeFileSync(temporary, runState(status, extra), { mode: 0o600 });
  renameSync(temporary, runStatePath);
}

const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG ?? 'en_US.UTF-8',
  NODE_ENV: 'test',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  STUDYX_EVAL_API_BASE_URL: apiBaseUrl,
  STUDYX_GOLDEN_LIVE: 'true',
  // Official-programme PDFs: the harness records the `file` part instead of sending it. Dummy https
  // base (never fetched) and the emulator channel allowed for documents, local evaluation only.
  STUDYX_PUBLIC_ASSET_BASE_URL: 'https://assets.golden.invalid',
  STUDYX_COURSE_PROGRAM_CHANNELS: 'whatsapp,emulator',
  STUDYX_GOLDEN_EVALUATED_SHA: evaluatedSha,
  STUDYX_GOLDEN_REUSE_OBSERVATIONS: reuseObservations ? 'true' : 'false',
  STUDYX_GOLDEN_DEEPSEEK_MODEL: 'deepseek-v4-flash',
  STUDYX_GOLDEN_JUDGE_MODEL: judgeModel,
  ...(process.env.STUDYX_GOLDEN_CASE_IDS === undefined ? {} : { STUDYX_GOLDEN_CASE_IDS: process.env.STUDYX_GOLDEN_CASE_IDS }),
  STUDYX_GOLDEN_PROVIDER: providerName,
  STUDYX_GOLDEN_PROVIDER_BASE_URL: providerBaseUrl,
  STUDYX_GOLDEN_PROVIDER_MODEL: providerModel,
  STUDYX_GOLDEN_RESULT_STEM: resultStem,
  STUDYX_WORKFLOW_REPORT_DIR: 'evals/golden/results/runtime',
  DEEPSEEK_API_KEY: 'managed-by-golden-evaluator',
  BUSINESS_WORKSPACE_SLUG: 'studyx',
  ORCHESTRATOR_API_KEY: 'eval-orchestrator-key',
  ORCHESTRATOR_KEY_ID: 'botpress-eval',
  STUDYX_SIGNING_SECRET: 'eval-signing-secret',
  CRON_SECRET: 'local-eval-cron',
  VERCEL_GIT_COMMIT_SHA: evaluatedSha,
  PAYMENT_PROVIDER: 'fake',
  PAYMENT_LINK_ENVIRONMENT: 'test',
  // Readiness requires the canonical production variable names to exist even
  // when the resolver is explicitly running against the sandbox set below.
  // Keep both sets synthetic: PAYMENT_LINK_ENVIRONMENT=test guarantees that
  // the golden runner never selects these canonical placeholders.
  PAYMENT_LINK_12M: 'https://payments.example.invalid/unused-production-12m',
  PAYMENT_LINK_6M: 'https://payments.example.invalid/unused-production-6m',
  PAYMENT_LINK_CONTADO: 'https://payments.example.invalid/unused-production-contado',
  PAYMENT_LINK_SANDBOX_12M: 'https://buy.stripe.com/test_studyx_golden_12m',
  PAYMENT_LINK_SANDBOX_6M: 'https://buy.stripe.com/test_studyx_golden_6m',
  PAYMENT_LINK_SANDBOX_CONTADO: 'https://buy.stripe.com/test_studyx_golden_contado',
  PAYMENT_LINK_STRIPE_VERIFICATION: 'https://payments.example.invalid/verification-050',
  VOICE_PROVIDER: 'telegram_sandbox',
  AGENT_A_BRAIN_V1_ENABLED: 'true',
  AGENT_A_BRAIN_V1_SHADOW: 'false',
  AGENT_A_REPAIR_ENABLED: 'true',
  AGENT_A_CONTEXT_SCOPING: 'false',
  AGENT_A_STATE_ASSERTIONS: 'true',
  AGENT_A_SINGLE_ROUTE: 'true',
  CONVERSATION_PIPELINE_V1_ENABLED: 'false',
  COURSE_BONUS_FLOW_MODE: 'direct',
  COURSE_BONUS_MAX_COURSES: '3',
  CENTRAL_CARGA_ENABLED: 'false',
  CENTRAL_CARGA_BONUS_ENABLED: 'true',
  CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED: 'false',
  BOTPRESS_MANAGED_EGRESS_TOKEN: 'synthetic-golden-token',
  BOTPRESS_MANAGED_EGRESS_BOT_ID: 'synthetic-golden-bot',
  BOTPRESS_MANAGED_EGRESS_API_URL: 'https://messaging.example.invalid',
};

// Next carga .env*.local automáticamente. Marcar cada nombre como vacío antes
// de los valores allowlisted evita que una credencial real entre al proceso.
for (const filename of [
  '.env', '.env.local', '.env.production', '.env.production.local',
  '.env.development', '.env.development.local', '.env.test', '.env.test.local',
]) {
  if (!existsSync(filename)) continue;
  for (const name of Object.keys(parseEnv(readFileSync(filename, 'utf8')))) {
    if (!(name in environment)) environment[name] = '';
  }
}
const evaluatorEnvironment = {
  ...environment,
  DEEPSEEK_API_KEY: providerName === 'deepseek'
    ? localSecrets.deepseek
    : 'managed-by-golden-nim-adapter',
  ...(providerName === 'nvidia_nim' ? { NVIDIA_API_KEY: localSecrets.nvidia } : {}),
};

let backend;
let ownsPostgres = false;
const tsconfigPath = path.resolve('tsconfig.json');
const originalTsconfig = readFileSync(tsconfigPath, 'utf8');
const bootstrapDirectory = mkdtempSync(path.join(tmpdir(), 'studyx-golden-pg-'));
const bootstrapScript = path.join(bootstrapDirectory, 'pg-native-up.sh');
const bootstrapSource = readFileSync('scripts/pg-native-up.sh', 'utf8');
const authenticatedRoleAnchor = 'psql_run -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'authenticated\') THEN CREATE ROLE authenticated NOLOGIN; END IF; END \\$\\$;" >/dev/null';
if (!bootstrapSource.includes(authenticatedRoleAnchor)) {
  throw new Error('GOLDEN_POSTGRES_BOOTSTRAP_ANCHOR_MISSING');
}
writeFileSync(bootstrapScript, bootstrapSource.replace(
  authenticatedRoleAnchor,
  `${authenticatedRoleAnchor}\npsql_run -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END \\$\\$;" >/dev/null`,
));
const stop = () => {
  if (backend && backend.exitCode === null) backend.kill('SIGTERM');
  if (ownsPostgres) spawnSync('bash', ['scripts/pg-native-down.sh', POSTGRES_PORT], { stdio: 'inherit' });
  if (readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) writeFileSync(tsconfigPath, originalTsconfig);
  rmSync(bootstrapDirectory, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  writeRunState('interrupted', { signal });
  stop();
  process.exit(130);
});

try {
  command('bash', [bootstrapScript, POSTGRES_PORT, '--seed'], { env: environment });
  ownsPostgres = true;
  // The 17 NUEVO courses of the 2026 manual exist only in the database: add them to THIS disposable runner database (never any other).
  command('node', ['scripts/upsert-manual-2026-offerings.mjs', '--apply'], {
    env: { ...environment, STUDYX_CATALOG_TARGET_URL: databaseUrl },
  });
  backend = spawn('npx', ['next', 'dev', '--hostname', '127.0.0.1', '--port', BACKEND_PORT], {
    env: environment,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (backend.exitCode !== null) throw new Error(`GOLDEN_BACKEND_EXITED:${backend.exitCode}`);
    try {
      const response = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Backend is still compiling. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('GOLDEN_BACKEND_NOT_READY');
  // Next 16 may append a generated dev-types include to tsconfig.json. The
  // evaluator must leave the repository exactly as it found it, and the live
  // diff guard must inspect the pinned source rather than that runtime edit.
  if (readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) writeFileSync(tsconfigPath, originalTsconfig);
  command('npx', ['vitest', 'run', '--config', 'evals/golden/vitest.config.mts', 'evals/golden/live-runner.test.ts'], {
    env: evaluatorEnvironment,
  });
  writeRunState('completed');
} catch (error) {
  writeRunState('interrupted', {
    error_code: error instanceof Error ? error.message.split(':', 1)[0].slice(0, 120) : 'UNKNOWN',
  });
  throw error;
} finally {
  stop();
}
