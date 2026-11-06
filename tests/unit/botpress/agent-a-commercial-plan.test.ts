import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateCommercialTurnPlanV1,
  generateDeepSeekAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import {
  buildAgentABrainInstructionsV1,
  buildAgentACommercialPlanInstructionsV1,
  writerCatalogPresentationV1,
} from '../../../botpress-agent/src/prompts/agent-a-brain-v1';
import { AgentAContextV1Schema, type AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  COMMERCIAL_TURN_PLAN_JSON_SCHEMA,
  CommercialTurnPlanV1Schema,
  type CommercialTurnPlanV1,
} from '../../../botpress-agent/src/schemas/agent-a-commercial-plan';

/**
 * Fixtures: the exact DeepSeek instructions Agent A sent for case 47 g03/g06
 * at 7f1eebf (acceptance-7f1eebf-case47-context-order-20261106, calls 0006 and
 * 0009), plus one real two-pass recording of the implemented code on those
 * contexts (deepseek-v4-flash, 2026-11-06). Replay proves request composition
 * deterministically; live golden runs prove behavior.
 */
interface Fixture {
  readonly instructions: string;
  readonly customer_messages: readonly string[];
  readonly original_response: { response: { messages: string[] } };
  readonly recorded_two_pass: { planner_output_text: string; writer_output_text: string };
}
const fixture = (turn: 'g03' | 'g06'): Fixture =>
  JSON.parse(readFileSync(`tests/fixtures/agent-a-commercial-plan/case47-${turn}.json`, 'utf8')) as Fixture;
const contextOf = (value: Fixture): AgentAContextV1 => AgentAContextV1Schema.parse(JSON.parse(
  value.instructions.split('<authorized_context>\n')[1]!.split('\n</authorized_context>')[0]!));

const responses = (value: unknown) => new Response(JSON.stringify({
  output: [{ type: 'message', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } },
}), { status: 200, headers: { 'content-type': 'application/json' } });

type Call = { name: string; instructions: string; input: string };
function scripted(...replies: Array<Response | (() => Promise<Response>)>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ name: body.text.format.name, instructions: body.instructions, input: body.input });
    const next = replies.shift();
    if (!next) throw new Error('UNEXPECTED_PROVIDER_REQUEST');
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

const PLAN: CommercialTurnPlanV1 = {
  current_request: 'Aclara que empieza de cero.',
  course_focus: 'real_estate',
  customer_goal: null,
  known_information: ['Empieza de cero'],
  answered_discovery_topics: ['Nivel: desde cero'],
  ignored_or_closed_topics: ['Trabajar con inmobiliaria o invertir: sin responder'],
  forbidden_repetitions: ['Preguntar si es para trabajar con inmobiliaria o invertir'],
  next_commercial_move: 'value',
  response_obligations: ['Confirmar que sirve desde cero', 'Cierre de prueba suave'],
  proposed_effect_intent: 'none',
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('CommercialTurnPlanV1 contract', () => {
  it('requires exactly the planning fields on the wire and in the parser', () => {
    expect([...COMMERCIAL_TURN_PLAN_JSON_SCHEMA.required].sort())
      .toEqual(Object.keys(CommercialTurnPlanV1Schema.shape).sort());
    expect(CommercialTurnPlanV1Schema.parse(PLAN)).toEqual(PLAN);
    expect(CommercialTurnPlanV1Schema.safeParse({ ...PLAN, authorized_effect: 'send_payment_link' }).success).toBe(false);
    expect(CommercialTurnPlanV1Schema.safeParse({ ...PLAN, next_commercial_move: 'discount' }).success).toBe(false);
  });

  it('plans over the complete catalog and returns the planning schema, not a proposal', async () => {
    const context = contextOf(fixture('g03'));
    const calls = scripted(responses(PLAN));
    const result = await generateCommercialTurnPlanV1({ context, apiKey: 'fixture', signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'planned', plan: PLAN, failure_code: null });
    expect(calls[0]!.name).toBe('studyx_agent_a_commercial_turn_plan_v1');
    expect(calls[0]!.instructions).toBe(buildAgentACommercialPlanInstructionsV1(context));
    expect(calls[0]!.instructions.startsWith(buildAgentABrainInstructionsV1(context))).toBe(true);
    expect(calls[0]!.instructions).toContain('<commercial_turn_planning>');
    expect(calls[0]!.instructions).not.toContain('<commercial_turn_plan>');
    expect(context.catalog.available_offerings).toHaveLength(57);
    for (const offering of context.catalog.available_offerings) expect(calls[0]!.instructions).toContain(`"code":"${offering.code}"`);
  });

  it('drops an unknown course focus without discarding the rest of the reading', async () => {
    scripted(responses({ ...PLAN, course_focus: 'curso_inventado' }));
    const result = await generateCommercialTurnPlanV1({ context: contextOf(fixture('g03')), apiKey: 'fixture',
      signal: new AbortController().signal });
    expect(result.plan).toEqual({ ...PLAN, course_focus: null });
  });

  it.each([
    ['PLANNER_HTTP_500', () => new Response('{}', { status: 500 })],
    ['PLANNER_INVALID_JSON', () => responses('not json')],
    ['PLANNER_INVALID_SCHEMA', () => responses({ current_request: 'x' })],
    ['PLANNER_NETWORK_ERROR', () => { throw new TypeError('fetch failed'); }],
  ])('returns no plan and never throws on %s', async (code, reply) => {
    scripted(async () => reply());
    const events: unknown[] = [];
    const result = await generateCommercialTurnPlanV1({ context: contextOf(fixture('g03')), apiKey: 'fixture',
      signal: new AbortController().signal, observe: event => events.push(event) });
    expect(result).toMatchObject({ status: 'failed', plan: null, failure_code: code });
    expect(events).toEqual([expect.objectContaining({ kind: 'commercial_plan', status: 'failed', failure_code: code })]);
  });

  it('times out the planning pass on its own deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const result = await generateCommercialTurnPlanV1({ context: contextOf(fixture('g03')), apiKey: 'fixture',
      signal: new AbortController().signal, timeout_ms: 20 });
    expect(result).toMatchObject({ plan: null, failure_code: 'PLANNER_TIMEOUT' });
  });
});

describe('two-pass generation', () => {
  it('falls back to the exact single-pass writer request when planning fails: never silence', async () => {
    const value = fixture('g03');
    const context = contextOf(value);
    const calls = scripted(new Response('{}', { status: 503 }), responses(value.original_response));
    const result = await generateDeepSeekAgentATurnProposalV1({ context, apiKey: 'fixture',
      signal: new AbortController().signal, commercial_planning: true });
    expect(calls.map(call => call.name)).toEqual(['studyx_agent_a_commercial_turn_plan_v1', 'studyx_agent_a_turn_proposal_v1']);
    // Byte-identical to today's request saved by the 7f1eebf golden run.
    expect(calls[1]!.instructions).toBe(value.instructions);
    expect(result.proposal.response.messages.length).toBeGreaterThan(0);
    expect(result.commercial_plan).toBeUndefined();
    expect(result.planner_requests).toBe(1);
    expect(result).toMatchObject({ planner_status: 'failed', planner_failure_code: 'PLANNER_HTTP_503' });
  });

  it('keeps today\'s single request when planning is not enabled', async () => {
    const value = fixture('g06');
    const calls = scripted(responses(value.original_response));
    await generateDeepSeekAgentATurnProposalV1({ context: contextOf(value), apiKey: 'fixture', signal: new AbortController().signal });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.instructions).toBe(value.instructions);
  });

  it('reuses the first draft plan in a repair and never plans again', async () => {
    const value = fixture('g03');
    const context: AgentAContextV1 = { ...contextOf(value), commercial_plan: PLAN, turn_rejection: {
      schema_version: 1, rejection_id: '00000000-0000-4000-8000-000000000047', attempt: 1,
      rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'offering_not_canonical' }],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] } } };
    const repaired = { ...value.original_response, repair_of: { rejection_id: context.turn_rejection!.rejection_id, attempt: 1 } };
    const calls = scripted(responses(repaired));
    const result = await generateDeepSeekAgentATurnProposalV1({ context, apiKey: 'fixture',
      signal: new AbortController().signal, commercial_planning: true });
    expect(calls.map(call => call.name)).toEqual(['studyx_agent_a_turn_proposal_v1']);
    expect(calls[0]!.instructions).toContain('<commercial_turn_plan>');
    expect(calls[0]!.instructions).toContain('<mandatory_repair');
    expect(result.commercial_plan).toEqual(PLAN);
    expect(result.planner_requests).toBeUndefined();
  });

  it('does not plan a conversation-only continuation', async () => {
    const value = fixture('g06');
    const context = { ...contextOf(value), turn_rejection: {
      schema_version: 1 as const, rejection_id: '00000000-0000-4000-8000-000000000048', attempt: 1 as const,
      rejections: [{ code: 'ACTION_NOT_AUTHORIZED' as const, subject: 'action' }],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] } } };
    const calls = scripted(responses({ ...value.original_response, proposed_action: { type: 'none' },
      repair_of: { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } }));
    await generateDeepSeekAgentATurnProposalV1({ context, apiKey: 'fixture', signal: new AbortController().signal,
      conversation_only: true, commercial_planning: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.instructions).not.toContain('<commercial_turn_plan>');
  });
});

describe('writer catalog view', () => {
  it('shows the focus, candidates and package identities; validation context keeps all 57', () => {
    const context: AgentAContextV1 = { ...contextOf(fixture('g03')), commercial_plan: PLAN };
    const view = writerCatalogPresentationV1(context);
    expect(view.available_offerings.map(offering => offering.code)).toContain('real_estate');
    expect(view.available_offerings.length).toBeLessThan(context.catalog.available_offerings.length);
    expect(view.omitted_offerings_count).toBe(context.catalog.available_offerings.length - view.available_offerings.length);
    for (const candidate of context.capabilities.course_bonus?.bonus_candidates ?? []) {
      expect(view.available_offerings.map(offering => offering.code)).toContain(candidate.code);
    }
    expect(context.catalog.available_offerings).toHaveLength(57);
  });

  it('keeps the complete catalog without a plan, without a valid focus, or while resolution is open', () => {
    const base = contextOf(fixture('g03'));
    expect(writerCatalogPresentationV1(base)).toBe(base.catalog);
    expect(writerCatalogPresentationV1({ ...base, commercial_plan: { ...PLAN, course_focus: null } })).toBe(base.catalog);
    expect(writerCatalogPresentationV1({ ...base, commercial_plan: { ...PLAN, course_focus: 'no_existe' } })).toBe(base.catalog);
    const open = { ...base, commercial_plan: PLAN, catalog: { ...base.catalog, resolution: 'ambiguous' as const } };
    expect(writerCatalogPresentationV1(open)).toBe(open.catalog);
    const unavailable = { ...base, commercial_plan: PLAN, catalog: { ...base.catalog, resolution: 'unavailable' as const } };
    expect(writerCatalogPresentationV1(unavailable)).toBe(unavailable.catalog);
  });

  it.each(['discover', 'promo', 'objection'] as const)(
    'keeps every active course when the model plans %s (options, gifts and alternatives)', (move) => {
      const context = { ...contextOf(fixture('g03')), commercial_plan: { ...PLAN, next_commercial_move: move } };
      expect(writerCatalogPresentationV1(context)).toBe(context.catalog);
    });
});

describe('deterministic replay of case 47 g03 and g06 (recorded real two-pass outputs)', () => {
  it.each(['g03', 'g06'] as const)('%s: the writer receives the model plan before canonical behavior', async (turn) => {
    const value = fixture(turn);
    const context = contextOf(value);
    const calls = scripted(responses(value.recorded_two_pass.planner_output_text),
      responses(value.recorded_two_pass.writer_output_text));
    const result = await generateDeepSeekAgentATurnProposalV1({ context, apiKey: 'fixture',
      signal: new AbortController().signal, commercial_planning: true });
    const plan = CommercialTurnPlanV1Schema.parse(JSON.parse(value.recorded_two_pass.planner_output_text));
    expect(calls.map(call => call.name)).toEqual(['studyx_agent_a_commercial_turn_plan_v1', 'studyx_agent_a_turn_proposal_v1']);
    const batch = JSON.stringify(context.turn.batch_messages.map(message => message.text));
    expect(calls.every(call => call.input.includes(batch))).toBe(true);
    const writer = calls[1]!.instructions;
    expect(writer).toBe(buildAgentABrainInstructionsV1({ ...context, commercial_plan: plan }));
    expect(writer.indexOf('<commercial_turn_plan>')).toBeGreaterThan(writer.indexOf('</execution_consistency_check>'));
    expect(writer.indexOf('<commercial_turn_plan>')).toBeLessThan(writer.indexOf('<canonical_sales_behavior'));
    expect(writer).toContain('"omitted_offerings_count"');
    expect(plan.course_focus).toBe('real_estate');
    expect(plan.forbidden_repetitions.join(' ')).toMatch(/inmobiliaria/u);
    expect(result.commercial_plan).toEqual(plan);
    expect(result.token_usage?.total_tokens).toBe(30);
    // The saved single-pass reply re-asked; the recorded two-pass reply does not.
    expect(value.original_response.response.messages.join(' ')).toMatch(/inmobiliaria[^?]*invert[^?]*\?/u);
    expect(result.proposal.response.messages.join(' ')).not.toMatch(/inmobiliaria[^?]*invert[^?]*\?/u);
  });
});
