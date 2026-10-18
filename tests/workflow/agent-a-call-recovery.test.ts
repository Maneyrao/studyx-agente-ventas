import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { contactFixtureUpdatesV1 } from './contact-profile-fixture';
import { runWorkflowBurstV1, runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

// Real workflow, HTTP, ingestion, authorization and database. Only model
// generation is a fixture; no paid model or real voice destination is used.
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
const databaseUrl = process.env.TEST_DATABASE_URL!;
const db = openLocalTestDatabase();
const previousKey = secrets.DEEPSEEK_API_KEY;
let phase: 'course' | 'agus_course' | 'missing_identity' | 'identity' | 'agus_identity' | 'confirm' | 'invalid_repair' | 'payment_course' | 'payment_identity' | 'payment_options' | 'payment_choice' | 'payment_permission' | 'payment_confirm_choice' | 'payment_missing_identity' | 'payment_complete_intake' = 'course';
let generationCount = 0;
let latestContext: AgentAContextV1 | null = null;
let ingestTimeoutsRemaining = 0;

function proposal(text: string, action: AgentATurnProposalV1['proposed_action'] = { type: 'none' }): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text] }, proposed_action: action,
    profile_updates: [], profile_requests: [],
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
  };
}

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.protocol).toBe('http:');
  expect(backend.port).toMatch(/^32\d\d$/u);
  const localFetch = globalThis.fetch;
  expect((await localFetch(`${apiBaseUrl}/api/ready`)).ok).toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'call-recovery-fixture';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) {
      if (target.pathname === '/api/agent/ingest' && ingestTimeoutsRemaining > 0) {
        ingestTimeoutsRemaining -= 1;
        throw new DOMException('Fixture ingress timeout before acknowledgement', 'AbortError');
      }
      return localFetch(request, init);
    }
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_CALL');
    generationCount += 1;
    const requestBody = JSON.parse(String(init?.body));
    const instructions = requestBody.instructions as string;
    const serialized = instructions.match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    latestContext = JSON.parse(serialized) as NonNullable<typeof latestContext>;
    const rejection = latestContext.turn_rejection;
    let result = phase === 'payment_course'
      ? { ...proposal('Te puedo orientar sobre Inglés 1.'),
          move: { schema_version: 1 as const, move: 'select_course' as const, secondary_moves: [], vetoes: [], confidence: 1, course_reference: 'ingles_1' },
          used_fact_ids: ['offering:ingles_1:name:v1'] }
      : phase === 'payment_identity'
      ? proposal('Gracias, Thiago. Puedes atender la llamada ahora?')
      : phase === 'payment_options'
      ? { ...proposal('Seguimos por aquí. Puedes elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.'),
          move: { schema_version: 1 as const, move: 'continue_by_chat' as const, secondary_moves: ['ask_payment_options' as const], vetoes: ['call' as const], confidence: 1 },
          used_fact_ids: ['payment:ingles_1:monthly_12:amount:v1', 'payment:ingles_1:monthly_6:amount:v1', 'payment:ingles_1:one_time:amount:v1'] }
      : phase === 'payment_choice'
      ? { ...proposal('Te paso el enlace para hacer el pago único.', { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'one_time' }),
          move: { schema_version: 1 as const, move: 'select_payment_plan' as const, secondary_moves: [], vetoes: [], payment_plan: 'one_time' as const, confidence: 1 },
          used_fact_ids: ['payment:ingles_1:one_time:label:v1'] }
      : phase === 'payment_permission'
      ? { ...proposal('Entonces queda el pago único de USD 360. Te envío el enlace de pago para avanzar?'),
          move: { schema_version: 1 as const, move: 'select_payment_plan' as const, secondary_moves: [], vetoes: [], payment_plan: 'one_time' as const, confidence: 1 },
          used_fact_ids: ['payment:ingles_1:one_time:label:v1'] }
      : phase === 'payment_missing_identity'
      ? { ...proposal('Te paso el enlace de pago.', { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'one_time' }),
          move: { schema_version: 1 as const, move: 'select_payment_plan' as const, secondary_moves: [], vetoes: [], payment_plan: 'one_time' as const, confidence: 1 },
          used_fact_ids: ['payment:ingles_1:one_time:label:v1'] }
      : phase === 'payment_complete_intake'
      ? { ...proposal('Gracias. ¿Confirmas tus datos y el pago único para enviarte el enlace?'),
          move: { schema_version: 1 as const, move: 'provide_contact_details' as const, secondary_moves: [], vetoes: [], confidence: 1 } }
      : phase === 'payment_confirm_choice'
      ? { ...proposal('Perfecto. Te dejo el enlace de pago para Inglés 1.', { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'one_time' }),
          move: { schema_version: 1 as const, move: 'select_course' as const, secondary_moves: [], vetoes: [], course_reference: 'ingles_1', confidence: 1 },
          used_fact_ids: ['offering:ingles_1:name:v1', 'payment:ingles_1:one_time:label:v1'] }
      : phase === 'course' || phase === 'agus_course'
      ? { ...proposal('Te puedo orientar sobre Oratoria.'),
          move: { schema_version: 1 as const, move: 'select_course' as const, secondary_moves: [], vetoes: [], confidence: 1, course_reference: 'Oratoria' },
          response: { messages: ['Te puedo orientar sobre Oratoria.'],
            ...(phase === 'agus_course' ? { call_offer: 'Si quieres, te llamo y te explico el curso y la inscripción. Te parece?' } : {}) },
          used_fact_ids: ['offering:oratoria:name:v1'] }
      : phase === 'invalid_repair'
      ? proposal('Claro, te llamo ahora.')
      : phase === 'missing_identity'
      ? proposal(rejection
        ? 'Para coordinarla, me pasas tu nombre, apellido y teléfono con código de país?'
        : 'Claro, te llamo ahora.')
      : phase === 'identity'
        ? proposal('Gracias, Juan. Puedes atender ahora?')
      : phase === 'agus_identity'
        ? proposal('Gracias, Agus. Puedes atender la llamada ahora?')
        : proposal('Te llamo ahora.', { type: 'request_call_now', reason: 'direct_request' });
    if (requestBody.text.format.schema.properties.proposed_action.anyOf.length === 1) {
      const continuationMove = phase === 'payment_choice'
        ? { schema_version: 1 as const, move: 'select_payment_plan' as const,
            secondary_moves: [], vetoes: [], payment_plan: 'one_time' as const, confidence: 1 }
        : phase === 'payment_missing_identity'
        ? { schema_version: 1 as const, move: 'select_payment_plan' as const,
            secondary_moves: ['request_payment_link' as const], vetoes: [],
            payment_plan: 'one_time' as const, confidence: 1 }
        : { schema_version: 1 as const, move: 'request_call' as const,
            secondary_moves: [], vetoes: [], confidence: 1 };
      result = { ...proposal(phase === 'payment_choice'
        ? '¿Confirmas tus datos y el pago único para enviarte el enlace?'
        : phase === 'payment_missing_identity'
        ? 'Para generar el enlace, me pasas tu nombre, apellido, correo y teléfono con código de país?'
        : 'Para coordinarla, me pasas tu nombre, apellido y teléfono con código de país?'),
        move: continuationMove };
    }
    result.profile_updates = contactFixtureUpdatesV1(latestContext,
      phase === 'identity' ? [{ field: 'nombre', value: 'Juan' }, { field: 'apellido', value: 'Perez' },
        { field: 'telefono', value: '+15551234567' }]
      : phase === 'agus_identity' ? [{ field: 'nombre', value: 'Agus' },
        { field: 'apellido', value: 'Maneyro', quote: 'maneyro' }, { field: 'telefono', value: '+15551234567' }]
      : phase === 'payment_identity' || phase === 'payment_complete_intake'
        ? [{ field: 'nombre', value: 'Thiago' }, { field: 'apellido', value: 'Maneyro' },
            { field: 'correo', value: 'thiago@example.com' }, { field: 'telefono', value: '+15551234567' }]
        : []);
    if (requestBody.text.format.schema.properties.proposed_action.anyOf.length === 1 || phase === 'missing_identity' && rejection) {
      const fields = latestContext.capabilities.intake_missing.filter(field =>
        phase === 'payment_missing_identity' || field !== 'correo');
      result.profile_requests = fields.length ? [{ message_index: 0, fields,
        purpose: phase === 'payment_missing_identity' ? 'payment' : 'call', mode: 'collect' }] : [];
    }
    if (rejection) result.repair_of = { rejection_id: rejection.rejection_id, attempt: 1 };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

it('retains a payment request through intake and executes it once after the separate confirmation', async () => {
  const id = { conversationId: `payment-pending-${randomUUID()}`, userId: `payment-pending-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  phase = 'payment_course';
  // Fail one HTTP attempt: the workflow owns ingress retries durably. Exercise
  // its recovery interface without depending on an accidental dev cold start.
  ingestTimeoutsRemaining = 1;
  const course = await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1.' });
  expect(course.errorCode).toBeNull();
  expect(course.commitSucceeded).toBe(true);
  expect(course.steps).toContain('workflow:setTimeout:30m');
  phase = 'payment_missing_identity'; generationCount = 0;
  const initial = await runWorkflowTurnV1({ ...id, text: 'Quiero el enlace para 1 pago.' });
  expect(initial.commitSucceeded).toBe(true);
  expect(generationCount).toBe(2);
  expect(initial.authorizedMessages.join(' ')).toContain('nombre, apellido, correo y teléfono');
  const payments = () => db`SELECT p.id,p.plan_code FROM payments p JOIN contacts c ON c.id=p.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(await payments()).toHaveLength(0);
  const [pending] = await db`SELECT s.payment_link_request,s.selected_payment_plan,s.awaiting_reply
    FROM conversation_sales_context_states_v1 s JOIN contacts c ON c.id=s.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(pending).toMatchObject({ selected_payment_plan: 'one_time', awaiting_reply: 'contact_details',
    payment_link_request: { status: 'pending', offering_code: 'ingles_1', payment_plan: 'one_time', requested_by_turn_id: initial.turnId } });
  phase = 'payment_complete_intake'; generationCount = 0;
  const completedText = 'Mi nombre es Thiago y mi apellido es Maneyro. Mi correo es thiago@example.com. Mi teléfono es +15551234567.';
  const completed = await runWorkflowTurnV1({ ...id, text: completedText });
  expect(completed.commitSucceeded).toBe(true);
  expect(generationCount).toBe(1);
  expect(await payments()).toHaveLength(0);
  phase = 'payment_confirm_choice';
  const confirmationText = 'Sí, confirmo mis datos y el pago único. Envíame el enlace.';
  const confirmed = await runWorkflowTurnV1({ ...id, text: confirmationText });
  expect(confirmed.errorCode).toBeNull();
  expect(confirmed.authorizedMessages.join(' ')).toContain('https://buy.stripe.com/local-eval-contado');
  expect(await payments()).toMatchObject([{ plan_code: 'one_time' }]);
  await runWorkflowTurnV1({ ...id, text: confirmationText,
    externalMessageId: confirmed.externalMessageId, occurredAt: confirmed.occurredAt });
  expect(await payments()).toHaveLength(1);
});

it('persists Agus data from separate messages before accepting Sii and reserves exactly one call', async () => {
  const id = { conversationId: `agus-call-${randomUUID()}`, userId: `agus-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  phase = 'agus_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Oratoria.' })).commitSucceeded).toBe(true);
  phase = 'missing_identity';
  const requested = await runWorkflowTurnV1({ ...id, text: 'Me podes llamar?' });
  expect(requested.authorizedMessages.join(' ')).toContain('nombre, apellido y teléfono');
  const [pendingIntent] = await db`SELECT s.call_preference,s.call_offer_status,s.awaiting_reply
    FROM conversation_sales_context_states_v1 s JOIN contacts c ON c.id=s.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(pendingIntent).toMatchObject({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });
  phase = 'agus_identity';
  const intake = await runWorkflowBurstV1({ ...id, messages: [
    { text: 'así es, mi nombre es Agus', delayMs: 0 },
    { text: 'maneyro', delayMs: 200 },
    { text: 'Mi teléfono es +15551234567', delayMs: 400 },
  ] });
  expect(intake.errorCode).toBeNull();
  expect(intake.commitSucceeded).toBe(true);
  const receipt = intake.httpExchanges.find(exchange => exchange.url.endsWith('/profile'))?.responseBody as { values?: unknown };
  expect(receipt.values).toMatchObject({ nombre: 'Agus', apellido: 'Maneyro' });
  const stored = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(stored.contact).toMatchObject({ name: 'Agus Maneyro', declaredPhone: '+15551234567' });
  phase = 'confirm';
  const confirmed = await runWorkflowTurnV1({ ...id, text: 'Sii' });
  expect(confirmed.errorCode).toBeNull();
  expect(confirmed.commitSucceeded).toBe(true);
  expect(confirmed.actions.some(action => action.name === 'dispatchCall')).toBe(true);
  const calls = () => db`SELECT cs.id FROM call_sessions cs JOIN contacts c ON c.id=cs.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(await calls()).toHaveLength(1);
  const replay = await runWorkflowTurnV1({ ...id, text: 'Sii', externalMessageId: confirmed.externalMessageId, occurredAt: confirmed.occurredAt });
  expect(replay.authorizedMessages).toHaveLength(0);
  expect(await calls()).toHaveLength(1);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
  await db.end();
});

it('repairs the Lucas promise, records the real repair, retains full identity and reserves one consented call without requiring email', async () => {
  const id = {
    conversationId: `lucas-call-${randomUUID()}`, userId: `lucas-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const,
  };
  phase = 'course';
  const selection = await runWorkflowTurnV1({ ...id, text: 'Me interesa el curso de Oratoria.' });
  expect(selection.errorCode).toBeNull();
  phase = 'missing_identity';
  generationCount = 0;
  const initial = await runWorkflowTurnV1({ ...id, text: 'Dale llámenme ahora por favor' });
  expect(initial.errorCode).toBeNull();
  expect(initial.commitSucceeded).toBe(true);
  expect(initial.authorizedMessages.join(' ')).not.toContain('te llamo ahora');
  expect(initial.authorizedMessages.join(' ')).toContain('nombre, apellido y teléfono');
  expect(generationCount).toBe(2);
  const initialRows = await db<Array<{ diagnostics: unknown }>>`
    SELECT diagnostics FROM agent_decisions WHERE trace_id = ${initial.traceId}::uuid
  `;
  expect(initialRows[0]?.diagnostics).toMatchObject({
    generation_attempts: 2, failure_stage: 'proposal_validation',
    failure_codes: expect.arrayContaining(['UNSUPPORTED_OPERATIONAL_CLAIM']), action_status: 'none',
  });

  phase = 'identity';
  const intake = await runWorkflowTurnV1({
    ...id, text: 'Mi nombre es Juan y mi apellido es Perez. Mi teléfono es +15551234567.',
  });
  expect(intake.errorCode).toBeNull();
  const persisted = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(persisted.contact).toMatchObject({ name: 'Juan Perez', email: null });
  const receipt = intake.httpExchanges.find(exchange => exchange.url.endsWith('/profile'))?.responseBody as { values?: unknown };
  expect(receipt.values).toMatchObject({ nombre: 'Juan', apellido: 'Perez', correo: null });
  expect(persisted.state).toMatchObject({ callPreference: 'call', callOfferStatus: 'accepted' });

  phase = 'confirm'; generationCount = 0;
  const confirmed = await runWorkflowTurnV1({ ...id, text: 'Sí, puedo atender ahora, llámame.' });
  expect(confirmed.errorCode).toBeNull();
  expect(confirmed.commitSucceeded).toBe(true);
  expect(generationCount).toBe(1);
  expect(confirmed.authorizedMessages.join(' ')).toContain('Te llamo ahora.');
  const calls = await db<Array<{ id: string; source_turn_id: string }>>`
    SELECT cs.id, cs.source_turn_id FROM call_sessions cs
    JOIN contacts c ON c.id = cs.contact_id WHERE c.phone = ${id.phoneE164}
  `;
  expect(calls).toHaveLength(1);
  expect(calls[0]!.source_turn_id).toBe(confirmed.turnId);
  // Dispatch success/failure and webhook races are covered separately with
  // the actual provider adapter and fake HTTP, never a real phone call here.
  expect(confirmed.actions.some(action => action.name === 'dispatchCall')).toBe(true);
  const replay = await runWorkflowTurnV1({
    ...id, text: 'Sí, puedo atender ahora, llámame.',
    externalMessageId: confirmed.externalMessageId, occurredAt: confirmed.occurredAt,
  });
  expect(replay.authorizedMessages).toHaveLength(0);
  const replayedCalls = await db`
    SELECT cs.id FROM call_sessions cs
    JOIN contacts c ON c.id = cs.contact_id WHERE c.phone = ${id.phoneE164}
  `;
  expect(replayedCalls).toHaveLength(1);
  expect(replayedCalls[0]!.id).toBe(calls[0]!.id);
});

it('lets Agent A request missing data after the rejected call promise without a protocol notice', async () => {
  const id = {
    conversationId: `lucas-invalid-repair-${randomUUID()}`, userId: `lucas-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const,
  };
  phase = 'invalid_repair';
  generationCount = 0;
  const result = await runWorkflowTurnV1({ ...id, text: 'Dale llámenme ahora por favor' });
  expect(result.commitSucceeded).toBe(true);
  expect(generationCount).toBe(2);
  expect(result.adapterCaptures).toHaveLength(1);
  expect(result.authorizedMessages).toHaveLength(1);
  expect(result.authorizedMessages.join(' ')).not.toMatch(/te llamo|registrad|ocupad/iu);
  expect(result.authorizedMessages.join(' ')).toContain('nombre, apellido y teléfono');
  expect(result.authorizedMessages.join(' ')).not.toContain('se cortó mi respuesta');
  expect(result.actions.some(action => action.name === 'dispatchCall')).toBe(false);
  const calls = await db`
    SELECT cs.id FROM call_sessions cs
    JOIN contacts c ON c.id = cs.contact_id WHERE c.phone = ${id.phoneE164}
  `;
  expect(calls).toHaveLength(0);
  const rows = await db<Array<{ diagnostics: unknown }>>`
    SELECT diagnostics FROM agent_decisions WHERE trace_id = ${result.traceId}::uuid
  `;
  expect(rows[0]?.diagnostics).toMatchObject({
    generation_attempts: 2, failure_stage: 'proposal_validation', action_status: 'none',
  });
});

it.each(['1 pago', 'un pago de 360', 'split'])('keeps intake and executes the Agent A interpreted %s plan after a call handoff', async choice => {
  const id = { conversationId: `payment-owner-${randomUUID()}`, userId: `payment-owner-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  phase = 'payment_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1.' })).commitSucceeded).toBe(true);
  phase = 'payment_identity';
  expect((await runWorkflowTurnV1({ ...id, text: 'Mi nombre es Thiago y mi apellido es Maneyro. Mi correo es thiago@example.com. Mi teléfono es +15551234567.' })).commitSucceeded).toBe(true);
  phase = 'confirm';
  expect((await runWorkflowTurnV1({ ...id, text: 'Sí, puedo atender ahora, llámame.' })).commitSucceeded).toBe(true);
  const [handoff] = await db`SELECT s.stage,s.selected_payment_plan FROM conversation_sales_context_states_v1 s JOIN contacts c ON c.id=s.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(handoff).toMatchObject({ stage: 'handoff', selected_payment_plan: null });
  phase = 'payment_options';
  expect((await runWorkflowTurnV1({ ...id, text: 'dale quiero pagar por acá' })).commitSucceeded).toBe(true);
  phase = 'payment_choice';
  generationCount = 0;
  const result = choice === 'split'
    ? await runWorkflowBurstV1({ ...id, messages: [{ text: '1', delayMs: 0 }, { text: 'pago', delayMs: 200 }] })
    : await runWorkflowTurnV1({ ...id, text: choice });
  expect(result.errorCode).toBeNull();
  expect(result.commitSucceeded).toBe(true);
  expect(generationCount).toBe(2);
  expect(result.authorizedMessages.join(' ')).not.toContain('se cortó mi respuesta');
  expect(await db`SELECT p.id FROM payments p JOIN contacts c ON c.id=p.contact_id WHERE c.phone=${id.phoneE164}`).toHaveLength(0);
  phase = 'payment_confirm_choice';
  const confirmed = await runWorkflowTurnV1({ ...id, text: 'Sí, confirmo mis datos y el pago único. Envíame el enlace.' });
  expect(confirmed.errorCode).toBeNull();
  expect(confirmed.authorizedMessages.join(' ')).toContain('https://buy.stripe.com/local-eval-contado');
  const rows = await db`SELECT p.id,p.plan_code,p.amount FROM payments p JOIN contacts c ON c.id=p.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(rows).toHaveLength(1);
  expect(rows[0].plan_code).toBe('one_time');
  expect(Number(rows[0].amount)).toBe(360);
  const [contact] = await db`SELECT name,email,declared_phone FROM contacts WHERE phone=${id.phoneE164}`;
  expect(contact).toMatchObject({ name: 'Thiago Maneyro', email: 'thiago@example.com', declared_phone: '+15551234567' });
});

it('keeps the Agent A payment permission question and executes its explicit tool after course confirmation', async () => {
  const id = { conversationId: `payment-permission-${randomUUID()}`, userId: `payment-permission-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  phase = 'payment_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1.' })).commitSucceeded).toBe(true);
  phase = 'payment_identity';
  expect((await runWorkflowTurnV1({ ...id, text: 'Mi nombre es Thiago y mi apellido es Maneyro. Mi correo es thiago@example.com. Mi teléfono es +15551234567.' })).commitSucceeded).toBe(true);
  phase = 'payment_permission'; generationCount = 0;
  const permission = await runWorkflowTurnV1({ ...id, text: 'quiero 1 pago' });
  expect(permission.commitSucceeded).toBe(true);
  expect(generationCount).toBe(1);
  expect(permission.authorizedMessages.join(' ')).toContain('Te envío el enlace de pago para avanzar?');
  const payments = () => db`SELECT p.id,p.plan_code FROM payments p JOIN contacts c ON c.id=p.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(await payments()).toHaveLength(0);
  phase = 'payment_confirm_choice'; generationCount = 0;
  const confirmed = await runWorkflowTurnV1({ ...id, text: 'sí' });
  expect(confirmed.commitSucceeded).toBe(true);
  expect(generationCount).toBe(1);
  expect(confirmed.authorizedMessages.join(' ')).toContain('https://buy.stripe.com/local-eval-contado');
  expect(await payments()).toMatchObject([{ plan_code: 'one_time' }]);
  const calls = await db`SELECT cs.id FROM call_sessions cs JOIN contacts c ON c.id=cs.contact_id WHERE c.phone=${id.phoneE164}`;
  expect(calls).toHaveLength(0);
});
