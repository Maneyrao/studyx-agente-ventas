import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { StoredContactProfileV1 } from '../../src/lib/repositories/contact-profile.repository';
import { runWorkflowBurstV1, runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets, Workflow } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';
import { contactFixtureUpdatesV1 } from './contact-profile-fixture';

// Real production workflow, signed HTTP, PostgreSQL and delivery authorization.
// Only external model generation and the final delivery client are controlled.
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
const databaseUrl = process.env.TEST_DATABASE_URL!;
const db = openLocalTestDatabase();
const previousKey = secrets.DEEPSEEK_API_KEY;
const contexts: AgentAContextV1[] = [];
let respond: (context: AgentAContextV1) => AgentATurnProposalV1;

function proposal(message: string, extra: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [message] }, proposed_action: { type: 'none' },
    profile_updates: [], profile_requests: [], used_fact_ids: [],
    used_memory_ids: [], memory_candidates: [], repair_of: null, ...extra,
  };
}

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.protocol).toBe('http:');
  expect(backend.port).toMatch(/^32\d\d$/u);
  const localFetch = globalThis.fetch;
  expect((await localFetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'offline-commercial-truth-repair-fixture';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return localFetch(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_COMMERCIAL_TRUTH_REQUEST');
    const instructions = JSON.parse(String(init?.body)).instructions as string;
    const serialized = instructions.match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    const context = JSON.parse(serialized) as AgentAContextV1;
    contexts.push(context);
    const generated = respond(context);
    const result = { ...generated, repair_of: context.turn_rejection
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
  await db.end();
});

it('repairs a fabricated installment count without losing fragmented identity, then delivers the canonical payment link once', async () => {
  const id = {
    conversationId: `truth-repair-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${randomUUID().replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`,
    providerMode: 'fixture' as const,
  };
  respond = () => proposal('Te puedo orientar sobre Inglés 1.', {
    move: { schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [], confidence: 1, course_reference: 'ingles_1' },
    used_fact_ids: ['offering:ingles_1:name:v1'],
  });
  const selected = await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1.' });
  expect(selected.errorCode).toBeNull();
  expect(selected.commitSucceeded).toBe(true);

  const falseClaim = 'Podés pagar en 2 cuotas de USD 60.';
  // Real production regression: the denial itself was mistaken for an offer,
  // so even this correct A-authored repair used to end in a silent completed turn.
  const repairedAnswer = 'No tengo un plan de dos pagos: los disponibles son 12 pagos de USD 30, 6 pagos de USD 60 o un pago único de USD 360.';
  const beforeRepair = contexts.length;
  respond = context => {
    expect(context.commercial_state.selected_offering_code).toBe('ingles_1');
    if (context.turn_rejection) {
      expect(context.turn_rejection.rejections).toEqual([
        { code: 'FACT_VALUE_MISMATCH', subject: 'payment_plan_not_canonical' },
      ]);
      expect(context.customer.contact_intake).toMatchObject({
        nombre: 'Luz María', apellido: 'van der Velde',
        correo: 'luz.repair@example.test', telefono: '+15551234029',
      });
      expect(context.capabilities.intake_missing).toEqual([]);
      return proposal(repairedAnswer, {
        used_fact_ids: ['offering:ingles_1:name:v1',
          'payment:ingles_1:monthly_12:label:v1', 'payment:ingles_1:monthly_6:label:v1',
          'payment:ingles_1:one_time:label:v1'],
      });
    }
    // USD 60 is canonical; only the invented count can reject this answer.
    return proposal(falseClaim, {
      profile_updates: contactFixtureUpdatesV1(context, [
        { field: 'nombre', value: 'Luz María' }, { field: 'apellido', value: 'van der Velde' },
        { field: 'correo', value: 'luz.repair@example.test', quote: 'LUZ.REPAIR@example.test' },
        { field: 'telefono', value: '+15551234029' },
      ]),
      used_fact_ids: ['payment:ingles_1:monthly_6:label:v1'],
    });
  };
  const repaired = await runWorkflowBurstV1({ ...id, messages: [
    { text: '¿Puedo pagarlo en 2 cuotas?', delayMs: 0 },
    { text: 'Mi nombre es Luz María', delayMs: 200 },
    { text: 'Mi apellido es van der Velde', delayMs: 400 },
    { text: 'Mi correo es LUZ.REPAIR@example.test', delayMs: 600 },
    { text: 'Mi teléfono es +15551234029', delayMs: 800 },
  ] });
  expect(repaired.errorCode, JSON.stringify(repaired.httpExchanges.filter(exchange => exchange.status !== 200))).toBeNull();
  expect(repaired.commitSucceeded).toBe(true);
  expect(repaired.legacyPlanRequests).toBe(0);
  expect(repaired.burst.claimed_message_count).toBe(5);
  expect(repaired.httpExchanges.filter(exchange => exchange.boundary === 'deepseek')).toHaveLength(2);
  expect(contexts.slice(beforeRepair)).toHaveLength(2);
  const rejectedCommits = repaired.httpExchanges.filter(exchange => exchange.status === 422 && exchange.url.endsWith('/decision'));
  expect(rejectedCommits).toHaveLength(1);
  expect(rejectedCommits[0]!.responseBody).toMatchObject({
    reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION', subjects: ['payment_plan_not_canonical'],
  });
  expect(repaired.authorizedMessages).toEqual([repairedAnswer]);
  expect(repaired.authorizedMessages).not.toContain(falseClaim);
  expect(repaired.httpExchanges.filter(exchange => exchange.url.endsWith('/profile'))).toHaveLength(1);
  const [contact] = await db<Array<{ id: string; name: string; email: string; declared_phone: string; contact_profile_v1: StoredContactProfileV1 }>>`
    SELECT id, name, email, declared_phone, contact_profile_v1 FROM contacts WHERE phone = ${id.phoneE164}
  `;
  expect(contact).toMatchObject({ name: 'Luz María van der Velde', email: 'luz.repair@example.test', declared_phone: '+15551234029' });
  for (const [field, value] of Object.entries({ nombre: 'Luz María', apellido: 'van der Velde',
    correo: 'luz.repair@example.test', telefono: '+15551234029' })) {
    expect(contact!.contact_profile_v1.fields[field as keyof StoredContactProfileV1['fields']])
      .toMatchObject({ value, status: 'confirmed', source: 'agent_a_v1' });
  }
  expect(new Set(Object.values(contact!.contact_profile_v1.fields).map(field => field.source_message_id)).size).toBe(4);
  const payments = () => db`SELECT id, plan_code FROM payments WHERE contact_id = ${contact!.id}::uuid`;
  const calls = () => db`SELECT id FROM call_sessions WHERE contact_id = ${contact!.id}::uuid`;
  expect(await payments()).toHaveLength(0);
  expect(await calls()).toHaveLength(0);
  const repairedDb = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
    adapterCaptures: [...selected.adapterCaptures, ...repaired.adapterCaptures] });
  expect(repairedDb.outbound.map(message => message.content)).not.toContain(falseClaim);
  expect(repairedDb.decisions.filter(decision => decision.turnId === repaired.turnId)).toMatchObject([{ businessActionType: null }]);
  expect(repairedDb.recordedLinks).toEqual([]);

  respond = context => {
    expect(context.turn_rejection).toBeUndefined();
    expect(context.customer.contact_intake).toMatchObject({ nombre: 'Luz María', apellido: 'van der Velde', correo: 'luz.repair@example.test', telefono: '+15551234029' });
    const confirmed = context.commercial_state.awaiting_reply === 'payment_confirmation';
    return proposal(confirmed ? 'Te comparto el enlace para pagar en 12 cuotas.'
      : '¿Confirmas tus datos y las 12 cuotas de USD 30 para que te envíe el enlace?', {
      move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: ['request_payment_link'], vetoes: [], confidence: 1, payment_plan: 'monthly_12' },
      proposed_action: confirmed
        ? { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'monthly_12' }
        : { type: 'none' },
      used_fact_ids: ['payment:ingles_1:monthly_12:label:v1'],
    });
  };
  const awaiting = await runWorkflowTurnV1({ ...id, text: 'Quiero pagar en 12 cuotas de USD 30; envíame el enlace de pago.' });
  expect(awaiting.errorCode).toBeNull();
  expect(await payments()).toHaveLength(0);
  const paymentText = 'Sí, confirmo mis datos y las 12 cuotas de USD 30; envíame el enlace de pago.';
  const paid = await runWorkflowTurnV1({ ...id, text: paymentText });
  expect(paid.errorCode, JSON.stringify(paid.httpExchanges.filter(exchange => exchange.status !== 200))).toBeNull();
  expect(paid.commitSucceeded).toBe(true);
  expect(paid.httpExchanges.filter(exchange => exchange.boundary === 'deepseek')).toHaveLength(1);
  expect(await payments()).toMatchObject([{ plan_code: 'monthly_12' }]);
  expect(await calls()).toHaveLength(0);
  const paidDb = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
    adapterCaptures: [...selected.adapterCaptures, ...repaired.adapterCaptures, ...awaiting.adapterCaptures, ...paid.adapterCaptures] });
  expect(paidDb.recordedLinks).toHaveLength(1);
  expect(paidDb.recordedLinks[0]).toMatch(/^https:\/\/buy\.stripe\.com\/local-eval-12m\?client_reference_id=/u);
  expect(paidDb.deliveredLinks).toEqual(paidDb.recordedLinks);
  expect(paid.authorizedMessages.join('\n').split(paidDb.recordedLinks[0]!).length - 1).toBe(1);
  expect(paidDb.decisions.filter(decision => decision.businessActionType === 'send_payment_link')).toHaveLength(1);
  const replay = await runWorkflowTurnV1({ ...id, text: paymentText,
    externalMessageId: paid.externalMessageId, occurredAt: paid.occurredAt });
  expect(replay.authorizedMessages).toEqual([]);
  expect(replay.httpExchanges.filter(exchange => exchange.boundary === 'deepseek')).toEqual([]);
  expect(await payments()).toHaveLength(1);
  expect(await calls()).toHaveLength(0);
  const replayDb = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(replayDb.outboundCount).toBe(paidDb.outboundCount);
  expect(replayDb.recordedLinks).toEqual(paidDb.recordedLinks);
});

it('replays the English enumeration and unselected plan request without losing either reply', async () => {
  const id = { conversationId: `integrity-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  const enumeration = 'Tenemos Inglés 1, Inglés 2 e Inglés 3, todos online y de 12 clases, salvo Inglés 3 que son 21.';
  respond = () => proposal(enumeration, {
    move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
    used_fact_ids: ['offering:ingles_1:name:v1', 'offering:ingles_2:name:v1', 'offering:ingles_3:name:v1'],
  });
  const courses = await runWorkflowTurnV1({ ...id, text: 'Quiero información de inglés' });
  expect(courses.errorCode).toBeNull();
  expect(courses.authorizedMessages).toEqual([enumeration]);
  const plans = 'Tenemos 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago de USD 360.';
  respond = context => {
    expect(context.commercial_state.selected_offering_code).toBeNull();
    expect(context.capabilities.may_send_payment_link).toBe(false);
    return proposal(plans, { used_fact_ids: context.catalog.payment_plans.map(plan => plan.fact_id) });
  };
  const answer = await runWorkflowTurnV1({ ...id, text: 'Quiero ver los planes directamente, ¿cómo son?' });
  expect(answer.errorCode).toBeNull();
  expect(answer.authorizedMessages).toEqual([plans]);
  const persisted = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(persisted.state?.selectedOfferingCode).toBeNull();
  expect(persisted.recordedLinks).toEqual([]);
});

it('recovers a twice-rejected proposal with a fresh claim, one answer and no duplicate effects', async () => {
  const id = { conversationId: `durable-repair-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${randomUUID().replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`, providerMode: 'fixture' as const };
  const child = vi.spyOn(Workflow.prototype, 'getOrCreate');
  respond = () => proposal('Podés pagar en 2 cuotas de USD 60.', {
    used_fact_ids: ['payment-workspace:monthly_6:label:v1'],
  });
  const first = await runWorkflowTurnV1({ ...id, text: '¿Cuáles son los planes de pago?' });
  expect(first.authorizedMessages).toEqual([]);
  expect(first.commitSucceeded).toBe(false);
  expect(first.errorCode).toBe('AGENT_A_CONTINUATION_REJECTED');
  expect(first.httpExchanges.filter(exchange => exchange.status === 422 && exchange.url.endsWith('/decision'))).toHaveLength(2);
  expect(child).toHaveBeenCalledWith(expect.objectContaining({
    key: expect.stringMatching(/^recovery:/u), input: expect.objectContaining({
      external_message_id: first.externalMessageId, preingested: null,
    }),
  }));
  const answer = 'Los planes son 12 pagos de USD 30, 6 pagos de USD 60 o un pago de USD 360.';
  respond = () => proposal(answer, { used_fact_ids: ['payment-workspace:monthly_12:label:v1',
    'payment-workspace:monthly_6:label:v1', 'payment-workspace:one_time:label:v1'] });
  // Execute the envelope handed to the next workflow against the real backend.
  // Cloud scheduling itself remains a separate deployment canary.
  const resumed = await runWorkflowTurnV1({ ...id, text: '¿Cuáles son los planes de pago?',
    externalMessageId: first.externalMessageId, occurredAt: first.occurredAt });
  expect(resumed.errorCode, JSON.stringify(resumed.httpExchanges.filter(exchange => (exchange.status ?? 0) >= 400))).toBeNull();
  expect(resumed.turnId).toBe(first.turnId);
  expect(resumed.authorizedMessages).toEqual([answer]);
  expect(resumed.commitSucceeded).toBe(true);
  const rows = await db`SELECT b.state, b.claim_attempt_count, r.outcome, r.resolved_at
    FROM inbound_batches b JOIN inbound_batch_recoveries r ON r.batch_id = b.id
    WHERE b.representative_turn_id = ${first.turnId}::uuid`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ state: 'completed', claim_attempt_count: 2, outcome: 'scheduled' });
  expect(rows[0]!.resolved_at).toBeTruthy();
  const evidence = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
    adapterCaptures: resumed.adapterCaptures });
  expect(evidence.decisions).toHaveLength(1);
  expect(evidence.outbound).toHaveLength(1);
  expect(evidence.recordedLinks).toEqual([]);
  const duplicate = await runWorkflowTurnV1({ ...id, text: '¿Cuáles son los planes de pago?',
    externalMessageId: first.externalMessageId, occurredAt: first.occurredAt });
  expect(duplicate.authorizedMessages).toEqual([]);
  child.mockRestore();
});


it('recovers a known channel phone requested as collect then disguised as clarify without losing identity', async () => {
  const id = { conversationId: `known-phone-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  respond = () => proposal('Hola. ¿En qué te ayudo?', {
    move: { schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 1 },
  });
  await runWorkflowTurnV1({ ...id, text: 'Hola' });
  // The harness keeps the +999 transport identity. Only the disposable DB
  // receives the canonical, trusted-phone fixture; no real channel is used.
  const channelPhone = '+15551234070';
  await db`UPDATE contacts SET contact_profile_v1 = jsonb_set(contact_profile_v1,
    '{fields,telefono}', jsonb_build_object('value', ${channelPhone}::text, 'status', 'confirmed',
    'source', 'channel', 'source_message_id', NULL, 'source_conversation_id', NULL,
    'source_quote', NULL, 'source_seq', NULL, 'version', 0)) WHERE phone = ${id.phoneE164}`;
  const child = vi.spyOn(Workflow.prototype, 'getOrCreate');
  const text = 'Dale, me llamas? Mi nombre es Ana; mi apellido es Costa; mi correo es ana.costa@example.test';
  let generations = 0;
  respond = context => {
    generations += 1;
    expect(context.customer.contact_intake?.telefono).toBe(channelPhone);
    if (context.turn_rejection) expect(context.customer.contact_intake)
      .toMatchObject({ nombre: 'Ana', apellido: 'Costa', correo: 'ana.costa@example.test' });
    return proposal('Me falta tu teléfono para coordinar la llamada.', {
      move: context.turn_rejection
        ? { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 }
        : { schema_version: 1, move: 'request_call', secondary_moves: ['provide_contact_details'], vetoes: [], confidence: 1 },
      profile_updates: context.turn_rejection ? [] : contactFixtureUpdatesV1(context, [
        { field: 'nombre', value: 'Ana' }, { field: 'apellido', value: 'Costa' },
        { field: 'correo', value: 'ana.costa@example.test' }]),
      profile_requests: [{ message_index: 0, fields: ['telefono'], purpose: 'call',
        mode: context.turn_rejection ? 'clarify' : 'collect' }],
    });
  };
  try {
    const first = await runWorkflowTurnV1({ ...id, text });
    expect(generations).toBe(2);
    expect(first.authorizedMessages).toEqual([]);
    expect(first.commitSucceeded).toBe(false);
    expect(first.errorCode).toBe('AGENT_A_CONTINUATION_REJECTED');
    expect(child).toHaveBeenCalledWith(expect.objectContaining({ key: expect.stringMatching(/^recovery:/u) }));
    const [contact] = await db`SELECT id, name, email FROM contacts WHERE phone = ${id.phoneE164}`;
    expect(contact).toMatchObject({ name: 'Ana Costa', email: 'ana.costa@example.test' });
    expect(await db`SELECT id FROM call_sessions WHERE contact_id = ${contact!.id}::uuid`).toHaveLength(0);
    respond = context => {
      expect(context.turn_rejection).toBeUndefined();
      expect(context.customer.contact_intake).toMatchObject({ nombre: 'Ana', apellido: 'Costa',
        correo: 'ana.costa@example.test', telefono: channelPhone });
      return proposal('Gracias, Ana. Puedes atender una llamada ahora?', {
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      });
    };
    const resumed = await runWorkflowTurnV1({ ...id, text,
      externalMessageId: first.externalMessageId, occurredAt: first.occurredAt });
    expect(resumed.errorCode).toBeNull();
    expect(resumed.authorizedMessages).toEqual(['Gracias, Ana. Puedes atender una llamada ahora?']);
    const evidence = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
    expect(evidence.decisions.filter(decision => decision.turnId === first.turnId)).toHaveLength(1);
    expect(evidence.state?.awaitingReply).toBe('call_or_chat');
    expect(await db`SELECT id FROM call_sessions WHERE contact_id = ${contact!.id}::uuid`).toHaveLength(0);
    const duplicate = await runWorkflowTurnV1({ ...id, text,
      externalMessageId: first.externalMessageId, occurredAt: first.occurredAt });
    expect(duplicate.authorizedMessages).toEqual([]);
  } finally { child.mockRestore(); }
});
