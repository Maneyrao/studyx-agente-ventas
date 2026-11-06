import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { CommercialTurnPlanV1 } from '../../botpress-agent/src/schemas/agent-a-commercial-plan';
import { runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

// Real production workflow, signed HTTP, PostgreSQL and delivery authorization,
// with the model-owned planning pass enabled (owner decision 2026-11-06).
// Only external model generation and the final delivery client are controlled.
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
const db = openLocalTestDatabase();
const previousKey = secrets.DEEPSEEK_API_KEY;
const previousPlanning = configuration.agentACommercialPlanningEnabled;
const writerCalls: Array<{ context: AgentAContextV1; instructions: string }> = [];
let plannerCalls = 0;
let plannerReply: () => Response;
let writerFailuresLeft = 0;
let respond: (context: AgentAContextV1) => AgentATurnProposalV1;

const PLAN: CommercialTurnPlanV1 = {
  current_move: 'ask_payment_options',
  current_request: 'Pregunta por cuotas.',
  course_focus: 'ingles_1',
  customer_goal: null,
  pending_confirmations: [],
  known_information: ['Le interesa Inglés 1'],
  answered_discovery_topics: [],
  ignored_or_closed_topics: [],
  forbidden_repetitions: ['Volver a presentar Inglés 1'],
  next_commercial_move: 'value',
  response_obligations: ['Responder los planes canónicos'],
  proposed_effect_intent: 'none',
  contact_data_purpose: 'none',
};

const output = (value: unknown) => new Response(JSON.stringify({
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, fixture: true,
}), { headers: { 'content-type': 'application/json' } });

function proposal(message: string, extra: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [message] }, proposed_action: { type: 'none' },
    profile_updates: [], profile_requests: [], course_mentions: [], used_fact_ids: [],
    used_memory_ids: [], memory_candidates: [], repair_of: null, ...extra,
  };
}

const identity = () => ({
  conversationId: `commercial-plan-${randomUUID()}`, userId: randomUUID(),
  phoneE164: `+999${randomUUID().replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`,
  providerMode: 'fixture' as const,
});

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  const localFetch = globalThis.fetch;
  expect((await localFetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  configuration.agentACommercialPlanningEnabled = true;
  secrets.DEEPSEEK_API_KEY = 'offline-commercial-plan-fixture';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return localFetch(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_COMMERCIAL_PLAN_REQUEST');
    const body = JSON.parse(String(init?.body)) as { instructions: string; text: { format: { name: string } } };
    if (body.text.format.name === 'studyx_agent_a_commercial_turn_plan_v1') {
      plannerCalls += 1;
      expect(body.instructions).toContain('<commercial_turn_planning>');
      return plannerReply();
    }
    const serialized = body.instructions.match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    const context = JSON.parse(serialized) as AgentAContextV1;
    writerCalls.push({ context, instructions: body.instructions });
    if (writerFailuresLeft > 0) {
      writerFailuresLeft -= 1;
      return new Response('{}', { status: 503 });
    }
    const generated = respond(context);
    return output({ ...generated, repair_of: context.turn_rejection
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  configuration.agentACommercialPlanningEnabled = previousPlanning;
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
  await db.end();
});

it('plans once per turn, hands the plan to the writer and reuses it in the backend repair', async () => {
  const id = identity();
  plannerReply = () => output(PLAN);
  respond = () => proposal('Te puedo orientar sobre Inglés 1.', {
    move: { schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [], confidence: 1, course_reference: 'ingles_1' },
    used_fact_ids: ['offering:ingles_1:name:v1'],
  });
  const selected = await runWorkflowTurnV1({ ...id, text: 'Me interesa Inglés 1.' });
  expect(selected.errorCode).toBeNull();
  expect(plannerCalls).toBe(1);
  expect(writerCalls.at(-1)!.instructions).toContain('<commercial_turn_plan>');

  const falseClaim = 'Puedes pagar en 2 cuotas de USD 60.';
  const repairedAnswer = 'Los planes son 12 pagos de USD 30, 6 pagos de USD 60 o un pago único de USD 360.';
  const plannerBefore = plannerCalls;
  const writersBefore = writerCalls.length;
  respond = context => context.turn_rejection
    ? proposal(repairedAnswer, { used_fact_ids: ['offering:ingles_1:name:v1',
      'payment:ingles_1:monthly_12:label:v1', 'payment:ingles_1:monthly_6:label:v1', 'payment:ingles_1:one_time:label:v1'] })
    : proposal(falseClaim, { used_fact_ids: ['payment:ingles_1:monthly_6:label:v1'] });
  const repaired = await runWorkflowTurnV1({ ...id, text: '¿Puedo pagarlo en 2 cuotas?' });
  expect(repaired.errorCode, JSON.stringify(repaired.httpExchanges.filter(exchange => exchange.status !== 200))).toBeNull();
  expect(repaired.authorizedMessages).toEqual([repairedAnswer]);
  // One planning request for the turn; the repair reuses the first draft plan.
  expect(plannerCalls - plannerBefore).toBe(1);
  const turnWriters = writerCalls.slice(writersBefore);
  expect(turnWriters).toHaveLength(2);
  expect(turnWriters[1]!.context.turn_rejection).toBeTruthy();
  for (const writer of turnWriters) {
    expect(writer.instructions).toContain('<commercial_turn_plan>');
    expect(writer.instructions).toContain(JSON.stringify(PLAN.forbidden_repetitions));
  }
});

it('never stays silent when the planning pass fails: the single-pass writer answers', async () => {
  const id = identity();
  plannerReply = () => new Response('{}', { status: 503 });
  const answer = 'Hola, soy Emma, asesora de Studyx. Qué te gustaría aprender?';
  respond = () => proposal(answer, {
    move: { schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 1 },
  });
  const plannerBefore = plannerCalls;
  const writersBefore = writerCalls.length;
  const turn = await runWorkflowTurnV1({ ...id, text: 'Hola' });
  expect(turn.errorCode).toBeNull();
  expect(turn.authorizedMessages).toEqual([answer]);
  expect(plannerCalls - plannerBefore).toBe(1);
  expect(writerCalls.slice(writersBefore)).toHaveLength(1);
  expect(writerCalls.at(-1)!.instructions).not.toContain('<commercial_turn_plan>');
});

it('does not plan again when the workflow retries a failed first writer request', async () => {
  const id = identity();
  plannerReply = () => output(PLAN);
  writerFailuresLeft = 1;
  const answer = 'Hola, soy Emma, asesora de Studyx. Qué te gustaría aprender?';
  respond = () => proposal(answer, {
    move: { schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 1 },
  });
  const plannerBefore = plannerCalls;
  const writersBefore = writerCalls.length;
  const turn = await runWorkflowTurnV1({ ...id, text: 'Hola' });
  expect(turn.errorCode).toBeNull();
  expect(turn.authorizedMessages).toEqual([answer]);
  // One planning request per turn: the provider retry reuses nothing and never re-plans.
  expect(plannerCalls - plannerBefore).toBe(1);
  expect(writerCalls.slice(writersBefore)).toHaveLength(2);
});
