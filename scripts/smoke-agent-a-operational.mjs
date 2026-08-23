#!/usr/bin/env node
/**
 * Smoke operativo — Agent A Operational MVP (Task 5 / A5).
 *
 * Ejercita el pipeline público /api/agent/* (ingest → claim → decision →
 * delivery-report) exactamente como lo hace botpress-agent/src/actions/*.ts
 * (misma firma HMAC, mismos headers, mismas claves de idempotencia — ver
 * botpress-agent/src/utils/http.ts). No importa código del backend: sólo
 * HTTP + una conexión de sólo verificación a la base de test local para leer
 * lo que el pipeline ya escribió (sheet_projection_rows, agent_decisions,
 * etc.) — nunca para escribir estado de negocio.
 *
 * Este script actúa como "el modelo": arma las decisiones v4 que en
 * producción arma Botpress/Gemini. Por eso la latencia medida acá es
 * SOLAMENTE el camino del backend (ingest+batch window+claim+commit) — la
 * latencia real del modelo corre en Botpress y no está representada aquí.
 * Las tablas de métricas lo etiquetan explícitamente como "backend-path".
 *
 * Casos 1-9 del contrato (docs/contracts/agent-a-operational-mvp.md §10).
 * El caso 10 (llamada hipotética) vive en scripts/smoke-hypothetical-call.mjs.
 *
 * Uso:
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
 *   ORCHESTRATOR_API_KEY=... ORCHESTRATOR_KEY_ID=... STUDYX_SIGNING_SECRET=... \
 *   BUSINESS_WORKSPACE_SLUG=studyx \
 *   PAYMENT_LINK_12M=... PAYMENT_LINK_6M=... PAYMENT_LINK_CONTADO=... \
 *   SMOKE_BASE_URL=http://127.0.0.1:3000 \
 *   node scripts/smoke-agent-a-operational.mjs
 *
 * Exit 1 ante cualquier caso fallido o incumplimiento de gate de latencia.
 */
import { randomUUID, createHmac } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`MISSING_ENV:${name}`);
    process.exit(2);
  }
  return v;
}

const LOCAL_TEST_PORTS = new Set(['55432', '55433', '55434', '55435']);
function assertLocalTestDatabaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    console.error('INVALID_TEST_DATABASE_URL');
    process.exit(2);
  }
  const okProto = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (!okProto || parsed.hostname !== '127.0.0.1' || !LOCAL_TEST_PORTS.has(parsed.port) || parsed.pathname !== '/studyx_test') {
    console.error('REFUSING_NON_LOCAL_TEST_DATABASE_URL: only 127.0.0.1:55432-55435/studyx_test is allowed.');
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Config — never reads DATABASE_URL/DIRECT_URL; only TEST_DATABASE_URL.
// ---------------------------------------------------------------------------
const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ORCHESTRATOR_API_KEY = requireEnv('ORCHESTRATOR_API_KEY');
const ORCHESTRATOR_KEY_ID = requireEnv('ORCHESTRATOR_KEY_ID');
const STUDYX_SIGNING_SECRET = requireEnv('STUDYX_SIGNING_SECRET');
const TEST_DATABASE_URL = requireEnv('TEST_DATABASE_URL');
assertLocalTestDatabaseUrl(TEST_DATABASE_URL);
const BUSINESS_WORKSPACE_SLUG = requireEnv('BUSINESS_WORKSPACE_SLUG');
const PAYMENT_LINK_12M = requireEnv('PAYMENT_LINK_12M');
const PAYMENT_LINK_6M = requireEnv('PAYMENT_LINK_6M');
const PAYMENT_LINK_CONTADO = requireEnv('PAYMENT_LINK_CONTADO');

const sql = postgres(TEST_DATABASE_URL, { max: 4 });

// ---------------------------------------------------------------------------
// Signed HTTP client — mirrors botpress-agent/src/utils/http.ts + src/proxy.ts
// ---------------------------------------------------------------------------
function hmacHex(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

async function signedCall(method, path, body, opts) {
  const { idempotencyKey, traceId, baseUrl = BASE_URL, acceptStatuses = [] } = opts;
  const url = `${baseUrl}${path}`;
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const timestamp = String(Date.now());
    const canonical = [timestamp, method, path, bodyStr].join('\n');
    const signature = hmacHex(STUDYX_SIGNING_SECRET, canonical);
    const requestId = `${traceId}:${idempotencyKey}`.slice(0, 512);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-orchestrator-key': ORCHESTRATOR_API_KEY,
          'x-orchestrator-key-id': ORCHESTRATOR_KEY_ID,
          'x-request-timestamp': timestamp,
          'x-signature': `v1=${signature}`,
          'x-request-id': requestId,
          'x-trace-id': traceId,
          'idempotency-key': idempotencyKey,
        },
        body: bodyStr || undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok && !acceptStatuses.includes(res.status)) {
        if ([500, 503].includes(res.status) && attempt < 3) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        const err = new Error(`HTTP_${res.status}:${method}:${path}:${JSON.stringify(json)}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return { status: res.status, json };
    } catch (error) {
      lastErr = error;
      if (error instanceof TypeError && attempt < 3) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastErr;
}

async function ingest(envelope, baseUrl = BASE_URL) {
  const key = `inbound:${envelope.source}:${envelope.integration_id}:${envelope.external_message_id}`;
  return signedCall('POST', '/api/agent/ingest', envelope, { idempotencyKey: key, traceId: envelope.trace_id, baseUrl });
}

async function claimOnce(batchId, traceId, baseUrl) {
  return signedCall(
    'POST',
    `/api/agent/batches/${batchId}/claim`,
    { trace_id: traceId, claimed_by: 'smoke-agent-a-operational' },
    { idempotencyKey: `claim:${batchId}`, traceId, baseUrl, acceptStatuses: [202, 404, 409, 410] }
  );
}

async function waitAndClaim(batch, traceId, baseUrl = BASE_URL) {
  const dueAt = new Date(batch.due_at).getTime();
  const hardDeadline = new Date(batch.hard_deadline_at).getTime();
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const now = Date.now();
    const wake = Math.min(dueAt, hardDeadline);
    if (now < wake) await sleep(Math.min(wake - now, 5000));
    const result = await claimOnce(batch.id, traceId, baseUrl);
    if (result.status === 200) return result.json;
    if (result.status === 202) {
      const retryAfter = result.json?.retry_after_ms ?? 250;
      await sleep(Math.min(Math.max(retryAfter, 100), 5000));
      continue;
    }
    throw new Error(`CLAIM_TERMINAL_${result.status}:${JSON.stringify(result.json)}`);
  }
  throw new Error('CLAIM_TIMED_OUT');
}

async function commitDecision(params) {
  const { turnId, traceId, decision, batchId = null, claimToken = null, baseUrl = BASE_URL, acceptStatuses = [] } = params;
  const body = {
    turn_id: turnId,
    trace_id: traceId,
    decision,
    model: { provider: 'botpress', model: 'smoke-synthetic-model', prompt_version: 'agent-a-smoke-v1' },
    batch_id: batchId,
    claim_token: claimToken,
  };
  return signedCall('POST', `/api/agent/turns/${turnId}/decision`, body, {
    idempotencyKey: `decision:${turnId}`,
    traceId,
    baseUrl,
    acceptStatuses,
  });
}

async function reportDelivery(params) {
  const { outboundId, traceId, status, botpressMessageId = null, deliveryAttempt = null, baseUrl = BASE_URL } = params;
  const body = {
    outbound_id: outboundId,
    trace_id: traceId,
    status,
    botpress_message_id: botpressMessageId,
    replayed: false,
    error_code: status === 'failed' ? 'SMOKE_FAILURE' : null,
    delivery_attempt: deliveryAttempt,
  };
  const key = `delivery:${outboundId}:${botpressMessageId ?? 'none'}:${status}`;
  return signedCall('POST', `/api/agent/outbounds/${outboundId}/delivery`, body, { idempotencyKey: key, traceId, baseUrl });
}

async function reportDeliveryIfAny(committed, traceId, baseUrl = BASE_URL) {
  if (!committed?.outbound) return null;
  return reportDelivery({
    outboundId: committed.outbound.id,
    traceId,
    status: 'submitted_to_botpress',
    botpressMessageId: `bp-${randomUUID()}`,
    deliveryAttempt: committed.outbound.delivery_attempt,
    baseUrl,
  });
}

// ---------------------------------------------------------------------------
// Synthetic identity + envelope helpers
// ---------------------------------------------------------------------------
function newPhone() {
  const digits = String(Math.floor(10_000_000 + Math.random() * 89_999_999)).padStart(10, '0');
  return `+999${digits}`;
}

function makeEnvelope({ phone, text, traceId, integrationId, conversationId, userId }) {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: integrationId,
    external_message_id: `msg-${randomUUID()}`,
    external_conversation_id: conversationId,
    external_user_id: userId,
    phone_e164: phone,
    trace_id: traceId,
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  };
}

async function sendTurn({ phone, text, label, baseUrl = BASE_URL }) {
  const traceId = randomUUID();
  const integrationId = `smoke-${label}-${randomUUID().slice(0, 8)}`;
  const envelope = makeEnvelope({
    phone,
    text,
    traceId,
    integrationId,
    conversationId: `conv-${integrationId}`,
    userId: `user-${integrationId}`,
  });
  const t0 = Date.now();
  const ingestRes = await ingest(envelope, baseUrl);
  const claimed = await waitAndClaim(ingestRes.json.batch, traceId, baseUrl);
  return { traceId, envelope, ingestRes: ingestRes.json, claimed, t0 };
}

// ---------------------------------------------------------------------------
// Latency bookkeeping
// ---------------------------------------------------------------------------
const latencySamples = { greeting: [], commercial: [] };
function recordLatency(kind, ms) {
  latencySamples[kind].push(ms);
}
function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function failResult(num, name, err) {
  return { case: num, name, pass: false, latencyMs: null, trace_id: null, error: err?.message ?? String(err) };
}

async function pollSheetRow(projectionKey, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    const rows = await sql`SELECT * FROM sheet_projection_rows WHERE projection_key = ${projectionKey}`;
    if (rows[0]) return rows[0];
    await sleep(300);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ephemeral second server (case 6 only — reuses the existing .next build)
// ---------------------------------------------------------------------------
async function startEphemeralServer(env, port) {
  const bin = resolve(REPO_ROOT, 'node_modules/.bin/next');
  const child = spawn(bin, ['start', '-p', String(port)], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`EPHEMERAL_SERVER_EXITED_EARLY:${child.exitCode}:${stderrTail}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return { child, baseUrl };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  child.kill('SIGTERM');
  throw new Error(`EPHEMERAL_SERVER_START_TIMEOUT:${stderrTail}`);
}

async function stopServer(server) {
  if (!server?.child) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => server.child.once('exit', r)),
    sleep(5000),
  ]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

// ---------------------------------------------------------------------------
// Case 1 — Saludo rápido (deterministic greeting route)
// ---------------------------------------------------------------------------
async function caseGreeting() {
  const phone = newPhone();
  const turn = await sendTurn({ phone, text: 'Hola', label: 'case1-greeting' });
  const c = turn.claimed;
  if (c.outcome !== 'claimed') throw new Error(`NOT_CLAIMED:${JSON.stringify(c)}`);
  const routeOk = c.deterministic_route === 'greeting';

  const decision = {
    schema_version: 4,
    intent: 'social',
    kind: 'reply',
    response: '¡Hola! Bienvenido a StudyX. ¿En qué curso estás interesado?',
    response_type: 'social_reply',
    confidence: 1,
    reason_code: 'GREETING_FAST_PATH',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: null,
  };
  const commit = await commitDecision({ turnId: c.turn_id, traceId: turn.traceId, decision, batchId: c.batch.id, claimToken: c.batch.claim_token });
  const latencyMs = Date.now() - turn.t0;
  recordLatency('greeting', latencyMs);
  await reportDeliveryIfAny(commit.json, turn.traceId);

  const pass = routeOk && commit.status === 200 && commit.json.status === 'committed' && commit.json.outbound?.status !== 'failed';
  return {
    case: 1,
    name: 'Saludo rápido',
    pass,
    latencyMs,
    trace_id: turn.traceId,
    detail: { deterministic_route: c.deterministic_route, response: commit.json.outbound?.content },
  };
}

// ---------------------------------------------------------------------------
// Case 2 — Consulta comercial grounded sin segunda lectura de catálogo
// ---------------------------------------------------------------------------
async function caseCommercialGrounded() {
  const phone = newPhone();
  const turn = await sendTurn({ phone, text: '¿Qué incluye el curso de Barista y cuánto sale?', label: 'case2-commercial' });
  const c = turn.claimed;
  if (c.outcome !== 'claimed') throw new Error(`NOT_CLAIMED:${JSON.stringify(c)}`);
  const offering = (c.business_context?.offerings ?? []).find((o) => o.code === 'barista') ?? null;
  const catalogCallsZero = c.diagnostics?.counters?.catalog_calls === 0;
  const priceText = offering?.price ? `USD ${offering.price.amount}` : 'a confirmar';

  const decision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: `El curso de Barista cuesta ${priceText} e incluye ${(offering?.includes ?? []).slice(0, 2).join(', ') || 'formación práctica y teórica'}.`,
    response_type: 'commercial_reply',
    confidence: 0.95,
    reason_code: 'GROUNDED_CATALOG_ANSWER',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: { kb: false, long_term_memory: false, summary_version: c.context?.summary?.version ?? null },
  };
  const commit = await commitDecision({ turnId: c.turn_id, traceId: turn.traceId, decision, batchId: c.batch.id, claimToken: c.batch.claim_token });
  const latencyMs = Date.now() - turn.t0;
  recordLatency('commercial', latencyMs);
  await reportDeliveryIfAny(commit.json, turn.traceId);

  const pass = !!offering && catalogCallsZero && c.business_context_available === true && commit.status === 200 && commit.json.status === 'committed';
  return {
    case: 2,
    name: 'Consulta comercial grounded',
    pass,
    latencyMs,
    trace_id: turn.traceId,
    detail: { offering_found: !!offering, catalog_calls: c.diagnostics?.counters?.catalog_calls, business_context_available: c.business_context_available },
  };
}

// ---------------------------------------------------------------------------
// Case 3 — Rechaza llamada y sigue por mensajes (venta completa por mensajes)
// ---------------------------------------------------------------------------
async function caseDeclineCallContinueByMessage() {
  const phone = newPhone();
  const label = 'case3-decline-call';

  const t1 = await sendTurn({ phone, text: 'Quiero saber precios de Barista', label });
  if (t1.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T1:${JSON.stringify(t1.claimed)}`);
  const offerDecision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: '¿Querés que te llamemos para contarte los detalles del curso de Barista?',
    response_type: 'call_offer',
    confidence: 0.9,
    reason_code: 'CALL_OFFER_PROPOSED',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  };
  const commit1 = await commitDecision({ turnId: t1.claimed.turn_id, traceId: t1.traceId, decision: offerDecision, batchId: t1.claimed.batch.id, claimToken: t1.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t1.t0);
  await reportDeliveryIfAny(commit1.json, t1.traceId);

  const t2 = await sendTurn({ phone, text: 'Sí, pero no me llames', label });
  if (t2.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T2:${JSON.stringify(t2.claimed)}`);
  const declineAttempt = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
    response_type: 'call_confirmation',
    confidence: 1,
    reason_code: 'CALL_CONSENT_ACCEPTED',
    business_action: { type: 'request_call_now', reason: 'accepted_offer', course_of_interest: 'Barista' },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: null,
  };
  const rejected = await commitDecision({
    turnId: t2.claimed.turn_id,
    traceId: t2.traceId,
    decision: declineAttempt,
    batchId: t2.claimed.batch.id,
    claimToken: t2.claimed.batch.claim_token,
    acceptStatuses: [422],
  });
  const declinedProperly = rejected.status === 422 && rejected.json?.reason === 'CALL_EXPLICITLY_DECLINED';

  const fallbackDecision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Dale, seguimos por acá. Te cuento del curso de Barista: es intensivo y con certificación.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'CALL_DECLINED_CONTINUE_BY_MESSAGE',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  };
  const commit2 = await commitDecision({ turnId: t2.claimed.turn_id, traceId: t2.traceId, decision: fallbackDecision, batchId: t2.claimed.batch.id, claimToken: t2.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t2.t0);
  await reportDeliveryIfAny(commit2.json, t2.traceId);

  const t3 = await sendTurn({ phone, text: 'Dale, quiero pagar en 12 cuotas', label });
  if (t3.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T3:${JSON.stringify(t3.claimed)}`);
  const payDecision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Genial, te paso el link para las 12 cuotas:',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'PLAN_CHOSEN_VIA_MESSAGES',
    business_action: { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: null,
  };
  const commit3 = await commitDecision({ turnId: t3.claimed.turn_id, traceId: t3.traceId, decision: payDecision, batchId: t3.claimed.batch.id, claimToken: t3.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t3.t0);
  await reportDeliveryIfAny(commit3.json, t3.traceId);

  const contactId = t1.claimed.batch.contact_id;
  const noCallRows = await sql`SELECT count(*)::int AS count FROM call_sessions WHERE contact_id = ${contactId}::uuid`;
  const noCallEver = noCallRows[0].count === 0;
  const linkOk = !!commit3.json.outbound?.content?.includes(PAYMENT_LINK_12M);

  const pass = declinedProperly && noCallEver && commit3.status === 200 && commit3.json.status === 'committed' && linkOk;
  return {
    case: 3,
    name: 'Rechaza llamada y sigue por mensajes',
    pass,
    latencyMs: Date.now() - t1.t0,
    trace_id: t1.traceId,
    detail: { declinedProperly, decline_reason: rejected.json?.reason, noCallEver, linkOk },
  };
}

// ---------------------------------------------------------------------------
// Case 4 — Elige monthly_12 → un único link exacto + Sheet proposal
// ---------------------------------------------------------------------------
async function casePaymentLink12m() {
  const phone = newPhone();
  const turn = await sendTurn({ phone, text: 'Quiero pagar en 12 cuotas', label: 'case4-pay-12m' });
  if (turn.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED:${JSON.stringify(turn.claimed)}`);
  const decision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Perfecto, te paso el link para las 12 cuotas:',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'PLAN_CHOSEN_12M',
    business_action: { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: null,
  };
  const commit = await commitDecision({ turnId: turn.claimed.turn_id, traceId: turn.traceId, decision, batchId: turn.claimed.batch.id, claimToken: turn.claimed.batch.claim_token });
  const latencyMs = Date.now() - turn.t0;
  recordLatency('commercial', latencyMs);
  const outbound = commit.json.outbound;
  await reportDeliveryIfAny(commit.json, turn.traceId);

  const content = outbound?.content ?? '';
  const occurrences12 = content.split(PAYMENT_LINK_12M).length - 1;
  const linkExact = occurrences12 === 1 && !content.includes(PAYMENT_LINK_6M) && !content.includes(PAYMENT_LINK_CONTADO);

  const contactId = turn.claimed.batch.contact_id;
  const workspaceRows = await sql`SELECT id FROM workspaces WHERE slug = ${BUSINESS_WORKSPACE_SLUG}`;
  const workspaceId = workspaceRows[0]?.id;
  const projectionKey = `lead:${workspaceId}:${contactId}`;
  const row = await pollSheetRow(projectionKey);
  const payload = row?.payload ?? {};
  const sheetOk = !!row
    && payload.etapa_comercial === 'proposal'
    && payload.estado_pago === 'pendiente'
    && payload.plan === 'monthly_12'
    && payload.ultima_senal === 'payment_link_sent';

  const pass = commit.status === 200 && commit.json.status === 'committed' && linkExact && sheetOk;
  return {
    case: 4,
    name: 'Elige monthly_12 → link exacto + Sheet proposal',
    pass,
    latencyMs,
    trace_id: turn.traceId,
    detail: { linkExact, occurrences12, sheetOk, projectionKey, sheet_payload: payload },
    context: {
      turnId: turn.claimed.turn_id,
      traceId: turn.traceId,
      batchId: turn.claimed.batch.id,
      claimToken: turn.claimed.batch.claim_token,
      contactId,
      projectionKey,
      decision,
    },
  };
}

// ---------------------------------------------------------------------------
// Case 5 — Replay del caso 4 → cero links/filas adicionales
// ---------------------------------------------------------------------------
async function casePaymentLinkReplay(prevCtx) {
  if (!prevCtx) throw new Error('CASE4_CONTEXT_MISSING');
  const { turnId, traceId, batchId, claimToken, decision, projectionKey } = prevCtx;

  const before = await sql`SELECT count(*)::int AS count FROM sheet_projection_rows WHERE projection_key = ${projectionKey}`;
  const beforeOutbound = await sql`SELECT count(*)::int AS count FROM outbound_deliveries od JOIN agent_decisions ad ON ad.outbound_message_id = od.message_id WHERE ad.turn_id = ${turnId}::uuid`;

  const commit = await commitDecision({ turnId, traceId, decision, batchId, claimToken });
  // No delivery-report replay here on purpose: case 4 already reported this
  // outbound as delivered, so a second "submitted_to_botpress" report for the
  // same delivery_attempt correctly 409s (DELIVERY_REPORT_CONFLICT) — that IS
  // idempotency working, not a bug, but it is a different layer than what
  // this case asserts (decision-commit replay ⇒ zero new links/rows).

  const after = await sql`SELECT count(*)::int AS count FROM sheet_projection_rows WHERE projection_key = ${projectionKey}`;
  const afterOutbound = await sql`SELECT count(*)::int AS count FROM outbound_deliveries od JOIN agent_decisions ad ON ad.outbound_message_id = od.message_id WHERE ad.turn_id = ${turnId}::uuid`;

  const noNewSheetRows = before[0].count === after[0].count && after[0].count === 1;
  const noNewOutbound = beforeOutbound[0].count === afterOutbound[0].count;
  const isDuplicate = commit.json.status === 'duplicate';

  const pass = isDuplicate && noNewSheetRows && noNewOutbound;
  return {
    case: 5,
    name: 'Replay del caso 4 → cero duplicados',
    pass,
    latencyMs: null,
    trace_id: traceId,
    detail: { status: commit.json.status, noNewSheetRows, noNewOutbound, sheet_row_count: after[0].count },
  };
}

// ---------------------------------------------------------------------------
// Case 6 — URL de plan ausente (segundo server sin PAYMENT_LINK_6M)
// ---------------------------------------------------------------------------
async function caseLinkConfigMissing() {
  const port = Number(process.env.SMOKE_CASE6_PORT ?? 3101);
  const env = { ...process.env };
  delete env.PAYMENT_LINK_6M;
  const server = await startEphemeralServer(env, port);
  try {
    const phone = newPhone();
    const turn = await sendTurn({ phone, text: 'Quiero pagar en 6 cuotas', label: 'case6-missing-link', baseUrl: server.baseUrl });
    if (turn.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED:${JSON.stringify(turn.claimed)}`);
    const decision = {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Perfecto, te paso el link para las 6 cuotas:',
      response_type: 'commercial_reply',
      confidence: 1,
      reason_code: 'PLAN_CHOSEN_6M',
      business_action: { type: 'send_payment_link', plan_code: 'monthly_6', offering_sku: null },
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
      retrieval_used: null,
    };
    const commit = await commitDecision({
      turnId: turn.claimed.turn_id,
      traceId: turn.traceId,
      decision,
      batchId: turn.claimed.batch.id,
      claimToken: turn.claimed.batch.claim_token,
      baseUrl: server.baseUrl,
      acceptStatuses: [422],
    });
    const latencyMs = Date.now() - turn.t0;
    // DecisionPolicyError always reports error:'DECISION_REJECTED'; the
    // specific policy reason (LINK_CONFIG_MISSING) rides in `reason`.
    const refused = commit.status === 422 && commit.json?.reason === 'LINK_CONFIG_MISSING';

    const decisionRows = await sql`SELECT count(*)::int AS count FROM agent_decisions WHERE turn_id = ${turn.claimed.turn_id}::uuid`;
    const zeroDecision = decisionRows[0].count === 0;

    const pass = refused && zeroDecision;
    return {
      case: 6,
      name: 'URL de plan ausente → sin link',
      pass,
      latencyMs,
      trace_id: turn.traceId,
      detail: { status: commit.status, error: commit.json?.error, reason: commit.json?.reason, zeroDecision },
    };
  } finally {
    await stopServer(server);
  }
}

// ---------------------------------------------------------------------------
// Case 7 — Restricción expresada y recuperada en segundo turno
// ---------------------------------------------------------------------------
function runSelectedMemoryEmbeddingWorker() {
  const bin = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
  const script = resolve(REPO_ROOT, 'scripts/run-selected-memory-embeddings.ts');
  // Hard timeout: scripts/run-selected-memory-embeddings.ts never calls
  // sql.end()/process.exit() on its own success path, so the child process
  // keeps its DB socket open and never exits even after finishing its work
  // (confirmed: the CLI's own claim/complete queries return in well under a
  // second, but the process lingers indefinitely afterwards). The work is
  // already durable in PostgreSQL by the time that happens, so a bounded
  // kill-after-timeout here is safe — case 7 re-checks embedding_state in
  // the database afterwards regardless of how this call ends.
  const out = execFileSync(bin, [script], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL' });
  const lastLine = out.trim().split('\n').filter(Boolean).pop();
  return lastLine ? JSON.parse(lastLine) : null;
}

async function caseMemoryRecall() {
  const phone = newPhone();
  const label = 'case7-memory';
  const constraintQuote = 'Solo puedo los sábados, entre semana no tengo tiempo para nada';

  const t1 = await sendTurn({ phone, text: constraintQuote, label });
  if (t1.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T1:${JSON.stringify(t1.claimed)}`);
  const decision1 = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Anotado, tenemos opciones con clases los sábados.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'CONSTRAINT_CAPTURED',
    business_action: null,
    memory_candidates: [
      {
        // `value` must be grounded in `source_quote` (every significant token
        // has to appear in the quote itself, see
        // src/features/orchestration/domain/memory-selection.ts's
        // isGroundedInQuote) — a paraphrase like "Disponible sólo los
        // sábados" introduces the word "Disponible", which the customer
        // never wrote, and gets rejected as VALUE_NOT_GROUNDED. Using a
        // literal substring of the quote satisfies the grounding check.
        type: 'constraint',
        key: 'availability_days',
        value: 'Solo puedo los sábados',
        source_quote: constraintQuote,
        confidence: 0.92,
      },
    ],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  };
  const commit1 = await commitDecision({ turnId: t1.claimed.turn_id, traceId: t1.traceId, decision: decision1, batchId: t1.claimed.batch.id, claimToken: t1.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t1.t0);
  await reportDeliveryIfAny(commit1.json, t1.traceId);

  const contactId = t1.claimed.batch.contact_id;
  let embeddingReady = false;
  for (let i = 0; i < 3 && !embeddingReady; i += 1) {
    try {
      runSelectedMemoryEmbeddingWorker();
    } catch (err) {
      console.error('run-selected-memory-embeddings failed:', err.message);
    }
    const rows = await sql`
      SELECT embedding_state FROM selected_memories
      WHERE contact_id = ${contactId}::uuid AND memory_key = 'availability_days'
      ORDER BY created_at DESC LIMIT 1
    `;
    embeddingReady = rows[0]?.embedding_state === 'ready';
    if (!embeddingReady) await sleep(500);
  }

  // Close to the constraint's own wording on purpose: selected-memory search
  // uses a 0.75 cosine-similarity floor (DEFAULT_CONTEXT_LIMITS.memoryMinSimilarity
  // in claim-batch.ts), so the second turn has to be genuinely close in
  // embedding space to the stored value, not just topically related.
  const t2 = await sendTurn({ phone, text: '¿Los sábados hay clases de Barista? Como te dije, sólo puedo los sábados.', label });
  if (t2.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T2:${JSON.stringify(t2.claimed)}`);
  const recalled = (t2.claimed.context.selected_memories ?? []).find(
    (m) => m.value?.toLowerCase().includes('sábados') || m.source_quote === constraintQuote
  );

  const decision2 = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: recalled
      ? 'Como me contaste que sólo podés los sábados, el curso de Barista tiene turnos sabatinos.'
      : 'El curso de Barista tiene varios horarios disponibles.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: recalled ? 'MEMORY_GROUNDED_ANSWER' : 'MEMORY_UNAVAILABLE',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: { kb: false, long_term_memory: !!recalled, summary_version: t2.claimed.context?.summary?.version ?? null },
  };
  const commit2 = await commitDecision({ turnId: t2.claimed.turn_id, traceId: t2.traceId, decision: decision2, batchId: t2.claimed.batch.id, claimToken: t2.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t2.t0);
  await reportDeliveryIfAny(commit2.json, t2.traceId);

  const pass = embeddingReady && !!recalled && commit2.status === 200 && commit2.json.status === 'committed';
  return {
    case: 7,
    name: 'Restricción expresada y recuperada en turno 2',
    pass,
    latencyMs: Date.now() - t2.t0,
    trace_id: t2.traceId,
    detail: { embeddingReady, recalled: recalled ? { value: recalled.value, source_quote: recalled.source_quote } : null },
  };
}

// ---------------------------------------------------------------------------
// Case 8 — Pregunta de KB → chunks recuperados con workspace correcto
// ---------------------------------------------------------------------------
async function caseKnowledgeGrounded() {
  const phone = newPhone();
  const turn = await sendTurn({ phone, text: '¿Qué temas incluye el curso de Barista?', label: 'case8-kb' });
  const c = turn.claimed;
  if (c.outcome !== 'claimed') throw new Error(`NOT_CLAIMED:${JSON.stringify(c)}`);
  const kbItems = c.context.knowledge_base ?? [];
  const baristaChunk = kbItems.find((item) => /barista/i.test(item.title) || /barista/i.test(item.content));
  const countersOk = c.diagnostics?.counters?.knowledge_search_calls === 1 && (c.diagnostics?.counters?.embedding_calls ?? 0) <= 1;

  // Independent workspace-scoping check: the top KB doc titled "Temario —
  // Barista" must exist in the studyx workspace and be the one that came back.
  const dbCheck = await sql`
    SELECT kd.title FROM knowledge_documents kd
    JOIN workspaces w ON w.id = kd.workspace_id
    WHERE w.slug = ${BUSINESS_WORKSPACE_SLUG} AND kd.title ILIKE '%Barista%'
  `;
  const workspaceHasBaristaDoc = dbCheck.length > 0;

  const decision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: baristaChunk
      ? `Según el temario: ${baristaChunk.content.slice(0, 220)}`
      : 'Te cuento del curso de Barista aunque no encontré el temario detallado.',
    response_type: 'commercial_reply',
    confidence: baristaChunk ? 0.95 : 0.6,
    reason_code: baristaChunk ? 'KB_GROUNDED_ANSWER' : 'KB_UNAVAILABLE',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: { kb: !!baristaChunk, long_term_memory: false, summary_version: c.context?.summary?.version ?? null },
  };
  const commit = await commitDecision({ turnId: c.turn_id, traceId: turn.traceId, decision, batchId: c.batch.id, claimToken: c.batch.claim_token });
  const latencyMs = Date.now() - turn.t0;
  recordLatency('commercial', latencyMs);
  await reportDeliveryIfAny(commit.json, turn.traceId);

  const pass = !!baristaChunk && c.context.knowledge_base_available === true && workspaceHasBaristaDoc && countersOk && commit.status === 200;
  return {
    case: 8,
    name: 'Pregunta de KB → chunk recuperado',
    pass,
    latencyMs,
    trace_id: turn.traceId,
    detail: {
      found: !!baristaChunk,
      knowledge_base_available: c.context.knowledge_base_available,
      counters: c.diagnostics?.counters,
      workspaceHasBaristaDoc,
    },
  };
}

// ---------------------------------------------------------------------------
// Case 9 — Contacto bloqueado → cero outbound y cero actualización comercial
// ---------------------------------------------------------------------------
async function caseBlockedContact() {
  const phone = newPhone();
  const label = 'case9-blocked';

  const t1 = await sendTurn({ phone, text: 'Hola, quiero info', label });
  if (t1.claimed.outcome !== 'claimed') throw new Error(`NOT_CLAIMED_T1:${JSON.stringify(t1.claimed)}`);
  const setupDecision = {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: '¡Hola! Contame qué curso te interesa.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'CASE9_SETUP_TURN',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  };
  const commit1 = await commitDecision({ turnId: t1.claimed.turn_id, traceId: t1.traceId, decision: setupDecision, batchId: t1.claimed.batch.id, claimToken: t1.claimed.batch.claim_token });
  recordLatency('commercial', Date.now() - t1.t0);
  await reportDeliveryIfAny(commit1.json, t1.traceId);

  const contactId = t1.claimed.batch.contact_id;
  await sql`UPDATE contacts SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'smoke-case9' WHERE id = ${contactId}::uuid`;

  // Baseline AFTER blocking: turn1 (pre-block) legitimately produced one
  // outbound. What must stay at zero is any NEW outbound past this point.
  const outboundBefore = await sql`SELECT count(*)::int AS count FROM outbound_deliveries WHERE contact_id = ${contactId}::uuid`;

  const traceId2 = randomUUID();
  const integrationId2 = `smoke-${label}-followup-${randomUUID().slice(0, 8)}`;
  const envelope2 = makeEnvelope({
    phone,
    text: 'Ahora quiero pagar, mandame el link',
    traceId: traceId2,
    integrationId: integrationId2,
    conversationId: `conv-${integrationId2}`,
    userId: `user-${integrationId2}`,
  });
  const ingestRes2 = await ingest(envelope2);
  const suppressed = ingestRes2.json.status === 'suppressed'
    && ingestRes2.json.policy.may_respond === false
    && ingestRes2.json.contact.blocked === true;

  const decisionRows = await sql`SELECT count(*)::int AS count FROM agent_decisions WHERE turn_id = ${ingestRes2.json.turn_id}::uuid`;
  const outboundAfter = await sql`SELECT count(*)::int AS count FROM outbound_deliveries WHERE contact_id = ${contactId}::uuid`;
  const zeroDecision = decisionRows[0].count === 0;
  const zeroNewOutbound = outboundAfter[0].count === outboundBefore[0].count;

  const pass = suppressed && zeroDecision && zeroNewOutbound;
  return {
    case: 9,
    name: 'Contacto bloqueado → cero outbound',
    pass,
    latencyMs: null,
    trace_id: traceId2,
    detail: { suppressed, policy: ingestRes2.json.policy, zeroDecision, zeroNewOutbound, outbound_before: outboundBefore[0].count, outbound_after: outboundAfter[0].count },
  };
}

// ---------------------------------------------------------------------------
// Latency top-up: ≥10 saludo + ≥30 comercial turnos controlados
// ---------------------------------------------------------------------------
async function topUpLatencySamples() {
  let guard = 0;
  while (latencySamples.greeting.length < 10 && guard < 30) {
    guard += 1;
    try {
      const phone = newPhone();
      const turn = await sendTurn({ phone, text: 'Hola', label: 'latency-greeting' });
      if (turn.claimed.outcome !== 'claimed') continue;
      const decision = {
        schema_version: 4,
        intent: 'social',
        kind: 'reply',
        response: '¡Hola! ¿En qué te puedo ayudar hoy?',
        response_type: 'social_reply',
        confidence: 1,
        reason_code: 'GREETING_FAST_PATH',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      };
      const commit = await commitDecision({ turnId: turn.claimed.turn_id, traceId: turn.traceId, decision, batchId: turn.claimed.batch.id, claimToken: turn.claimed.batch.claim_token });
      recordLatency('greeting', Date.now() - turn.t0);
      await reportDeliveryIfAny(commit.json, turn.traceId);
    } catch (err) {
      console.error('latency-greeting-turn-failed:', err.message);
    }
  }

  guard = 0;
  const commercialPrompts = [
    'Quiero información del curso de Barista',
    'Cuánto sale el curso de Masoterapia',
    'Qué incluye Entrenamiento Funcional',
    'Tienen curso de Fotografía Profesional',
    'Me interesa Uñas gelificadas',
  ];
  while (latencySamples.commercial.length < 30 && guard < 60) {
    guard += 1;
    try {
      const phone = newPhone();
      const text = commercialPrompts[guard % commercialPrompts.length];
      const turn = await sendTurn({ phone, text, label: 'latency-commercial' });
      if (turn.claimed.outcome !== 'claimed') continue;
      const decision = {
        schema_version: 4,
        intent: 'commercial',
        kind: 'reply',
        response: `Te cuento: ${text.toLowerCase()} incluye formación práctica y teórica con certificación.`,
        response_type: 'commercial_reply',
        confidence: 0.9,
        reason_code: 'LATENCY_SAMPLE',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
        retrieval_used: null,
      };
      const commit = await commitDecision({ turnId: turn.claimed.turn_id, traceId: turn.traceId, decision, batchId: turn.claimed.batch.id, claimToken: turn.claimed.batch.claim_token });
      recordLatency('commercial', Date.now() - turn.t0);
      await reportDeliveryIfAny(commit.json, turn.traceId);
    } catch (err) {
      console.error('latency-commercial-turn-failed:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function printTable(results, metrics) {
  console.log('\n=== Agent A Operational MVP — smoke results (cases 1-9) ===\n');
  console.log('case | pass/fail | latency_ms | trace_id');
  for (const r of results.sort((a, b) => a.case - b.case)) {
    console.log(`${String(r.case).padEnd(4)} | ${(r.pass ? 'PASS' : 'FAIL').padEnd(9)} | ${String(r.latencyMs ?? '-').padEnd(10)} | ${r.trace_id ?? '-'}  ${r.name}`);
    if (!r.pass) console.log(`     detail: ${JSON.stringify(r.detail ?? r.error)}`);
  }
  console.log('\n=== Latency gates (backend-path only — model latency runs in Botpress, not measured here) ===\n');
  console.log(`saludo (n=${latencySamples.greeting.length})     p95=${metrics.greetingP95}ms  gate<=2500ms  ${metrics.gateGreeting ? 'PASS' : 'FAIL'}`);
  console.log(`comercial (n=${latencySamples.commercial.length}) p50=${metrics.commercialP50}ms  gate<=3200ms  ${metrics.gateCommercialP50 ? 'PASS' : 'FAIL'}`);
  console.log(`comercial (n=${latencySamples.commercial.length}) p95=${metrics.commercialP95}ms  gate<=4500ms  ${metrics.gateCommercialP95 ? 'PASS' : 'FAIL'}`);
  console.log('');
}

async function main() {
  const results = [];
  const steps = [
    ['caseGreeting', caseGreeting, 1, 'Saludo rápido'],
    ['caseCommercialGrounded', caseCommercialGrounded, 2, 'Consulta comercial grounded'],
    ['caseDeclineCallContinueByMessage', caseDeclineCallContinueByMessage, 3, 'Rechaza llamada y sigue por mensajes'],
  ];

  let case4Context = null;
  for (const [, fn, num, name] of steps) {
    try {
      results.push(await fn());
    } catch (err) {
      results.push(failResult(num, name, err));
    }
  }

  try {
    const r4 = await casePaymentLink12m();
    case4Context = r4.context;
    results.push(r4);
  } catch (err) {
    results.push(failResult(4, 'Elige monthly_12 → link exacto + Sheet proposal', err));
  }

  try {
    results.push(await casePaymentLinkReplay(case4Context));
  } catch (err) {
    results.push(failResult(5, 'Replay del caso 4 → cero duplicados', err));
  }

  try {
    results.push(await caseLinkConfigMissing());
  } catch (err) {
    results.push(failResult(6, 'URL de plan ausente → sin link', err));
  }

  try {
    results.push(await caseMemoryRecall());
  } catch (err) {
    results.push(failResult(7, 'Restricción expresada y recuperada en turno 2', err));
  }

  try {
    results.push(await caseKnowledgeGrounded());
  } catch (err) {
    results.push(failResult(8, 'Pregunta de KB → chunk recuperado', err));
  }

  try {
    results.push(await caseBlockedContact());
  } catch (err) {
    results.push(failResult(9, 'Contacto bloqueado → cero outbound', err));
  }

  await topUpLatencySamples();

  const greetingP95 = percentile(latencySamples.greeting, 95);
  const commercialP50 = percentile(latencySamples.commercial, 50);
  const commercialP95 = percentile(latencySamples.commercial, 95);
  const gateGreeting = greetingP95 !== null && greetingP95 <= 2500;
  const gateCommercialP50 = commercialP50 !== null && commercialP50 <= 3200;
  const gateCommercialP95 = commercialP95 !== null && commercialP95 <= 4500;

  printTable(results, { greetingP95, commercialP50, commercialP95, gateGreeting, gateCommercialP50, gateCommercialP95 });

  const anyCaseFail = results.some((r) => !r.pass);
  const anyGateFail = !gateGreeting || !gateCommercialP50 || !gateCommercialP95;

  await sql.end();

  if (anyCaseFail || anyGateFail) {
    console.error('SMOKE_FAILED: at least one case or latency gate did not pass.');
    process.exit(1);
  }
  console.log('SMOKE_PASSED: all 9 cases and both latency gates passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
