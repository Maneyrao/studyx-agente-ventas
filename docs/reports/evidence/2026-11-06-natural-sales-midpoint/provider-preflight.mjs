// Disposable evaluation utility. Run once only, by the principal after its review gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const endpoint = 'https://api.deepseek.com/responses';
const model = 'deepseek-v4-flash';
const config = parseEnv(readFileSync('.eval/.env.local', 'utf8'));
const apiKey = config.DEEPSEEK_API_KEY?.trim();
if (!apiKey) throw new Error('PREFLIGHT_KEY_MISSING');
const resultFile = process.env.STUDYX_PREFLIGHT_RESULT_FILE
  ?? 'docs/reports/evidence/2026-11-06-natural-sales-midpoint/provider-preflight.json';
const record = { endpoint, model, started_at: new Date().toISOString(), attempts: 1,
  synthetic: true, deployment: false, status: 'started' };
// Prevent accidental repeat under the same evidence identity before any request.
writeFileSync(resultFile, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: 'Reply OK', reasoning: { effort: 'none' },
      stream: false, max_output_tokens: 16 }),
    signal: AbortSignal.timeout(30000),
  });
  const safeBody = (await response.text()).replaceAll(apiKey, '[REDACTED]');
  let parsed;
  try { parsed = JSON.parse(safeBody); } catch { parsed = null; }
  Object.assign(record, { ended_at: new Date().toISOString(), http_status: response.status,
    ok: response.ok, response_body: parsed ?? safeBody, usage: parsed?.usage ?? null,
    status: response.ok ? 'passed' : 'failed',
    failure_layer: response.status === 402 ? 'environment' : response.ok ? null : 'provider',
    stop_paid_evaluation: !response.ok });
} catch (error) {
  Object.assign(record, { ended_at: new Date().toISOString(), status: 'failed',
    failure_layer: 'environment', stop_paid_evaluation: true,
    error: String(error?.message ?? error).replaceAll(apiKey, '[REDACTED]') });
}
writeFileSync(resultFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ result_file: resultFile, status: record.status,
  http_status: record.http_status ?? null, attempts: record.attempts, usage: record.usage ?? null }));
process.exitCode = record.status === 'passed' ? 0 : 1;
