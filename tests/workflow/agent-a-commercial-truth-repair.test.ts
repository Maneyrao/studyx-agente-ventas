import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { StoredContactProfileV1 } from '../../src/lib/repositories/contact-profile.repository';
import { runWorkflowBurstV1, runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
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
  const repairedAnswer = 'Para Inglés 1 puedes elegir 12 pagos de USD 30, 6 pagos de USD 60 o 1 pago de USD 360. Cuál te sirve?';
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
    return proposal('Te comparto el enlace para pagar en 12 cuotas.', {
      move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: ['request_payment_link'], vetoes: [], confidence: 1, payment_plan: 'monthly_12' },
      proposed_action: { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'monthly_12' },
      used_fact_ids: ['payment:ingles_1:monthly_12:label:v1'],
    });
  };
  const paymentText = 'Quiero pagar en 12 cuotas de USD 30; envíame el enlace de pago.';
  const paid = await runWorkflowTurnV1({ ...id, text: paymentText });
  expect(paid.errorCode, JSON.stringify(paid.httpExchanges.filter(exchange => exchange.status !== 200))).toBeNull();
  expect(paid.commitSucceeded).toBe(true);
  expect(paid.httpExchanges.filter(exchange => exchange.boundary === 'deepseek')).toHaveLength(1);
  expect(await payments()).toMatchObject([{ plan_code: 'monthly_12' }]);
  expect(await calls()).toHaveLength(0);
  const paidDb = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
    adapterCaptures: [...selected.adapterCaptures, ...repaired.adapterCaptures, ...paid.adapterCaptures] });
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
