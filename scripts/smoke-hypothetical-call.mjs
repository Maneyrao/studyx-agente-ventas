#!/usr/bin/env node
/**
 * Smoke de llamada hipotética — caso 10 del contrato
 * (docs/contracts/agent-a-operational-mvp.md §10): A propone/solicita una
 * llamada, un fake provider acepta, un evento `analyzed` simulado vuelve al
 * pipeline y el post-call followup corre.
 *
 * ZERO Retell: este archivo no importa nada de Retell y no necesita sus
 * credenciales. Retell y Agent B "no existen en esta fase" (contrato §0), así
 * que el dispatch real a Telegram Agent B (que requeriría un bot token real)
 * también se evita: en su lugar se usa exactamente el mismo patrón que
 * tests/integration/agent-a-call-handoff.test.ts usa para el camino
 * fake/sandbox — un `TelegramSimVoiceProvider` con un cliente Telegram FALSO
 * inyectado (una función in-memory, cero red) más `sandbox_identities`
 * (convención de scripts/seed-sandbox-tester.mjs). Es el "existing
 * fake/sandbox voice path" al que se refiere el brief de la tarea.
 *
 * A diferencia de scripts/smoke-agent-a-operational.mjs (puramente HTTP),
 * este script SÍ importa funciones internas del backend — es la única forma
 * de inyectar el cliente Telegram falso sin tocar la red ni credenciales
 * reales. Sólo el paso final (post-call followup) se ejercita por HTTP
 * público, protegido por CRON_SECRET, tal como corre en producción.
 *
 * Requiere:
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test
 *   CRON_SECRET=...
 *   SMOKE_BASE_URL=http://127.0.0.1:3000 (servidor Next corriendo, para el
 *     paso de post-call-followup vía HTTP)
 *
 * Uso: node scripts/smoke-hypothetical-call.mjs
 * (se re-ejecuta a sí mismo bajo tsx automáticamente para poder importar TS)
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const THIS_FILE = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Bootstrap: this file must be able to `import` TypeScript modules under
// `src/features/calls/**` (the fake/sandbox voice path lives there). Plain
// Node cannot load .ts files, so on first run we re-exec ourselves through
// the already-installed `tsx` binary (devDependency, no install needed).
// ---------------------------------------------------------------------------
if (!process.env.__SMOKE_HYPOTHETICAL_CALL_TSX__) {
  const tsx = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
  const result = spawnSync(tsx, [THIS_FILE, ...process.argv.slice(2)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, __SMOKE_HYPOTHETICAL_CALL_TSX__: '1' },
  });
  process.exit(result.status ?? 1);
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

const TEST_DATABASE_URL = requireEnv('TEST_DATABASE_URL');
assertLocalTestDatabaseUrl(TEST_DATABASE_URL);
const CRON_SECRET = requireEnv('CRON_SECRET');
const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

// This backend module reads DATABASE_URL from process.env at import time
// (src/lib/db/orchestrator.ts) — never DATABASE_URL from .env.local, only the
// validated local TEST_DATABASE_URL, exactly like scripts/run-sheet-projections.ts.
process.env.DATABASE_URL = TEST_DATABASE_URL;

const { randomUUID, randomBytes } = await import('node:crypto');

const { processInboundMessage } = await import('@/lib/services/ingestion.service');
const { commitAgentDecision, DecisionPolicyError } = await import('@/lib/services/decision.service');
const { dispatchCall } = await import('@/features/calls/application/dispatch-call');
const { PostgresCallStore } = await import('@/features/calls/adapters/postgres-call-store');
const { PostgresContextReceiptStore } = await import('@/features/calls/adapters/postgres-context-receipt-store');
const { TelegramSimVoiceProvider } = await import('@/features/calls/adapters/telegram-sim-voice.provider');
const { recordCallEvent } = await import('@/features/calls/application/record-call-event');
const { sql } = await import('@/lib/db/orchestrator');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function newPhone() {
  // +999 prefix: the sandbox_identities CHECK constraint
  // (sandbox_identities_synthetic_phone_prefix_check) requires it — same
  // convention as scripts/seed-sandbox-tester.mjs and the E2E fixture in
  // tests/integration/agent-a-call-handoff.test.ts.
  const digits = String(Math.floor(10_000_000 + Math.random() * 89_999_999)).padStart(10, '0');
  return `+999${digits}`;
}

function envelope(identity, text) {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'smoke-hypothetical-call',
    external_message_id: `message-${randomUUID()}`,
    external_conversation_id: identity.conversation,
    external_user_id: identity.user,
    phone_e164: identity.phone,
    trace_id: randomUUID(),
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

async function seedTurn(identity, text) {
  const context = await processInboundMessage(envelope(identity, text));
  return context.turn_id;
}

function commit(turnId, decision) {
  return commitAgentDecision({
    turn_id: turnId,
    trace_id: randomUUID(),
    decision,
    model: { provider: 'botpress', model: 'smoke-synthetic-model', prompt_version: 'agent-a-smoke-hypothetical-call-v1' },
  });
}

function callOfferDecision() {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: '¿Querés que te llamemos a este número para contarte de Python?',
    response_type: 'call_offer',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: 'CALL_OFFER_PROPOSED',
    confidence: 0.9,
    retrieval_used: null,
  };
}

function callConfirmationDecision(reason) {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
    response_type: 'call_confirmation',
    business_action: { type: 'request_call_now', reason, course_of_interest: 'Python' },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    reason_code: 'CALL_CONSENT_ACCEPTED',
    confidence: 1,
    retrieval_used: null,
  };
}

async function main() {
  const report = { checks: [], pass: true };
  function check(name, ok, detail) {
    report.checks.push({ name, ok, detail });
    if (!ok) report.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
  }

  const identity = { phone: newPhone(), conversation: `conversation-${randomUUID()}`, user: `user-${randomUUID()}` };

  // --- A proposes a call (call_offer), customer accepts ---------------------
  const offerTurn = await seedTurn(identity, 'Quiero saber precios de Python');
  const offered = await commit(offerTurn, callOfferDecision());
  check('A propone la llamada (call_offer committed)', offered.status === 'committed' && offered.call_request === null, { status: offered.status });

  const acceptTurn = await seedTurn(identity, 'sí');
  const accepted = await commit(acceptTurn, callConfirmationDecision('accepted_offer'));
  const callId = accepted.call_request?.call_id ?? null;
  check('A reserva la llamada tras aceptación (call_request presente)', accepted.status === 'committed' && !!callId, { call_id: callId });
  if (!callId) {
    console.error('BLOCKED: no call_id reserved, cannot continue smoke.');
    await sql.end();
    process.exit(1);
  }

  const requestedEvents = await sql`SELECT event_type, provider FROM call_events WHERE call_id = ${callId}::uuid ORDER BY sequence`;
  check('call_events tiene exactamente un evento "requested" (provider telegram_sandbox)', requestedEvents.length === 1 && requestedEvents[0].event_type === 'requested' && requestedEvents[0].provider === 'telegram_sandbox', requestedEvents);

  // --- Fake provider accepts (sandbox path — zero real Telegram/Retell calls) ---
  const contactRows = await sql`SELECT contact_id FROM messages WHERE id = ${offerTurn}::uuid`;
  const contactId = contactRows[0].contact_id;
  const chatId = `chat-${randomUUID()}`;
  const userId = `user-${randomUUID()}`;
  await sql`
    INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
    VALUES ('telegram_sandbox', ${userId}, ${contactId}::uuid, ${identity.phone})
    ON CONFLICT DO NOTHING
  `;

  const receipts = new PostgresContextReceiptStore(sql, { expectedChatId: chatId, expectedUserId: userId });
  await receipts.registerBinding({ chatId, userId, startedAt: new Date().toISOString() });

  let fakeSendMessageCalls = 0;
  const fakeTelegram = {
    async sendMessage(input) {
      fakeSendMessageCalls += 1;
      void input;
      // No network call of any kind — this IS the fake/sandbox provider.
      return { messageId: `sim-${randomUUID().slice(0, 8)}`, acceptedAt: new Date().toISOString() };
    },
    async answerCallbackQuery() {
      return undefined;
    },
  };
  const provider = new TelegramSimVoiceProvider({
    receipts,
    destinationResolver: receipts,
    telegram: fakeTelegram,
    nonce: () => randomBytes(16).toString('base64url'),
  });
  const store = new PostgresCallStore(sql);

  const dispatch = await dispatchCall({ callId, workerId: `smoke-hypothetical-call:${randomUUID()}` }, { store, provider });
  check('Fake provider acepta la llamada (dispatch → provider_accepted)', dispatch.status === 'provider_accepted', dispatch);
  check('El fake Telegram fue invocado exactamente una vez (cero red real)', fakeSendMessageCalls === 1, { fakeSendMessageCalls });

  // --- Simulated call lifecycle → terminal state -----------------------------
  let seq = 1;
  await recordCallEvent(
    {
      schema_version: 1,
      event_id: `smoke-started-${callId}`,
      call_id: callId,
      event_type: 'started',
      sequence: seq++,
      occurred_at: new Date().toISOString(),
      provider: 'telegram_sandbox',
      payload: { event_type: 'started', started_at: new Date().toISOString() },
    },
    { store }
  );
  await recordCallEvent(
    {
      schema_version: 1,
      event_id: `smoke-ended-${callId}`,
      call_id: callId,
      event_type: 'ended',
      sequence: seq++,
      occurred_at: new Date().toISOString(),
      provider: 'telegram_sandbox',
      payload: { event_type: 'ended', ended_at: new Date().toISOString(), duration_seconds: 180, disconnection_reason: 'user_hangup' },
    },
    { store }
  );
  // The `analyzed` event re-entering the pipeline — the whole point of case 10.
  const projection = await recordCallEvent(
    {
      schema_version: 1,
      event_id: `smoke-analyzed-${callId}`,
      call_id: callId,
      event_type: 'analyzed',
      sequence: seq++,
      occurred_at: new Date().toISOString(),
      provider: 'telegram_sandbox',
      payload: {
        event_type: 'analyzed',
        analysis: { result: 'seguimiento_agendado', nivel_interes: 'alto', objecion: null, notas: 'smoke-hypothetical-call' },
      },
    },
    { store }
  );
  check(
    'Progresión call_events: requested → started → ended → analyzed, proyección completed/completed/seguimiento_agendado',
    projection.projection.status === 'completed' && projection.projection.analysisStatus === 'completed' && projection.projection.result === 'seguimiento_agendado',
    projection.projection
  );

  const allEvents = await sql`SELECT event_type FROM call_events WHERE call_id = ${callId}::uuid ORDER BY sequence`;
  check(
    'call_events guarda las cuatro etapas en orden, todas provider=telegram_sandbox (cero Retell)',
    allEvents.map((e) => e.event_type).join(',') === 'requested,started,ended,analyzed',
    allEvents
  );

  // --- Post-call followup: the cron only considers a call terminal-and-stale
  // --- after DEFAULT_GRACE_SECONDS (120s, post-call-followup.ts) since its
  // --- last update. call_sessions_enforce_transition force-sets
  // --- NEW.updated_at := now() on every UPDATE (call_ledger.sql), so
  // --- backdating that column directly is not possible — the only honest way
  // --- to cross the grace window is to actually wait for it, then run the
  // --- SAME public HTTP endpoint production cron hits.
  console.log('Esperando la ventana de gracia del post-call followup (~130s)...');
  await sleep(130_000);

  const followupRes = await fetch(`${BASE_URL}/api/cron/post-call-followup`, {
    headers: { authorization: `Bearer ${CRON_SECRET}`, 'x-trace-id': randomUUID() },
  });
  const followupJson = await followupRes.json().catch(() => null);
  const finding = followupJson?.findings?.find((f) => f.call_id === callId);
  check(
    'Post-call followup (HTTP público, mismo endpoint que cron) procesó la llamada y envió el cierre',
    followupRes.ok && !!finding && finding.action === 'send' && finding.reason.startsWith('FOLLOWUP_SCHEDULED'),
    { status: followupRes.status, finding, totals: followupJson ? { sent: followupJson.sent, examined: followupJson.examined } : null }
  );

  const systemTurn = await sql`
    SELECT ad.response, ad.response_type FROM channel_events ce
    JOIN messages m ON m.source_event_id = ce.id
    JOIN agent_decisions ad ON ad.turn_id = m.id
    WHERE ce.event_kind = 'system_call_result' AND ce.external_event_id = ${'system:call_result:' + callId}
  `;
  check(
    'Se sintetizó un turno de sistema con una decisión de cierre (commercial_reply)',
    systemTurn.length === 1 && systemTurn[0].response_type === 'commercial_reply',
    systemTurn[0] ?? null
  );

  // --- Nothing real fires: self-audit -----------------------------------------
  // The header comment explicitly documents (in prose) why Retell is out of
  // scope, so a blanket text scan for "retell" would false-positive on the
  // file's own explanation. What actually matters is that no `import`
  // statement references it and every provider value used at runtime is
  // 'telegram_sandbox' — never 'retell'.
  const { readFileSync } = await import('node:fs');
  const selfSource = readFileSync(THIS_FILE, 'utf8');
  const importLines = selfSource.split('\n').filter((line) => /^\s*(import|const .*=\s*await import)/.test(line));
  const noRetellImports = importLines.every((line) => !/retell/i.test(line));
  const allEventsAreSandbox = allEvents.length > 0 && requestedEvents.every((e) => e.provider === 'telegram_sandbox');
  check('Este archivo no importa Retell y todos los eventos usan provider=telegram_sandbox', noRetellImports && allEventsAreSandbox, { importLines: importLines.length, noRetellImports });

  console.log('\n=== Caso 10 — Llamada hipotética (fake provider, sin Retell) ===\n');
  console.log(`call_id: ${callId}`);
  console.log(`checks: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} passed`);

  await sql.end();
  process.exit(report.pass ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL', err);
  try {
    await sql.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
