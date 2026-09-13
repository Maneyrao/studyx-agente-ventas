import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Explicit disposable environment. Never load the repository's production .env.
// Examples: node scripts/run-agent-a-workflow-lab.mjs npm run build
//           node scripts/run-agent-a-workflow-lab.mjs npm run start -- --hostname 127.0.0.1 --port 3217
// --paid reads ONLY DeepSeek's key and requires an existing cumulative ledger.
const args = process.argv.slice(2);
const paid = args[0] === '--paid';
if (paid) args.shift();
for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']) {
  if (existsSync(filename)) throw new Error(`LAB_UNEXPECTED_NEXT_ENV_FILE:${filename}`);
}
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
DATABASE_URL:'postgresql://postgres@127.0.0.1:55435/studyx_test',
TEST_DATABASE_URL:'postgresql://postgres@127.0.0.1:55435/studyx_test',
STUDYX_EVAL_API_BASE_URL:'http://127.0.0.1:3217',
BUSINESS_WORKSPACE_SLUG:'studyx',ORCHESTRATOR_API_KEY:'eval-orchestrator-key',
ORCHESTRATOR_KEY_ID:'botpress-eval',STUDYX_SIGNING_SECRET:'eval-signing-secret',CRON_SECRET:'local-eval-cron',
PAYMENT_PROVIDER:'fake',PAYMENT_LINK_12M:'https://example.invalid/eval/12m',
PAYMENT_LINK_6M:'https://example.invalid/eval/6m',PAYMENT_LINK_CONTADO:'https://example.invalid/eval/contado',
AGENT_A_BRAIN_V1_ENABLED:'true',AGENT_A_BRAIN_V1_SHADOW:'false',AGENT_A_REPAIR_ENABLED:'true',
AGENT_A_CONTEXT_SCOPING:'false',AGENT_A_STATE_ASSERTIONS:'true',AGENT_A_SINGLE_ROUTE:'true',
CONVERSATION_PIPELINE_V1_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
// Evidence selectors are inert local paths/ids. Keep this allowlist explicit:
// no ambient integration credential crosses into the isolated workflow run.
for (const name of [
  'STUDYX_CALL_OFFER_CASE_FILE',
  'STUDYX_CALL_OFFER_CASE_FILES',
  'STUDYX_CALL_OFFER_CASE_IDS',
  'STUDYX_WORKFLOW_REPORT_DIR',
  'STUDYX_LAB_ROOT',
]) {
  const value = process.env[name]?.trim();
  if (value) env[name] = value;
}
if (paid) {
  const key = parseEnv(readFileSync('.eval/.env.local', 'utf8')).DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error('DEEPSEEK_API_KEY_MISSING');
  const ledger = fileURLToPath(new URL('../botpress-agent/evals/results/campaign-budget-20260904.json', import.meta.url));
  readFileSync(ledger); // Missing ledger is a failure, never a fresh budget.
  env.DEEPSEEK_API_KEY = key;
  env.STUDYX_AGENT_A_BUDGET_FILE = ledger;
  env.NODE_OPTIONS = `--import ${JSON.stringify(fileURLToPath(new URL('./agent-a-api-budget.mjs', import.meta.url)))}`;
}
const [cmd, ...commandArgs] = args;
if (!cmd) throw new Error('Command required');
const child=spawn(cmd,commandArgs,{env,stdio:'inherit'});child.on('exit',code=>process.exit(code??1));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>child.kill(sig));
