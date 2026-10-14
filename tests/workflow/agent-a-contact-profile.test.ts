import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { ContactProfileFieldV1, ContactProfileUpdateV1 } from '../../src/shared/conversation/contact-profile-contract';
import type { StoredContactProfileV1 } from '../../src/lib/repositories/contact-profile.repository';
import { runWorkflowBurstV1, runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

// Production workflow, signed HTTP routes and PostgreSQL; only model HTTP is
// controlled. This proves contracts/persistence, not real-model interpretation.
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
const db = openLocalTestDatabase();
const previousKey = secrets.DEEPSEEK_API_KEY;
let respond: (context: AgentAContextV1) => AgentATurnProposalV1;
const contexts: AgentAContextV1[] = [];

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.protocol).toBe('http:');
  expect(backend.port).toMatch(/^32\d\d$/u);
  const localFetch = globalThis.fetch;
  expect((await localFetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'offline-contact-profile-fixture';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return localFetch(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_CONTACT_PROFILE_REQUEST');
    const instructions = JSON.parse(String(init?.body)).instructions as string;
    const context = JSON.parse(instructions.split('<authorized_context>')[1]!.split('</authorized_context>')[0]!) as AgentAContextV1;
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

function proposal(messages: string[], extra: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return { schema_version: 1,
    move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages }, proposed_action: { type: 'none' }, profile_updates: [], profile_requests: [],
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null, ...extra };
}

function observedUpdate(context: AgentAContextV1, field: ContactProfileFieldV1, value: string | null,
  quote: string, operation: ContactProfileUpdateV1['operation'] = 'set'): ContactProfileUpdateV1 {
  const sources = context.customer.contact_profile?.sources ?? [];
  const source = [...sources].reverse().find(message => message.text.includes(quote));
  expect(source, `Missing physical inbound evidence for ${field}`).toBeDefined();
  return { field, value, operation, source_message_id: source!.id, source_quote: quote };
}

function conversation() {
  const id = { conversationId: `profile-general-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${randomUUID().replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`,
    providerMode: 'fixture' as const };
  const turns: WorkflowTurnEvidenceV1[] = [];
  async function send(text: string, next: typeof respond) {
    respond = next;
    const contextStart = contexts.length;
    const evidence = await runWorkflowTurnV1({ ...id, text });
    turns.push(evidence);
    expect(evidence.errorCode, JSON.stringify(evidence.httpExchanges.filter(exchange => exchange.status !== 200))).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.legacyPlanRequests).toBe(0);
    return { evidence, contexts: contexts.slice(contextStart), row: await profile() };
  }
  async function profile() {
    const [row] = await db<Array<{ id: string; name: string | null; email: string | null;
      declared_phone: string | null; contact_profile_v1: StoredContactProfileV1 }>>`
      SELECT id, name, email, declared_phone, contact_profile_v1 FROM contacts WHERE phone = ${id.phoneE164}
    `;
    expect(row).toBeDefined();
    return row!;
  }
  async function retryLast(text: string) {
    const last = turns.at(-1)!;
    const before = await profile();
    const replay = await runWorkflowTurnV1({ ...id, text,
      externalMessageId: last.externalMessageId, occurredAt: last.occurredAt });
    expect(replay.authorizedMessages).toEqual([]);
    expect(replay.httpExchanges.filter(exchange => exchange.boundary === 'deepseek')).toEqual([]);
    expect((await profile()).contact_profile_v1).toEqual(before.contact_profile_v1);
  }
  return { id, turns, send, profile, retryLast };
}

describe('Agent A canonical contact profile through real workflow and backend', () => {
  it('captures independent compound names from a delivered earlier bubble and exposes each partial field next turn', async () => {
    const c = conversation();
    const opening = await c.send('Hola', () => proposal(['Cómo te llamas?', 'También puedo orientarte con tus dudas.'], {
      move: { schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 1 },
      profile_requests: [{ message_index: 0, fields: ['nombre'], purpose: 'identity', mode: 'collect' }],
    }));
    expect(opening.evidence.authorizedMessages).toHaveLength(2);
    const named = await c.send('Luz María del Sol', context => {
      expect(context.customer.contact_profile?.pending_requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ fields: ['nombre'], purpose: 'identity', mode: 'collect' }),
      ]));
      return proposal(['Gracias, Luz María del Sol.', 'Cuál es tu apellido?'], {
        profile_updates: [observedUpdate(context, 'nombre', 'Luz María del Sol', 'Luz María del Sol')],
        profile_requests: [{ message_index: 1, fields: ['apellido'], purpose: 'identity', mode: 'collect' }],
      });
    });
    expect(named.row.contact_profile_v1.fields.nombre).toMatchObject({ value: 'Luz María del Sol', status: 'confirmed', source: 'agent_a_v1' });
    expect(named.row.contact_profile_v1.fields.apellido.value).toBeNull();
    expect(named.row.name).toBe('Luz María del Sol');
    const completed = await c.send('van der Velde', context => {
      expect(context.customer.contact_intake).toMatchObject({ nombre: 'Luz María del Sol', apellido: null });
      expect(context.capabilities.intake_missing).not.toContain('nombre');
      return proposal(['Gracias por el apellido.'], {
        profile_updates: [observedUpdate(context, 'apellido', 'van der Velde', 'van der Velde')],
      });
    });
    expect(completed.row.name).toBe('Luz María del Sol van der Velde');
    expect(completed.row.contact_profile_v1.fields.apellido).toMatchObject({ value: 'van der Velde', status: 'confirmed' });
    expect(completed.evidence.httpExchanges.filter(exchange => exchange.url.endsWith('/profile'))).toHaveLength(1);
    await c.retryLast('van der Velde');
  });

  it('persists fragmented independent fields, clarifies references, ignores third-party identity and applies explicit corrections and retractions', async () => {
    const c = conversation();
    await c.send('Quiero información', () => proposal(['Me pasas tu nombre, apellido y correo?', 'Seguimos por aquí con tus dudas.'], {
      move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
      profile_requests: [{ message_index: 0, fields: ['nombre', 'apellido', 'correo'], purpose: 'payment', mode: 'collect' }],
    }));
    respond = context => proposal(['Gracias, Noor Layla.'], { profile_updates: [
      observedUpdate(context, 'nombre', 'Noor Layla', 'Noor Layla'),
      observedUpdate(context, 'apellido', 'Al-Haddad', 'Al-Haddad'),
      observedUpdate(context, 'correo', 'NOOR.LAYLA@example.test', 'NOOR.LAYLA@example.test'),
    ] });
    const fragments = await runWorkflowBurstV1({ ...c.id, messages: [
      { text: 'Noor Layla', delayMs: 0 }, { text: 'Al-Haddad', delayMs: 200 },
      { text: 'NOOR.LAYLA@example.test', delayMs: 400 },
    ] });
    expect(fragments.errorCode).toBeNull();
    expect(fragments.commitSucceeded).toBe(true);
    expect(fragments.burst.model_attempt_count).toBe(1);
    const captured = await c.profile();
    expect(captured).toMatchObject({ name: 'Noor Layla Al-Haddad', email: 'noor.layla@example.test' });
    const fieldSources = ['nombre', 'apellido', 'correo'].map(field =>
      captured.contact_profile_v1.fields[field as ContactProfileFieldV1].source_message_id);
    expect(new Set(fieldSources).size).toBe(3);
    const ambiguous = await c.send('Está ahí arriba', () => proposal(['Cuál es el teléfono completo que quieres usar?'], {
      profile_requests: [{ message_index: 0, fields: ['telefono'], purpose: 'identity', mode: 'clarify' }],
    }));
    expect(ambiguous.row.contact_profile_v1).toEqual(captured.contact_profile_v1);
    const thirdParty = await c.send('Mi hermana es Clara Rojas', context => {
      expect(context.customer.contact_intake).toMatchObject({ nombre: 'Noor Layla', apellido: 'Al-Haddad', correo: 'noor.layla@example.test' });
      return proposal(['Quieres que te cuente sobre alguna formación?']);
    });
    expect(thirdParty.row.contact_profile_v1).toEqual(captured.contact_profile_v1);
    const correctionText = 'Mi apellido correcto es al-Khatib';
    const corrected = await c.send(correctionText, context => proposal(['Gracias por aclararlo.'], {
      profile_updates: [observedUpdate(context, 'apellido', 'al-Khatib', 'al-Khatib', 'correct')],
    }));
    expect(corrected.row.name).toBe('Noor Layla al-Khatib');
    expect(corrected.row.contact_profile_v1.fields.nombre).toEqual(captured.contact_profile_v1.fields.nombre);
    expect(corrected.row.contact_profile_v1.version).toBe(captured.contact_profile_v1.version + 1);
    await c.retryLast(correctionText);
    const retracted = await c.send('No uses ese correo', context => proposal(['De acuerdo.'], {
      profile_updates: [observedUpdate(context, 'correo', null, 'No uses ese correo', 'retract')],
    }));
    expect(retracted.row.email).toBeNull();
    expect(retracted.row.contact_profile_v1.fields.correo).toMatchObject({ value: null, status: 'retracted' });
    await c.send('Mi teléfono es +15551234027', context => proposal(['Gracias por aclararlo.'], {
      profile_updates: [observedUpdate(context, 'telefono', '+15551234027', '+15551234027')],
    }));
    await c.send('Gracias', context => {
      expect(context.customer.contact_intake).toMatchObject({ nombre: 'Noor Layla', apellido: 'al-Khatib', correo: null });
      expect(context.capabilities.intake_missing).toContain('correo');
      expect(context.customer.contact_profile?.pending_requests.flatMap(request => request.fields)).not.toContain('telefono');
      return proposal(['Seguimos por aquí.']);
    });
    const calls = await db`SELECT id FROM call_sessions WHERE contact_id = ${retracted.row.id}::uuid`;
    expect(calls).toHaveLength(0);
  });

  it('keeps validated identity through an impossible call repair and dispatches once when its pending requirements arrive', async () => {
    const c = conversation();
    const requested = await c.send('Me llaman? Soy Renée Solé y mi correo es renee@example.test', context => {
      if (context.turn_rejection) {
        expect(context.customer.contact_intake).toMatchObject({ nombre: 'Renée', apellido: 'Solé', correo: 'renee@example.test', telefono: null });
        expect(context.capabilities.intake_missing).not.toContain('nombre');
        expect(context.capabilities.intake_missing).not.toContain('apellido');
        return proposal(['A qué teléfono con código de país y área puedo llamarte?'], {
          move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 },
          profile_requests: [{ message_index: 0, fields: ['telefono'], purpose: 'call', mode: 'collect' }],
        });
      }
      return proposal(['Te llamo ahora.'], {
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        profile_updates: [observedUpdate(context, 'nombre', 'Renée', 'Renée'),
          observedUpdate(context, 'apellido', 'Solé', 'Solé'),
          observedUpdate(context, 'correo', 'renee@example.test', 'renee@example.test')],
      });
    });
    expect(requested.contexts).toHaveLength(2);
    expect(requested.row).toMatchObject({ name: 'Renée Solé', email: 'renee@example.test', declared_phone: null });
    const noCalls = await db`SELECT id FROM call_sessions WHERE contact_id = ${requested.row.id}::uuid`;
    expect(noCalls).toHaveLength(0);
    const phoneText = 'Mi teléfono es +15551234019';
    const ready = await c.send(phoneText, context => proposal(['Solicito la llamada al número que me pasaste.'], {
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      profile_updates: [observedUpdate(context, 'telefono', '+15551234019', '+15551234019')],
    }));
    expect(ready.contexts).toHaveLength(1);
    expect(ready.row.declared_phone).toBe('+15551234019');
    const calls = await db`SELECT id, source_turn_id FROM call_sessions WHERE contact_id = ${requested.row.id}::uuid`;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.source_turn_id).toBe(ready.evidence.turnId);
    expect(ready.evidence.actions.some(action => action.name === 'dispatchCall')).toBe(true);
    await c.retryLast(phoneText);
    expect(await db`SELECT id FROM call_sessions WHERE contact_id = ${requested.row.id}::uuid`).toHaveLength(1);
  });

  it('excludes future-submitted and undelivered questions while still capturing explicit self-owned data', async () => {
    const c = conversation();
    const opened = await c.send('Hola', () => proposal(['Cómo te llamas?', 'Cuál es tu apellido?'], {
      move: { schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 1 },
      profile_requests: [
        { message_index: 0, fields: ['nombre'], purpose: 'identity', mode: 'collect' },
        { message_index: 1, fields: ['apellido'], purpose: 'identity', mode: 'collect' },
      ],
    }));
    const questions = await db<Array<{ id: string; fields: ContactProfileFieldV1[] }>>`
      SELECT m.id, m.metadata->'contact_profile_requests_v1'->0->'fields' AS fields FROM messages m
      JOIN agent_decision_outbound_parts part ON part.message_id = m.id
      WHERE m.contact_id = ${opened.row.id}::uuid AND m.direction = 'outbound'
        AND jsonb_array_length(m.metadata->'contact_profile_requests_v1') > 0
      ORDER BY part.part_index
    `;
    expect(questions).toMatchObject([{ fields: ['nombre'] }, { fields: ['apellido'] }]);
    // Transport records, rather than the position or wording of an assistant
    // message, determine whether a question preceded this inbound answer.
    await db`UPDATE outbound_deliveries SET submitted_at = now() + interval '1 hour'
      WHERE message_id = ${questions[0]!.id}::uuid`;
    await db`UPDATE outbound_deliveries SET state = 'dead_letter', submitted_at = NULL,
      delivered_at = NULL, provider_message_id = NULL WHERE message_id = ${questions[1]!.id}::uuid`;
    const explicit = await c.send('Mi nombre es Nila Soraya', context => {
      expect(context.customer.contact_profile?.pending_requests).toEqual([]);
      return proposal(['Gracias, Nila Soraya.'], {
        profile_updates: [observedUpdate(context, 'nombre', 'Nila Soraya', 'Nila Soraya')],
      });
    });
    expect(explicit.row.name).toBe('Nila Soraya');
    expect(explicit.row.contact_profile_v1.fields.nombre).toMatchObject({ value: 'Nila Soraya', status: 'confirmed' });
    expect(explicit.row.contact_profile_v1.fields.apellido.value).toBeNull();
  });
});
