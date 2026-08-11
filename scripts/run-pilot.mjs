#!/usr/bin/env node
/**
 * run-pilot.mjs — exercises the canonical StudyX HTTP contract
 * (ingest -> decision -> delivery) exactly as botpress-agent/src/utils/http.ts
 * signs it, WITHOUT running Botpress. Lets us validate the Next.js backend
 * (src/proxy.ts + services) end to end from the CLI.
 *
 * Contract source of truth:
 *   - src/proxy.ts                          (the 5 header/signature checks)
 *   - botpress-agent/src/utils/http.ts      (how the bot signs requests)
 *   - botpress-agent/src/schemas/contracts.ts (canonical Zod shapes)
 *
 * Sandbox lock: every contact used here gets a synthetic +999... phone and a
 * row in `sandbox_identities` (same pattern as scripts/smoke-phase5-live.mjs).
 * All rows are deleted, in FK order, before the script exits — success or not.
 *
 * NEVER prints secret values — only "<name>=set/unset".
 */
import postgres from 'postgres';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

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

const REQUIRED_ENV = ['DATABASE_URL', 'ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_KEY_ID', 'STUDYX_SIGNING_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[env] missing: ${missing.map((k) => `${k}=unset`).join(' ')}`);
  process.exit(2);
}

// --- output capture (stdout + evidence file) --------------------------------
const LOG_LINES = [];
function log(line) {
  console.log(line);
  LOG_LINES.push(line);
}

log(`[env] ${REQUIRED_ENV.map((k) => `${k}=set`).join(' ')}`);

const BASE_URL = process.env.STUDYX_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const RUN_TAG = Math.floor(Date.now() / 1000).toString().slice(-6); // 6 digits, keeps re-runs from colliding
const sql = postgres(process.env.DATABASE_URL, { max: 5, prepare: false });

log(`[run-pilot] base_url=${BASE_URL} run_tag=${RUN_TAG}`);

// --- helpers ------------------------------------------------------------
const createdContactIds = new Set();

function synthPhone(salt) {
  // +999 prefix required by sandbox_identities_synthetic_phone_prefix_check.
  return `+999${RUN_TAG}${salt}`;
}

function hmacHex(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Signs and sends a request exactly like botpress-agent/src/utils/http.ts:
 *   canonical = [timestamp, method, pathname, body].join("\n")
 *   X-Signature: v1=<hmac-sha256-hex>
 *   X-Request-Id: `${traceId}:${idempotencyKey}`.slice(0, 512)
 *
 * opts.timestampOverride — send a different X-Request-Timestamp (stale-timestamp test)
 * opts.sentBodyOverride  — sign with `bodyObj`'s canonical JSON but transmit different
 *                          bytes on the wire (tampered-signature test)
 */
async function signedRequest(method, pathname, bodyObj, idempotencyKey, traceId, opts = {}) {
  const body = JSON.stringify(bodyObj);
  const timestamp = opts.timestampOverride ?? Date.now().toString();
  const canonical = [timestamp, method, pathname, body].join('\n');
  const signature = hmacHex(process.env.STUDYX_SIGNING_SECRET, canonical);
  const requestId = `${traceId}:${idempotencyKey}`.slice(0, 512);
  const sentBody = opts.sentBodyOverride ?? body;

  const res = await fetch(new URL(pathname, BASE_URL), {
    method,
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
    body: sentBody,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON or empty body — leave json null
  }
  return { status: res.status, json };
}

function makeEnvelope({ phone, integrationId = 'pilot-runner', externalMessageId, externalConversationId, externalUserId, text, traceId, replyTo = null, metadata = {} }) {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: integrationId,
    external_message_id: externalMessageId,
    external_conversation_id: externalConversationId,
    external_user_id: externalUserId,
    phone_e164: phone,
    trace_id: traceId,
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: replyTo,
      audio_reference: null,
      metadata,
    },
    sandbox_provider: 'telegram_sandbox',
  };
}

function ingestKeyFor(integrationId, externalMessageId) {
  return `inbound:botpress:${integrationId}:${externalMessageId}`;
}
function decisionKeyFor(turnId) {
  return `decision:${turnId}`;
}
function deliveryKeyFor(outboundId, botpressMessageId, status) {
  return `delivery:${outboundId}:${botpressMessageId ?? 'none'}:${status}`;
}

function decisionModel() {
  return { provider: 'botpress', model: 'pilot-runner', prompt_version: 'v1' };
}

async function ensureSandboxRow(contactId, externalUserId, phone) {
  if (createdContactIds.has(contactId)) return;
  createdContactIds.add(contactId);
  await sql`
    INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
    VALUES ('telegram_sandbox', ${externalUserId}, ${contactId}::uuid, ${phone})
    ON CONFLICT (contact_id) DO NOTHING
  `;
}

function pass(name, detail) {
  return { name, pass: true, detail };
}
function fail(name, detail) {
  return { name, pass: false, detail };
}

// --- scenarios ------------------------------------------------------------

async function scenario1(salt) {
  const name = 'Scenario 1: full text turn (ingest -> decision -> delivery), same trace_id end-to-end';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;
  const traceId = randomUUID();

  const envelope = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Quiero información sobre el curso de programación', traceId });
  const ingestRes = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', externalMessageId), traceId);
  if (ingestRes.status !== 200) return fail(name, `ingest status=${ingestRes.status} body=${JSON.stringify(ingestRes.json)}`);
  await ensureSandboxRow(ingestRes.json.contact.id, externalUserId, phone);
  if (ingestRes.json.trace_id !== traceId) return fail(name, 'ingest response trace_id does not match request trace_id');
  if (ingestRes.json.status !== 'accepted') return fail(name, `expected status=accepted got ${ingestRes.json.status}`);
  const turnId = ingestRes.json.turn_id;

  const decisionBody = {
    turn_id: turnId,
    trace_id: traceId,
    decision: {
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'Tenemos el curso disponible, ¿te interesa una demo?',
      response_type: 'commercial_reply',
      confidence: 0.92,
      reason_code: 'PILOT_RUNNER_SCENARIO_1',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
    model: decisionModel(),
  };
  const decisionRes = await signedRequest('POST', `/api/agent/turns/${turnId}/decision`, decisionBody, decisionKeyFor(turnId), traceId);
  if (decisionRes.status !== 200) return fail(name, `decision status=${decisionRes.status} body=${JSON.stringify(decisionRes.json)}`);
  if (decisionRes.json.status !== 'committed') return fail(name, `expected decision status=committed got ${decisionRes.json.status}`);
  if (decisionRes.json.trace_id !== traceId) return fail(name, 'decision response trace_id does not match request trace_id');
  const outboundId = decisionRes.json.outbound?.id;
  if (!outboundId) return fail(name, 'decision commit produced no outbound');

  const botpressMessageId = `sandbox-${randomUUID()}`;
  const deliveryBody = {
    outbound_id: outboundId,
    trace_id: traceId,
    status: 'submitted_to_botpress',
    botpress_message_id: botpressMessageId,
    replayed: false,
    error_code: null,
  };
  const deliveryRes = await signedRequest('POST', `/api/agent/outbounds/${outboundId}/delivery`, deliveryBody, deliveryKeyFor(outboundId, botpressMessageId, 'submitted_to_botpress'), traceId);
  if (deliveryRes.status !== 200) return fail(name, `delivery status=${deliveryRes.status} body=${JSON.stringify(deliveryRes.json)}`);
  if (deliveryRes.json.status !== 'recorded' || deliveryRes.json.outbound_id !== outboundId) {
    return fail(name, `unexpected delivery response ${JSON.stringify(deliveryRes.json)}`);
  }

  return pass(name, `trace_id=${traceId} turn_id=${turnId} outbound_id=${outboundId} delivery=recorded`);
}

async function scenario2(salt) {
  const name = 'Scenario 2: inbound idempotency — same event x10 -> exactly 1 inbound + 1 outbound';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;
  const ingestKey = ingestKeyFor('pilot-runner', externalMessageId);

  let turnId = null;
  let contactId = null;
  let conversationId = null;
  for (let i = 0; i < 10; i++) {
    const traceId = randomUUID();
    const envelope = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Necesito ayuda con mi inscripción al curso', traceId });
    const res = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKey, traceId);
    if (res.status !== 200) return fail(name, `ingest replay #${i} status=${res.status} body=${JSON.stringify(res.json)}`);
    if (i === 0) {
      if (res.json.status !== 'accepted') return fail(name, `first ingest expected status=accepted got ${res.json.status}`);
      turnId = res.json.turn_id;
      contactId = res.json.contact.id;
      conversationId = res.json.conversation_id;
      await ensureSandboxRow(contactId, externalUserId, phone);
    } else {
      if (res.json.status !== 'duplicate' || res.json.replayed !== true) {
        return fail(name, `ingest replay #${i} expected duplicate/replayed=true got ${JSON.stringify(res.json)}`);
      }
      if (res.json.turn_id !== turnId || res.json.conversation_id !== conversationId) {
        return fail(name, `ingest replay #${i} turn_id/conversation_id drift`);
      }
    }
  }

  const decisionKey = decisionKeyFor(turnId);
  const decisionCore = {
    schema_version: 2,
    intent: 'commercial',
    kind: 'reply',
    response: 'Con gusto te ayudamos con tu inscripción.',
    response_type: 'commercial_reply',
    confidence: 0.88,
    reason_code: 'PILOT_RUNNER_SCENARIO_2',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
  };
  let decisionId = null;
  let outboundId = null;
  for (let i = 0; i < 10; i++) {
    const traceId = randomUUID();
    const body = { turn_id: turnId, trace_id: traceId, decision: decisionCore, model: decisionModel() };
    const res = await signedRequest('POST', `/api/agent/turns/${turnId}/decision`, body, decisionKey, traceId);
    if (res.status !== 200) return fail(name, `decision replay #${i} status=${res.status} body=${JSON.stringify(res.json)}`);
    if (i === 0) {
      if (res.json.status !== 'committed') return fail(name, `first decision expected status=committed got ${res.json.status}`);
      decisionId = res.json.decision_id;
      outboundId = res.json.outbound?.id;
      if (!outboundId) return fail(name, 'first decision produced no outbound');
    } else {
      if (res.json.status !== 'duplicate' || res.json.replayed !== true) {
        return fail(name, `decision replay #${i} expected duplicate/replayed=true got ${JSON.stringify(res.json)}`);
      }
      if (res.json.decision_id !== decisionId || res.json.outbound?.id !== outboundId) {
        return fail(name, `decision replay #${i} decision_id/outbound_id drift`);
      }
    }
  }

  const counts = await sql`
    SELECT direction, count(*)::int AS n FROM messages WHERE contact_id = ${contactId}::uuid GROUP BY direction
  `;
  const inboundN = counts.find((r) => r.direction === 'inbound')?.n ?? 0;
  const outboundN = counts.find((r) => r.direction === 'outbound')?.n ?? 0;
  if (inboundN !== 1 || outboundN !== 1) {
    return fail(name, `DB row counts inbound=${inboundN} outbound=${outboundN}, expected 1/1 after 10x replay each`);
  }

  return pass(name, `turn_id=${turnId} outbound_id=${outboundId} — 10x ingest + 10x decision replay collapsed to inbound=1 outbound=1`);
}

async function scenario3(salt) {
  const name = 'Scenario 3: external_message_id collision, different content -> HTTP 409';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;
  const ingestKey = ingestKeyFor('pilot-runner', externalMessageId);

  const traceId1 = randomUUID();
  const env1 = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Quiero saber el precio del curso', traceId: traceId1 });
  const res1 = await signedRequest('POST', '/api/agent/ingest', env1, ingestKey, traceId1);
  if (res1.status !== 200) return fail(name, `first ingest status=${res1.status} body=${JSON.stringify(res1.json)}`);
  await ensureSandboxRow(res1.json.contact.id, externalUserId, phone);

  const traceId2 = randomUUID();
  const env2 = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Quiero saber el horario del curso (contenido distinto)', traceId: traceId2 });
  const res2 = await signedRequest('POST', '/api/agent/ingest', env2, ingestKey, traceId2);
  if (res2.status !== 409) return fail(name, `expected second ingest (same external_message_id, different content) status=409, got ${res2.status} body=${JSON.stringify(res2.json)}`);

  return pass(name, `first ingest=200, colliding external_message_id with different content=409 error=${res2.json?.error}`);
}

async function scenario4(salt) {
  const name = 'Scenario 4: burst — 5 rapid messages, same contact -> 5 turns, exactly 1 open conversation';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;

  const jobs = [];
  for (let i = 0; i < 5; i++) {
    const traceId = randomUUID();
    const externalMessageId = `msg-${RUN_TAG}-${salt}-${i}`;
    const envelope = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: `Mensaje rápido número ${i} sobre el curso`, traceId });
    jobs.push(signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', externalMessageId), traceId));
  }
  const responses = await Promise.all(jobs);
  const bad = responses.find((r) => r.status !== 200);
  if (bad) return fail(name, `one burst call failed: status=${bad.status} body=${JSON.stringify(bad.json)}`);

  const turnIds = new Set(responses.map((r) => r.json.turn_id));
  if (turnIds.size !== 5) return fail(name, `expected 5 distinct turn_ids, got ${turnIds.size}`);

  const contactId = responses[0].json.contact.id;
  await ensureSandboxRow(contactId, externalUserId, phone);

  const openConvs = await sql`
    SELECT count(*)::int AS n FROM conversations
    WHERE contact_id = ${contactId}::uuid AND channel = 'whatsapp' AND status = 'open'
  `;
  if (openConvs[0].n !== 1) return fail(name, `expected exactly 1 open conversation, got ${openConvs[0].n}`);

  return pass(name, `contact_id=${contactId} 5 distinct turn_ids, 1 open conversation`);
}

async function scenario5(salt) {
  const name = 'Scenario 5: contact blocked by SQL before ingest -> no outbound generated';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;

  // Step 1: create the contact (a contact row must exist before we can block it).
  const traceId0 = randomUUID();
  const bootstrapMsgId = `msg-${RUN_TAG}-${salt}-0`;
  const bootstrapEnvelope = makeEnvelope({ phone, externalMessageId: bootstrapMsgId, externalConversationId, externalUserId, text: 'Hola', traceId: traceId0 });
  const bootstrapRes = await signedRequest('POST', '/api/agent/ingest', bootstrapEnvelope, ingestKeyFor('pilot-runner', bootstrapMsgId), traceId0);
  if (bootstrapRes.status !== 200) return fail(name, `bootstrap ingest status=${bootstrapRes.status} body=${JSON.stringify(bootstrapRes.json)}`);
  const contactId = bootstrapRes.json.contact.id;
  await ensureSandboxRow(contactId, externalUserId, phone);

  // Step 2: block the contact directly via SQL, satisfying contacts_block_details_check.
  await sql`
    UPDATE contacts
    SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'pilot-runner-scenario-5'
    WHERE id = ${contactId}::uuid
  `;

  // Step 3: send the real test turn against the now-blocked contact.
  const traceId1 = randomUUID();
  const testMsgId = `msg-${RUN_TAG}-${salt}-1`;
  const envelope = makeEnvelope({ phone, externalMessageId: testMsgId, externalConversationId, externalUserId, text: 'Quiero comprar el curso', traceId: traceId1 });
  const ingestRes = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', testMsgId), traceId1);
  if (ingestRes.status !== 200) return fail(name, `ingest on blocked contact status=${ingestRes.status} body=${JSON.stringify(ingestRes.json)}`);
  if (ingestRes.json.status !== 'suppressed') return fail(name, `expected ingest status=suppressed got ${ingestRes.json.status}`);
  if (ingestRes.json.policy.may_respond !== false) return fail(name, `expected policy.may_respond=false, got ${ingestRes.json.policy.may_respond}`);
  if (ingestRes.json.policy.allowed_response_types.length !== 0) {
    return fail(name, `expected allowed_response_types=[] got ${JSON.stringify(ingestRes.json.policy.allowed_response_types)}`);
  }
  if (ingestRes.json.contact.blocked !== true) return fail(name, 'expected contact.blocked=true in ingest response');
  const turnId = ingestRes.json.turn_id;

  // Step 4: attempt a normal reply decision — must be rejected.
  const decisionBody = {
    turn_id: turnId,
    trace_id: traceId1,
    decision: {
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'Claro, te cuento sobre el curso.',
      response_type: 'commercial_reply',
      confidence: 0.8,
      reason_code: 'PILOT_RUNNER_SCENARIO_5',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
    model: decisionModel(),
  };
  const decisionRes = await signedRequest('POST', `/api/agent/turns/${turnId}/decision`, decisionBody, decisionKeyFor(turnId), traceId1);
  if (decisionRes.status !== 422) return fail(name, `expected decision status=422 got ${decisionRes.status} body=${JSON.stringify(decisionRes.json)}`);
  if (decisionRes.json?.error !== 'DECISION_REJECTED' || decisionRes.json?.reason !== 'CONTACT_BLOCKED') {
    return fail(name, `expected error=DECISION_REJECTED reason=CONTACT_BLOCKED, got ${JSON.stringify(decisionRes.json)}`);
  }

  // Step 5: confirm no outbound row exists for this contact.
  const outboundCount = await sql`
    SELECT count(*)::int AS n FROM messages WHERE contact_id = ${contactId}::uuid AND direction = 'outbound'
  `;
  if (outboundCount[0].n !== 0) return fail(name, `expected 0 outbound messages for blocked contact, got ${outboundCount[0].n}`);

  return pass(name, `contact_id=${contactId} blocked, decision rejected with CONTACT_BLOCKED, 0 outbound rows`);
}

async function scenario6(salt) {
  const name = 'Scenario 6: opt-out contact — decision endpoint only admits opt_out_ack';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;

  const traceId0 = randomUUID();
  const envelope = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Quiero darme de baja', traceId: traceId0 });
  const ingestRes = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', externalMessageId), traceId0);
  if (ingestRes.status !== 200) return fail(name, `ingest status=${ingestRes.status} body=${JSON.stringify(ingestRes.json)}`);
  const contactId = ingestRes.json.contact.id;
  await ensureSandboxRow(contactId, externalUserId, phone);
  if (JSON.stringify(ingestRes.json.policy.allowed_response_types) !== JSON.stringify(['opt_out_ack'])) {
    return fail(name, `expected allowed_response_types=[opt_out_ack] got ${JSON.stringify(ingestRes.json.policy.allowed_response_types)}`);
  }
  const turnId = ingestRes.json.turn_id;

  // Attempt a non-opt_out_ack decision — must be rejected.
  const traceId1 = randomUUID();
  const wrongDecision = {
    turn_id: turnId,
    trace_id: traceId1,
    decision: {
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'Seguimos con el curso entonces.',
      response_type: 'commercial_reply',
      confidence: 0.5,
      reason_code: 'PILOT_RUNNER_SCENARIO_6_WRONG',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
    model: decisionModel(),
  };
  const wrongRes = await signedRequest('POST', `/api/agent/turns/${turnId}/decision`, wrongDecision, decisionKeyFor(turnId), traceId1);
  if (wrongRes.status !== 422) return fail(name, `expected non-opt_out_ack decision to be rejected with 422, got ${wrongRes.status} body=${JSON.stringify(wrongRes.json)}`);
  if (wrongRes.json?.error !== 'DECISION_REJECTED' || wrongRes.json?.reason !== 'CONSENT_REVOKED') {
    return fail(name, `expected error=DECISION_REJECTED reason=CONSENT_REVOKED, got ${JSON.stringify(wrongRes.json)}`);
  }

  // Correct opt_out_ack decision — must succeed.
  const traceId2 = randomUUID();
  const correctDecision = {
    turn_id: turnId,
    trace_id: traceId2,
    decision: {
      schema_version: 2,
      intent: 'opt_out',
      kind: 'reply',
      response: 'Listo, no vas a recibir más mensajes nuestros.',
      response_type: 'opt_out_ack',
      confidence: 0.99,
      reason_code: 'PILOT_RUNNER_SCENARIO_6_CORRECT',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
    model: decisionModel(),
  };
  const correctRes = await signedRequest('POST', `/api/agent/turns/${turnId}/decision`, correctDecision, decisionKeyFor(turnId), traceId2);
  if (correctRes.status !== 200 || correctRes.json.status !== 'committed') {
    return fail(name, `expected opt_out_ack decision to commit, got status=${correctRes.status} body=${JSON.stringify(correctRes.json)}`);
  }
  if (!correctRes.json.outbound?.id) return fail(name, 'opt_out_ack decision produced no outbound');

  return pass(name, `contact_id=${contactId} turn_id=${turnId} non-ack rejected (CONSENT_REVOKED), opt_out_ack committed`);
}

async function scenario7(salt) {
  const name = 'Scenario 7: 1 byte tampered in body after signing -> 401 INVALID_SIGNATURE';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;
  const traceId = randomUUID();

  const envelope = makeEnvelope({
    phone,
    externalMessageId,
    externalConversationId,
    externalUserId,
    text: 'Mensaje de prueba de firma',
    traceId,
    metadata: { tamper_nonce: 'A' },
  });
  const body = JSON.stringify(envelope);
  if (!body.includes('"tamper_nonce":"A"')) return fail(name, 'internal error: tamper marker not found in serialized body');
  const tamperedBody = body.replace('"tamper_nonce":"A"', '"tamper_nonce":"B"'); // exactly 1 byte different

  const res = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', externalMessageId), traceId, {
    sentBodyOverride: tamperedBody,
  });
  if (res.status !== 401) return fail(name, `expected status=401 got ${res.status} body=${JSON.stringify(res.json)}`);
  if (res.json?.error !== 'INVALID_SIGNATURE') return fail(name, `expected error=INVALID_SIGNATURE got ${JSON.stringify(res.json)}`);

  return pass(name, 'tampered body correctly rejected with 401 INVALID_SIGNATURE');
}

async function scenario8(salt) {
  const name = 'Scenario 8: timestamp -6min -> 401 STALE_REQUEST';
  const phone = synthPhone(salt);
  const externalUserId = `ext-${RUN_TAG}-${salt}`;
  const externalConversationId = `conv-${RUN_TAG}-${salt}`;
  const externalMessageId = `msg-${RUN_TAG}-${salt}-1`;
  const traceId = randomUUID();

  const envelope = makeEnvelope({ phone, externalMessageId, externalConversationId, externalUserId, text: 'Mensaje de prueba de timestamp viejo', traceId });
  const staleTimestamp = (Date.now() - 6 * 60 * 1000).toString();
  const res = await signedRequest('POST', '/api/agent/ingest', envelope, ingestKeyFor('pilot-runner', externalMessageId), traceId, {
    timestampOverride: staleTimestamp,
  });
  if (res.status !== 401) return fail(name, `expected status=401 got ${res.status} body=${JSON.stringify(res.json)}`);
  if (res.json?.error !== 'STALE_REQUEST') return fail(name, `expected error=STALE_REQUEST got ${JSON.stringify(res.json)}`);

  return pass(name, 'timestamp -6min correctly rejected with 401 STALE_REQUEST');
}

// --- cleanup ------------------------------------------------------------

async function cleanup() {
  const ids = Array.from(createdContactIds);
  if (ids.length === 0) {
    log('[cleanup] no sandbox contacts were created, nothing to remove');
    return;
  }
  await sql`DELETE FROM delivery_reports WHERE outbound_message_id IN (SELECT id FROM messages WHERE contact_id = ANY(${ids}::uuid[]))`;
  await sql`DELETE FROM outbox_events WHERE delivery_id IN (SELECT id FROM outbound_deliveries WHERE contact_id = ANY(${ids}::uuid[]))`;
  await sql`DELETE FROM outbound_deliveries WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM agent_decisions WHERE turn_id IN (SELECT id FROM messages WHERE contact_id = ANY(${ids}::uuid[]))`;
  await sql`DELETE FROM message_embeddings WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM messages WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM contact_channel_permissions WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM consent_events WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM conversations WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM audit_log WHERE source_event_id IN (SELECT id FROM channel_events WHERE contact_id = ANY(${ids}::uuid[]))`;
  await sql`DELETE FROM channel_events WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM channel_threads WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM sandbox_identities WHERE contact_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM contacts WHERE id = ANY(${ids}::uuid[])`;
  log(`[cleanup] removed ${ids.length} sandbox contact(s) and all dependent rows`);
}

// --- main ------------------------------------------------------------

const SCENARIOS = [
  { id: 1, fn: scenario1 },
  { id: 2, fn: scenario2 },
  { id: 3, fn: scenario3 },
  { id: 4, fn: scenario4 },
  { id: 5, fn: scenario5 },
  { id: 6, fn: scenario6 },
  { id: 7, fn: scenario7 },
  { id: 8, fn: scenario8 },
];

async function main() {
  const outcomes = [];
  for (const s of SCENARIOS) {
    let outcome = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const salt = `${s.id}${attempt}`;
      try {
        outcome = await s.fn(salt);
      } catch (e) {
        outcome = fail(`Scenario ${s.id}`, `threw: ${String((e && e.stack) || e)}`);
      }
      if (outcome.pass) break;
      log(`[retry] ${outcome.name} attempt ${attempt}/3 failed: ${outcome.detail}`);
    }
    outcomes.push(outcome);
    log(`[${outcome.pass ? 'PASS' : 'FAIL'}] ${outcome.name} — ${outcome.detail}`);
  }

  const passCount = outcomes.filter((o) => o.pass).length;
  const failCount = outcomes.length - passCount;
  log(`[run-pilot] ${passCount}/${outcomes.length} scenarios passed`);

  await cleanup();
  await sql.end({ timeout: 5 });

  const evidenceDir = resolve(ROOT, 'docs/evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = resolve(evidenceDir, 'pilot-local-2026-08-10.txt');
  writeFileSync(evidencePath, LOG_LINES.join('\n') + '\n', 'utf-8');
  log(`[run-pilot] evidence written to ${evidencePath}`);

  if (failCount > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(String((e && e.stack) || e));
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`[cleanup] failed: ${String((cleanupError && cleanupError.stack) || cleanupError)}`);
  }
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // ignore
  }
  process.exit(1);
});
