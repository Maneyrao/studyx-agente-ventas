import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { openLocalTestDatabase } from '../helpers/db';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

// Only the external model and physical delivery are fixtures. Context, validators,
// signed HTTP, database, transitions and commit execute the production code.
const databaseUrl = process.env.TEST_DATABASE_URL!;
const db = openLocalTestDatabase();
let seedStaleSelection = false;
let respond: (context: AgentAContextV1) => unknown;
const contexts: AgentAContextV1[] = [];
beforeAll(async () => {
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'fixture-no-paid-calls';
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.origin === configuration.apiBaseUrl) {
      const response = await original(request, init);
      if (seedStaleSelection && url.pathname.endsWith('/ingest') && response.ok) {
        const ingest = await response.clone().json();
        const [message] = await db`SELECT m.contact_id, wc.workspace_id FROM messages m
          JOIN workspace_contacts wc ON wc.contact_id=m.contact_id WHERE m.id=${ingest.turn_id}::uuid`;
        const [previous] = await db`INSERT INTO conversations (contact_id,channel,status)
          VALUES (${message!.contact_id}::uuid,'whatsapp','closed') RETURNING id`;
        await db`INSERT INTO sales_context_states(workspace_id,contact_id,conversation_id,selected_offering_code,stage)
          VALUES (${message!.workspace_id}::uuid,${message!.contact_id}::uuid,${previous!.id}::uuid,'community_manager','course_selected')
          ON CONFLICT (workspace_id,contact_id) DO UPDATE SET conversation_id=excluded.conversation_id,
            selected_offering_code=excluded.selected_offering_code,stage=excluded.stage`;
        seedStaleSelection = false;
      }
      return response;
    }
    if (url.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_REQUEST');
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.instructions.split('<authorized_context>')[1].split('</authorized_context>')[0]);
    contexts.push(context);
    const value = respond(context) as AgentATurnProposalV1;
    const proposal = { ...value, repair_of: context.turn_rejection
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null };
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{
      type: 'output_text', text: JSON.stringify(proposal),
    }] }], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
    { headers: { 'content-type': 'application/json' } });
  });
});
afterAll(async () => { vi.unstubAllGlobals(); await db.end(); });

function proposal(move: AgentATurnProposalV1['move']['move'], text: string,
  extra: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return { schema_version: 1,
    move: { schema_version: 1, move, secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text] }, proposed_action: { type: 'none' },
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null, ...extra };
}
function conversation() {
  const id = { conversationId: `real-regression-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`,
    providerMode: 'fixture' as const };
  const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
  async function send(text: string, next: (context: AgentAContextV1) => unknown) {
    respond = next;
    const evidence = await runWorkflowTurnV1({ ...id, text });
    turns.push({ customer: text, evidence });
    const persisted = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
      adapterCaptures: turns.flatMap(t => t.evidence.adapterCaptures) });
    const calls = await db`SELECT cs.id, cs.status FROM call_sessions cs
      JOIN conversations c ON c.id = cs.conversation_id
      JOIN channel_threads ct ON ct.id = c.channel_thread_id WHERE ct.external_conversation_id = ${id.conversationId}`;
    writeWorkflowReportV1('real-conversation-regression', { id, turns, persisted, calls,
      cost_usd: 0, provider: 'fixture', source_conversation: '3fd53b66-b72a-4932-8a98-6684391d81ce' });
    expect(evidence.errorCode, JSON.stringify(evidence.httpExchanges.filter(e => e.status !== 200))).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.legacyPlanRequests).toBe(0);
    return { evidence, persisted, calls, context: contexts.at(-1)! };
  }
  async function retryLast() {
    const last = turns.at(-1)!;
    const retry = await runWorkflowTurnV1({ ...id, text: last.customer,
      externalMessageId: last.evidence.externalMessageId, occurredAt: last.evidence.occurredAt });
    expect(retry.adapterCaptures).toHaveLength(0);
    expect(retry.httpExchanges.filter(e => e.url.includes('api.deepseek.com'))).toHaveLength(0);
    return readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
      adapterCaptures: turns.flatMap(t => t.evidence.adapterCaptures) });
  }
  return { id, send, turns, retryLast };
}

it('keeps a general opening unselected despite a course saved for a previous conversation', async () => {
  const c = conversation();
  seedStaleSelection = true;
  const opening = await c.send('Info', () => proposal('browse_catalog', 'Soy el asistente virtual de StudyX. Qué te gustaría aprender?'));
  expect(opening.context.commercial_state.selected_offering_code).toBeNull();
  expect(opening.context.catalog.selected_offering).toBeNull();
  expect(opening.persisted.state?.selectedOfferingCode).toBeNull();
  expect(opening.evidence.authorizedMessages).toEqual(['Soy el asistente virtual de StudyX. Qué te gustaría aprender?']);
}, 60_000);

it('retains call acceptance without a phone, repairs the impossible action and creates one session after the phone', async () => {
  const c = conversation();
  const first = await c.send('Dsle llamame', context => context.turn_rejection
    ? proposal('request_call', 'A qué número con código de país y área puedo llamarte?')
    : proposal('request_call', 'Coordino la llamada para explicarte el curso.', {
      proposed_action: { type: 'request_call_now', reason: 'direct_request' },
    }));
  expect.soft(first.evidence.authorizedMessages).toEqual(['A qué número con código de país y área puedo llamarte?']);
  expect.soft(first.context.turn_rejection, 'the impossible action must reach the existing model repair').toBeDefined();
  expect.soft(first.persisted.state).toMatchObject({ callPreference: 'call', callOfferStatus: 'accepted' });
  expect(first.calls).toHaveLength(0);
  const second = await c.send('Mi teléfono es +54 9 11 5555 0101', context => {
    expect(context.commercial_state.call_preference).toBe('call');
    expect(context.capabilities.may_request_call_now).toBe(true);
    return proposal('request_call', 'Solicito la llamada al número que me pasaste.', {
      proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
    });
  });
  expect(second.calls).toHaveLength(1);
  expect(second.persisted.contact?.declaredPhone).toBe('+5491155550101');
  expect(second.persisted.decisions.filter(d => d.businessActionType === 'request_call_now')).toHaveLength(1);
  const replay = await c.retryLast();
  expect(replay.decisions).toHaveLength(second.persisted.decisions.length);
  expect(replay.outboundCount).toBe(second.persisted.outboundCount);
}, 120_000);

it('persists a delivered phone confirmation, preserves the full name and sends exactly one canonical link', async () => {
  const c = conversation();
  await c.send('Quiero Community Manager y elijo 12 cuotas. Me llamo Ludmi.', () => proposal('select_course',
    'Me faltan tu apellido, correo y teléfono para completar la inscripción.', {
      move: { schema_version: 1, move: 'select_course', secondary_moves: ['select_payment_plan'], vetoes: [],
        course_reference: 'community_manager', payment_plan: 'monthly_12', confidence: 1 },
    }));
  const supplied = await c.send('Ludmi medina\n[ludmi@example.test](mailto:ludmi@example.test)\n[1155550101](tel:1155550101)',
    () => proposal('provide_contact_details', 'El teléfono completo es +54 9 11 5555 0101?'));
  expect(supplied.persisted.contact?.name).toBe('Ludmi Medina');
  expect(supplied.persisted.contact?.declaredPhone).toBe('1155550101');
  const confirmed = await c.send('Si', () => ({
    ...proposal('provide_contact_details', 'Ludmi Medina, ludmi@example.test, +54 9 11 5555 0101; Community Manager, 12 cuotas. Está todo correcto?'),
    confirmed_phone: '+5491155550101',
  }));
  expect.soft(confirmed.persisted.contact?.declaredPhone).toBe('+5491155550101');
  expect.soft(confirmed.persisted.contact?.name).toBe('Ludmi Medina');
  const paid = await c.send('Si, necesito que me agendes y me des el link', context => {
    expect(context.capabilities.intake_missing).toEqual([]);
    expect(context.customer.contact_intake?.telefono).toBe('+5491155550101');
    return proposal('request_payment_link', 'Te paso el enlace. Avísame por aquí cuando hayas pagado.', {
      proposed_action: { type: 'send_payment_link', offering_code: 'community_manager', payment_plan: 'monthly_12' },
    });
  });
  expect(paid.persisted.contact?.name).toBe('Ludmi Medina');
  expect(paid.persisted.deliveredLinks).toEqual(['https://example.invalid/eval/12m']);
  expect(paid.persisted.decisions.filter(d => d.businessActionType === 'send_payment_link')).toHaveLength(1);
  const replay = await c.retryLast();
  expect(replay.decisions).toHaveLength(paid.persisted.decisions.length);
  expect(replay.recordedLinks).toEqual(['https://example.invalid/eval/12m']);
  expect(replay.outboundCount).toBe(paid.persisted.outboundCount);
  const last = await c.send('Gracias', context => {
    expect(context.capabilities.intake_missing).toEqual([]);
    return proposal('unknown', 'Cuando pagues, avísame y el equipo verificará la acreditación.');
  });
  expect(last.persisted.deliveredLinks).toEqual(['https://example.invalid/eval/12m']);
}, 120_000);

it('cancels pending call intent when the model interprets the choice to continue here', async () => {
  const c = conversation();
  await c.send('Dale, llamame', () => proposal('request_call', 'A qué número con código de país y área puedo llamarte?'));
  const changed = await c.send('seguir por aca', () => proposal('continue_by_chat', 'Seguimos por aquí. Qué te gustaría saber?'));
  expect(changed.persisted.state).toMatchObject({ callPreference: 'chat', callOfferStatus: 'declined' });
  const phone = await c.send('Mi teléfono es +54 9 11 5555 0101', () => proposal('provide_contact_details', 'Qué te gustaría aprender?'));
  expect(phone.persisted.state?.callPreference).toBe('chat');
  expect(phone.calls).toHaveLength(0);
}, 120_000);

it('delivers and counts an invitation allowed by context without requiring a name', async () => {
  const c = conversation();
  const result = await c.send('Info', () => proposal('browse_catalog', 'Qué te gustaría aprender?', {
    response: { messages: ['Qué te gustaría aprender?'], call_offer: 'Si te sirve, puedo llamarte para orientarte.' },
  }));
  expect(result.context.capabilities.may_offer_call).toBe(true);
  expect(result.evidence.authorizedMessages).toContain('Si te sirve, puedo llamarte para orientarte.');
  expect(result.persisted.state?.callOfferCount).toBe(1);
}, 60_000);

it('keeps two rejected invitations across idle time and honors a later customer request exactly once', async () => {
  const c = conversation();
  const first = await c.send('Info', () => proposal('browse_catalog', 'Qué te gustaría aprender?', {
    response: { messages: ['Qué te gustaría aprender?'], call_offer: 'Si te sirve, puedo llamarte para orientarte.' },
  }));
  expect(first.persisted.state?.callOfferCount).toBe(1);
  await c.retryLast();
  const refused = await c.send('No, seguimos por chat', () => proposal('decline_call', 'Qué objetivo tienes con la formación?'));
  expect(refused.persisted.state).toMatchObject({ callPreference: 'chat', callOfferStatus: 'declined', callOfferCount: 1 });
  const second = await c.send('Quiero cambiar de trabajo pero no sé qué elegir', () => proposal('browse_catalog', 'Podemos partir de lo que te gusta hacer.', {
    response: { messages: ['Podemos partir de lo que te gusta hacer.'], call_offer: 'Si te sirve, podemos hablar por teléfono para ayudarte a elegir.' },
  }));
  expect(second.persisted.state?.callOfferCount).toBe(2);
  const declined = await c.send('No gracias, por aquí', () => proposal('continue_by_chat', 'Qué temas te interesan?'));
  expect(declined.persisted.state).toMatchObject({ callOfferCount: 2, callOfferStatus: 'declined' });
  // Exercise the real claim/commit expiry, not an in-memory state double.
  await db`UPDATE conversation_sales_context_states_v1 SET updated_at=now()-interval '3 days'
    WHERE conversation_id IN (SELECT c.id FROM conversations c JOIN channel_threads ct ON ct.id=c.channel_thread_id
      WHERE ct.external_conversation_id=${c.id.conversationId})`;
  const third = await c.send('Me interesa aprender algo creativo', context => {
    expect(context.commercial_state.call_offer_count).toBe(2);
    expect(context.capabilities.may_offer_call).toBe(false);
    return context.turn_rejection
      ? proposal('browse_catalog', 'Prefieres crear contenido visual o trabajar con las manos?')
      : proposal('browse_catalog', 'Si quieres, puedo llamarte para orientarte.');
  });
  expect(third.context.turn_rejection?.rejections.map(r => r.code)).toContain('CALL_BUDGET_EXHAUSTED');
  expect(third.evidence.authorizedMessages).toEqual(['Prefieres crear contenido visual o trabajar con las manos?']);
  expect(third.persisted.state?.callOfferCount).toBe(2);
  const requested = await c.send('Dale, ahora llamame', () => proposal('request_call', 'A qué número con código de país y área puedo llamarte?'));
  expect(requested.persisted.state).toMatchObject({ callPreference: 'call', callOfferStatus: 'accepted', callOfferCount: 2 });
  expect(requested.calls).toHaveLength(0);
  const phone = await c.send('Mi teléfono es +54 9 11 5555 0101', context => {
    expect(context.capabilities.may_offer_call).toBe(false);
    expect(context.capabilities.may_request_call_now).toBe(true);
    return proposal('request_call', 'Solicito la llamada al número que me pasaste.', {
      proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
    });
  });
  expect(phone.persisted.state?.callOfferCount).toBe(2);
  expect(phone.calls).toHaveLength(1);
  expect(phone.persisted.decisions.filter(d => d.businessActionType === 'request_call_now')).toHaveLength(1);
  const replay = await c.retryLast();
  expect(replay.decisions).toHaveLength(phone.persisted.decisions.length);
  expect(replay.outboundCount).toBe(phone.persisted.outboundCount);
}, 180_000);
