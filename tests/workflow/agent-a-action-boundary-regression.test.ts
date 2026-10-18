import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { contactFixtureUpdatesV1 } from './contact-profile-fixture';
import { runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

// Sanitized reproductions of the two production failures. The complete
// workflow, backend and PostgreSQL boundary are real; only Agent A generation
// is deterministic and no external voice/payment provider is contacted.
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
const databaseUrl = process.env.TEST_DATABASE_URL!;
const db = openLocalTestDatabase();
const previousKey = secrets.DEEPSEEK_API_KEY;

type Phase = 'call_offer' | 'call_profile' | 'call_accept'
  | 'payment_course' | 'payment_profile' | 'payment_without_plan' | 'payment_with_plan'
  | 'payment_safe_retry_exhaustion';
let phase: Phase = 'call_offer';
let latestContext: AgentAContextV1 | null = null;

function proposal(
  text: string,
  move: AgentATurnProposalV1['move']['move'] = 'unknown',
  action: AgentATurnProposalV1['proposed_action'] = { type: 'none' },
): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move, secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text], call_offer: null },
    proposed_action: action,
    profile_updates: [], profile_requests: [],
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
  };
}

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.port).toMatch(/^32\d\d$/u);
  expect((await fetch(`${apiBaseUrl}/api/ready`)).ok).toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'action-boundary-fixture';
  const localFetch = globalThis.fetch;

  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return localFetch(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_CALL');

    const requestBody = JSON.parse(String(init?.body));
    const serialized = String(requestBody.instructions)
      .match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    latestContext = JSON.parse(serialized) as AgentAContextV1;
    const rejection = latestContext.turn_rejection;
    const conversationOnly = requestBody.text.format.schema.properties.proposed_action.anyOf.length === 1;

    let result: AgentATurnProposalV1;
    if (conversationOnly || rejection) {
      result = phase === 'payment_without_plan'
        ? proposal('Qué plan prefieres: 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360?', 'ask_payment_options')
        : phase === 'payment_safe_retry_exhaustion'
          ? proposal('Te recomiendo revisar primero las alternativas de pago para elegir bien.', 'request_payment_link')
          : proposal('Para coordinarla, me compartes sólo los datos que faltan?', 'request_call');
      result.repair_of = rejection
        ? { rejection_id: rejection.rejection_id, attempt: 1 }
        : null;
    } else if (phase === 'call_offer') {
      result = proposal('Oratoria te ayuda a comunicar tus ideas con más claridad.', 'select_course');
      result.move = { ...result.move, course_reference: 'Oratoria' };
      result.response.call_offer = 'Si quieres, puedo llamarte y explicarte cómo empezar.';
      result.used_fact_ids = ['offering:oratoria:name:v1'];
    } else if (phase === 'call_profile') {
      result = proposal('Ya tengo tus datos. Avísame cuando puedas atender.', 'provide_contact_details');
    } else if (phase === 'call_accept') {
      result = proposal('Te llamo ahora.', 'request_call', {
        type: 'request_call_now', reason: 'accepted_offer',
      });
    } else if (phase === 'payment_course') {
      result = proposal('Inglés 1 es el curso que elegiste.', 'select_course');
      result.move = { ...result.move, course_reference: 'ingles_1' };
      result.used_fact_ids = ['offering:ingles_1:name:v1'];
    } else if (phase === 'payment_profile') {
      result = proposal('Ya tengo tus datos.', 'provide_contact_details');
    } else if (phase === 'payment_without_plan') {
      result = proposal('Te dejo el enlace de pago.', 'request_payment_link', {
        type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'monthly_12',
      });
    } else if (phase === 'payment_safe_retry_exhaustion') {
      result = proposal(
        'Primero comparemos las opciones de pago para elegir la que mejor te quede.',
        'request_payment_link',
      );
    } else {
      result = proposal('Te dejo el enlace de 12 pagos.', 'select_payment_plan', {
        type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'monthly_12',
      });
      result.move = { ...result.move, secondary_moves: ['request_payment_link'], payment_plan: 'monthly_12' };
      result.used_fact_ids = ['payment:ingles_1:monthly_12:label:v1'];
    }

    if (phase === 'call_profile') {
      result.profile_updates = contactFixtureUpdatesV1(latestContext, [
        { field: 'nombre', value: 'Thiago' }, { field: 'apellido', value: 'Sukas' },
        { field: 'telefono', value: '+15551234567' },
      ]);
    }
    if (phase === 'payment_profile') {
      result.profile_updates = contactFixtureUpdatesV1(latestContext, [
        { field: 'nombre', value: 'Thiago' }, { field: 'apellido', value: 'Sukas' },
        { field: 'correo', value: 'thiago@example.test' }, { field: 'telefono', value: '+15551234567' },
      ]);
    }

    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

it('accepts "dale de una" against the open offer and reserves one call in that turn', async () => {
  const id = {
    conversationId: `action-boundary-call-${randomUUID()}`,
    userId: `action-boundary-call-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
    providerMode: 'fixture' as const,
  };
  phase = 'call_offer';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Oratoria' })).commitSucceeded).toBe(true);
  phase = 'call_profile';
  expect((await runWorkflowTurnV1({ ...id,
    text: 'Soy Thiago Sukas y mi teléfono es +15551234567' })).commitSucceeded).toBe(true);
  phase = 'call_accept';
  const accepted = await runWorkflowTurnV1({ ...id, text: 'dale de una' });

  const calls = await db<Array<{ id: string; source_turn_id: string }>>`
    SELECT cs.id, cs.source_turn_id FROM call_sessions cs
    JOIN contacts c ON c.id = cs.contact_id WHERE c.phone = ${id.phoneE164}
  `;
  const diagnostics = await db<Array<{ diagnostics: { failure_codes?: string[] } | null }>>`
    SELECT diagnostics FROM agent_decisions WHERE trace_id = ${accepted.traceId}::uuid
  `;
  expect(accepted.commitSucceeded).toBe(true);
  expect(accepted.actions.filter((action) => action.name === 'dispatchCall')).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.source_turn_id).toBe(accepted.turnId);
  expect(diagnostics[0]?.diagnostics).not.toMatchObject({
    failure_codes: expect.arrayContaining(['ACTION_NOT_AUTHORIZED']),
  });
  expect(accepted.authorizedMessages.join(' ')).not.toMatch(/no (?:puedo|pude).*llamada/iu);
});

it('asks for a plan without MODEL_UNAVAILABLE, then emits exactly one payment link', async () => {
  const id = {
    conversationId: `action-boundary-payment-${randomUUID()}`,
    userId: `action-boundary-payment-${randomUUID()}`,
    phoneE164: `+999${String(Date.now() + 1).slice(-10)}`,
    providerMode: 'fixture' as const,
  };
  phase = 'payment_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1' })).commitSucceeded).toBe(true);
  phase = 'payment_profile';
  expect((await runWorkflowTurnV1({ ...id,
    text: 'Soy Thiago Sukas, thiago@example.test, +15551234567' })).commitSucceeded).toBe(true);
  phase = 'payment_without_plan';
  const missingPlan = await runWorkflowTurnV1({ ...id, text: 'inglés, dame el pago' });
  let evidence = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(missingPlan.commitSucceeded).toBe(true);
  expect(missingPlan.authorizedMessages.join(' ')).toMatch(/qu[eé] plan prefieres/iu);
  expect(evidence.decisions.at(-1)?.reasonCode).not.toBe('MODEL_UNAVAILABLE');
  expect(evidence.decisions.filter((item) => item.businessActionType === 'send_payment_link')).toHaveLength(0);

  phase = 'payment_with_plan';
  const paid = await runWorkflowTurnV1({ ...id, text: '12 pagos, pásame el link' });
  evidence = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId });
  expect(paid.commitSucceeded).toBe(true);
  expect(paid.authorizedMessages.join(' ')).toContain('https://buy.stripe.com/local-eval-12m');
  expect(evidence.decisions.filter((item) => item.businessActionType === 'send_payment_link')).toHaveLength(1);
});

it('keeps a safe Agent A reply when payment-plan guidance remains after its single repair', async () => {
  const id = {
    conversationId: `action-boundary-payment-safe-${randomUUID()}`,
    userId: `action-boundary-payment-safe-${randomUUID()}`,
    phoneE164: `+999${String(Date.now() + 2).slice(-10)}`,
    providerMode: 'fixture' as const,
  };
  phase = 'payment_course';
  expect((await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1' })).commitSucceeded).toBe(true);
  phase = 'payment_profile';
  expect((await runWorkflowTurnV1({
    ...id,
    text: 'Soy Thiago Sukas, thiago@example.test, +15551234567',
  })).commitSucceeded).toBe(true);
  phase = 'payment_safe_retry_exhaustion';

  const result = await runWorkflowTurnV1({
    ...id,
    text: 'buenas\nme das el pago\ncual me recomendas entonces?',
  });
  const evidence = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: id.conversationId,
  });

  expect(result.commitSucceeded).toBe(true);
  expect(result.authorizedMessages).toEqual([
    'Primero comparemos las opciones de pago para elegir la que mejor te quede.',
  ]);
  expect(evidence.decisions.at(-1)?.reasonCode).not.toBe('AGENT_A_VALIDATION_EXHAUSTED');
  expect(evidence.decisions.filter((item) => item.businessActionType === 'send_payment_link')).toHaveLength(0);
  expect(result.authorizedMessages.join(' ')).not.toMatch(/https?:\/\//iu);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
  await db.end();
});
