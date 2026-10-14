import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
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
let phase: 'course' | 'agus_course' | 'missing_identity' | 'identity' | 'agus_identity' | 'confirm' | 'invalid_repair' = 'course';
let generationCount = 0;
let latestContext: {
  customer: { contact_intake?: { nombre: string | null; apellido: string | null; correo: string | null } };
  turn_rejection?: { rejection_id: string };
} | null = null;

function proposal(text: string, action: AgentATurnProposalV1['proposed_action'] = { type: 'none' }): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text] }, proposed_action: action,
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
    if (target.origin === backend.origin) return localFetch(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_CALL');
    generationCount += 1;
    const instructions = JSON.parse(String(init?.body)).instructions as string;
    const serialized = instructions.match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    latestContext = JSON.parse(serialized) as NonNullable<typeof latestContext>;
    const rejection = latestContext.turn_rejection;
    const result = phase === 'course' || phase === 'agus_course'
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
    if (rejection) result.repair_of = { rejection_id: rejection.rejection_id, attempt: 1 };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

it('persists Agus data from separate messages before accepting Sii and reserves exactly one call', async () => {
  const id = { conversationId: `agus-call-${randomUUID()}`, userId: `agus-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  phase = 'agus_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Oratoria.' })).commitSucceeded).toBe(true);
  phase = 'missing_identity';
  const requested = await runWorkflowTurnV1({ ...id, text: 'Me podes llamar?' });
  expect(requested.authorizedMessages.join(' ')).toContain('nombre, apellido y teléfono');
  phase = 'agus_identity';
  const intake = await runWorkflowBurstV1({ ...id, messages: [
    { text: 'así es, mi nombre es Agus', delayMs: 0 },
    { text: 'maneyro', delayMs: 200 },
    { text: 'Mi teléfono es +15551234567', delayMs: 400 },
  ] });
  expect(intake.errorCode).toBeNull();
  expect(intake.commitSucceeded).toBe(true);
  expect(latestContext?.customer.contact_intake).toMatchObject({ nombre: 'Agus', apellido: 'Maneyro' });
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
  expect(latestContext?.customer.contact_intake).toMatchObject({ nombre: 'Juan', apellido: 'Perez', correo: null });
  expect(persisted.state).toMatchObject({ callPreference: 'call', callOfferStatus: 'accepted' });

  phase = 'confirm';
  const confirmed = await runWorkflowTurnV1({ ...id, text: 'Sí, puedo atender ahora, llámame.' });
  expect(confirmed.errorCode).toBeNull();
  expect(confirmed.commitSucceeded).toBe(true);
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

it('emits one bounded technical notice when the model repeats the false call promise during repair', async () => {
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
    generation_attempts: 2, failure_stage: 'proposal_validation', action_status: 'rejected',
  });
});
