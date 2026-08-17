#!/usr/bin/env node
/**
 * Reproducible concurrency probe for the full turn API loop.
 *
 *   node scripts/load-turn-concurrency.mjs --vus 1,10,25,50 [--base <url>]
 *
 * Each virtual user runs ONE full signed turn — ingest → wait due_at → claim
 * → deterministic decision commit → delivery report (failed-by-design, no
 * physical send) — with its own +999 sandbox identity. Reports p50/p95/p99
 * per stage and per turn, plus errors, 429s, timeouts and duplicate checks
 * (a turn must yield exactly one decision and at most one outbound).
 *
 * Safe by construction: sandbox contacts only, no Botpress calls, no model
 * calls, nothing is physically sent anywhere.
 */
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENV_PATH = resolve(ROOT, '.env.local');
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq);
    if (process.env[k] === undefined) process.env[k] = t.slice(eq + 1);
  }
}

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = argValue('--base', 'https://studyx-agente-ventas.vercel.app');
const VU_STEPS = argValue('--vus', '1,10,25,50').split(',').map(Number);
const KEY_ID = process.env.ORCHESTRATOR_KEY_ID || 'botpress-dev';
const KEY = process.env.ORCHESTRATOR_API_KEY;
const SECRET = process.env.STUDYX_SIGNING_SECRET;
const REQUEST_TIMEOUT_MS = 20_000;

if (!KEY || !SECRET) {
  console.error('ORCHESTRATOR_API_KEY / STUDYX_SIGNING_SECRET missing');
  process.exit(2);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

async function signed(trace, method, path, body, idempotencyKey, counters) {
  const ts = Date.now().toString();
  const payload = body === undefined ? '' : JSON.stringify(body);
  const canonical = [ts, method, path, payload].join('\n');
  const sig = crypto.createHmac('sha256', SECRET).update(canonical).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const resp = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-key-id': KEY_ID,
        'x-orchestrator-key': KEY,
        'x-request-timestamp': ts,
        'x-signature': `v1=${sig}`,
        'x-request-id': `${trace}:${idempotencyKey}`.slice(0, 512),
        'x-trace-id': trace,
        'idempotency-key': idempotencyKey,
      },
      body: payload || undefined,
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    if (resp.status === 429) counters.http429 += 1;
    const json = await resp.json().catch(() => null);
    return { status: resp.status, ms, json };
  } catch (error) {
    counters.timeouts += error?.name === 'AbortError' ? 1 : 0;
    counters.networkErrors += error?.name === 'AbortError' ? 0 : 1;
    return { status: 0, ms: Date.now() - t0, json: null, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function runTurn(vuIndex, runTag, counters) {
  const trace = crypto.randomUUID();
  const phone = `+9991${String(vuIndex).padStart(3, '0')}${String(runTag % 10_000_000).padStart(7, '0')}`;
  const externalMessageId = `load-${runTag}-${vuIndex}`;
  const result = { ok: false, stages: {}, outboundCount: 0, decisionCount: 0 };

  const envelope = {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'latency-load',
    external_message_id: externalMessageId,
    external_conversation_id: `load-conv-${runTag}-${vuIndex}`,
    external_user_id: `load-user-${runTag}-${vuIndex}`,
    phone_e164: phone,
    trace_id: trace,
    message: {
      type: 'text',
      text: 'hola',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
    sandbox_provider: 'telegram_sandbox',
  };

  // Mirrors the real Botpress client: retryable statuses (425/429/503) get a
  // few jittered retries because the ingest is idempotent by construction.
  const turnStart = Date.now();
  let ingest;
  const ingestStart = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    ingest = await signed(
      trace,
      'POST',
      '/api/agent/ingest',
      envelope,
      `inbound:botpress:latency-load:${externalMessageId}`,
      counters,
    );
    if (![425, 429, 503].includes(ingest.status) || attempt === 3) break;
    counters.retriedIngests += 1;
    await new Promise((r) => setTimeout(r, Math.random() * 250 * 2 ** attempt));
  }
  result.stages.ingest_ms = Date.now() - ingestStart;
  if (ingest.status !== 200) {
    counters.errors.push(`ingest:${ingest.status}:${JSON.stringify(ingest.json)?.slice(0, 120)}`);
    return result;
  }

  const batch = ingest.json.batch;
  const waitMs = Math.max(0, Date.parse(batch.due_at) - Date.now());
  result.stages.batch_wait_ms = waitMs;
  await new Promise((r) => setTimeout(r, waitMs));

  let claim = null;
  const claimStart = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    claim = await signed(
      trace,
      'POST',
      `/api/agent/batches/${batch.id}/claim`,
      { batch_id: batch.id, trace_id: trace, claimed_by: `load:${trace}` },
      `claim:${batch.id}`,
      counters,
    );
    if (claim.json?.outcome === 'claimed') break;
    if (claim.json?.outcome === 'waiting') {
      await new Promise((r) => setTimeout(r, Math.max(claim.json.retry_after_ms, 250)));
      continue;
    }
    counters.errors.push(`claim:${claim.status}:${claim.json?.outcome ?? claim.error}`);
    return result;
  }
  if (claim?.json?.outcome !== 'claimed') {
    counters.errors.push('claim:exhausted');
    return result;
  }
  result.stages.claim_ms = Date.now() - claimStart;
  const turnId = claim.json.turn_id;

  const decision = {
    schema_version: 3,
    intent: 'social',
    kind: 'reply',
    response: 'Prueba de carga controlada — decisión determinista sin envío físico.',
    response_type: 'social_reply',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: 'DETERMINISTIC_GREETING',
    confidence: 1,
    retrieval_used: { kb: false, long_term_memory: false, summary_version: null },
  };

  const commit = await signed(
    trace,
    'POST',
    `/api/agent/turns/${turnId}/decision`,
    {
      turn_id: turnId,
      trace_id: trace,
      decision,
      model: {
        provider: 'botpress',
        model: 'deterministic:load-probe-v1',
        prompt_version: 'studyx-decision-v3',
      },
    },
    `decision:${turnId}`,
    counters,
  );
  result.stages.commit_ms = commit.ms;
  if (commit.status !== 200) {
    counters.errors.push(`commit:${commit.status}:${JSON.stringify(commit.json)?.slice(0, 120)}`);
    return result;
  }
  result.decisionCount = commit.json.decision_id ? 1 : 0;

  const outbound = commit.json.outbound;
  if (outbound) {
    result.outboundCount = 1;
    const report = await signed(
      trace,
      'POST',
      `/api/agent/outbounds/${outbound.id}/delivery`,
      {
        outbound_id: outbound.id,
        trace_id: trace,
        status: 'failed',
        botpress_message_id: null,
        replayed: false,
        error_code: 'LOAD_PROBE_NO_SEND',
        delivery_attempt: outbound.delivery_attempt,
      },
      `delivery:${outbound.id}:none:failed`,
      counters,
    );
    result.stages.delivery_report_ms = report.ms;
    if (report.status !== 200) {
      counters.errors.push(`report:${report.status}`);
      return result;
    }
  }

  result.stages.total_turn_ms = Date.now() - turnStart;
  result.ok = true;
  return result;
}

for (const vus of VU_STEPS) {
  const runTag = Date.now() % 100_000_000;
  const counters = { http429: 0, timeouts: 0, networkErrors: 0, retriedIngests: 0, errors: [] };
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: vus }, (_, i) => runTurn(i, runTag, counters)),
  );
  const wall = Date.now() - t0;
  const ok = results.filter((r) => r.ok);
  const stageNames = [
    'ingest_ms',
    'batch_wait_ms',
    'claim_ms',
    'commit_ms',
    'delivery_report_ms',
    'total_turn_ms',
  ];
  console.log(`\n===== ${vus} VUs — ${ok.length}/${vus} ok in ${wall}ms =====`);
  for (const stage of stageNames) {
    const values = ok.map((r) => r.stages[stage]).filter((v) => typeof v === 'number');
    if (values.length > 0) {
      const s = stats(values);
      console.log(
        `${stage.padEnd(19)} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms max=${s.max}ms`,
      );
    }
  }
  const duplicates = ok.filter((r) => r.outboundCount > 1 || r.decisionCount > 1).length;
  console.log(
    `errors=${counters.errors.length} http429=${counters.http429} timeouts=${counters.timeouts} network=${counters.networkErrors} retried_ingests=${counters.retriedIngests} duplicates=${duplicates}`,
  );
  if (counters.errors.length > 0) {
    console.log('error samples:', counters.errors.slice(0, 5).join(' | '));
  }
  await new Promise((r) => setTimeout(r, 2000));
}
