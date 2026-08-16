import { createHmac, randomUUID } from 'node:crypto';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (process.env.TELEGRAM_AGENT_B_SMOKE_ENABLED !== 'true') {
  fail('LIVE_SMOKE_DISABLED: set TELEGRAM_AGENT_B_SMOKE_ENABLED=true explicitly.');
}
if (!process.argv.includes('--confirm-sandbox')) {
  fail('CONFIRMATION_REQUIRED: pass --confirm-sandbox.');
}

const callIndex = process.argv.indexOf('--call-id');
const callId = callIndex >= 0 ? process.argv[callIndex + 1] : undefined;
if (!callId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId)) {
  fail('INVALID_CALL_ID: pass a preauthorized sandbox session with --call-id <uuid>.');
}

const required = ['ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_KEY_ID', 'STUDYX_SIGNING_SECRET'];
for (const key of required) {
  if (!process.env[key]) fail(`MISSING_CONFIG:${key}`);
}

const baseUrl = (process.env.AGENT_B_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const pathname = `/api/agent/calls/${callId}/dispatch`;
const traceId = randomUUID();
const idempotencyKey = `voice-call:${callId}`;
const requestId = `${traceId}:${idempotencyKey}`.slice(0, 512);
const timestamp = String(Date.now());
const body = JSON.stringify({ trace_id: traceId });
const canonical = [timestamp, 'POST', pathname, body].join('\n');
const signature = createHmac('sha256', process.env.STUDYX_SIGNING_SECRET).update(canonical).digest('hex');

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20_000);
try {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-orchestrator-key': process.env.ORCHESTRATOR_API_KEY,
      'x-orchestrator-key-id': process.env.ORCHESTRATOR_KEY_ID,
      'x-request-timestamp': timestamp,
      'x-signature': `v1=${signature}`,
      'x-request-id': requestId,
      'x-trace-id': traceId,
      'idempotency-key': idempotencyKey,
    },
    body,
    signal: controller.signal,
  });
  const result = await response.json().catch(() => ({ error: 'NON_JSON_RESPONSE' }));
  process.stdout.write(`${JSON.stringify({ http_status: response.status, result })}\n`);
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  const code = error instanceof DOMException && error.name === 'AbortError'
    ? 'SMOKE_REQUEST_TIMEOUT'
    : 'SMOKE_REQUEST_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
