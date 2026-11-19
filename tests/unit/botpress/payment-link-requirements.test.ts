import { describe, expect, it, vi } from 'vitest';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { validateAgentATurnProposalV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import {
  asksUnmetPaymentLinkRequirementV1, pruneLinkActionWhileMissingRequirementsV1,
} from '../../../botpress-agent/src/lib/conversation/payment-link-requirements';
import { buildAgentABrainInstructionsV1 } from '../../../botpress-agent/src/prompts/agent-a-brain-v1';
import { ClaimedTurnSchema } from '../../../botpress-agent/src/schemas/contracts';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

// Owner rule 2026-11-18, evidence 2/3: «Pasame el link de pago» + «1 solo pago quiero» with
// English named earlier and no level chosen; «Pero mandame el link».
const LEVELS = [1, 2, 3, 4].map((n) => ({ code: `ingles_${n}`, display_name: n === 4 ? 'Inglés IV' : `Inglés ${n}` }));
const ASK_LEVEL = 'Desde qué nivel arrancas: Inglés 1, Inglés 2, Inglés 3 o Inglés IV?';

function context(overrides: { selected?: string | null; plan?: string | null; ready?: boolean } = {}): AgentAContextV1 {
  const selected = overrides.selected ?? null;
  const plan = overrides.plan ?? null;
  const missing = [...(selected === null ? ['course_selection' as const] : []), ...(plan === null ? ['payment_plan' as const] : [])];
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'm1', text: 'Pasame el link de pago' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: selected, selected_payment_plan: plan as never,
      stage: 'exploring', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false,
    },
    obligations: { stage: 'exploring', owes: [], not_yet: [] },
    catalog: {
      available_offerings: LEVELS.map((level) => ({ ...level, fact_id: `offering:${level.code}:name:v1`, area_code: null })),
      selected_offering: null, areas: [], candidate_offerings: [],
      payment_plans: [
        { code: 'monthly_12', fact_id: 'payment:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' },
        { code: 'monthly_6', fact_id: 'payment:monthly_6:label:v1', label: '6 pagos mensuales de USD 60' },
        { code: 'one_time', fact_id: 'payment:one_time:label:v1', label: '1 pago de USD 360' },
      ],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: true,
      authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      action_requirements: [{
        action: 'send_payment_link' as const, ready: missing.length === 0, missing,
        options: { course_selection_kind: 'levels' as const, course_selection: selected === null ? LEVELS : [], payment_plan: plan === null ? ['monthly_12', 'monthly_6', 'one_time'] : [] },
      }],
    },
  } as AgentAContextV1;
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], payment_plan: 'one_time', confidence: 1 },
    response: { messages: [ASK_LEVEL], call_offer: null },
    proposed_action: { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'one_time' },
    course_mentions: [{ offering_code: 'ingles_1', role: 'paid' }],
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
    ...overrides,
  } as AgentATurnProposalV1;
}

const generated = (value: AgentATurnProposalV1) => ({
  proposal: value, provider: 'deepseek-direct' as const, model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 as const,
});
const ID = '00000000-0000-4000-8000-000000000214';
const resolve = (initial: AgentATurnProposalV1, ctx: AgentAContextV1, repair = vi.fn(async () => generated(initial))) =>
  resolveAgentAPlannerlessProposalV2({ initial: generated(initial), context: ctx, repair_enabled: true,
    semantic_rejections: 'blocking', rejection_id: ID, repair }).then((result) => ({ result, repair }));

describe('payment link requirements (owner 2026-11-18)', () => {
  it('evidence 2: a link for a family code without a level, whose reply asks the level, becomes a question', async () => {
    const { result, repair } = await resolve(proposal(), context());
    expect(repair).not.toHaveBeenCalled();
    expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.effective.proposal.response.messages).toEqual([ASK_LEVEL]);
  });

  it('does not adopt a family code as the course when no level was chosen and nothing is asked', () => {
    const ctx = context();
    const rejected = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: ['Listo, te paso el enlace'], call_offer: null } }),
      context: ctx, planned_fact_ids: [], rejection_id: ID,
    });
    expect(rejected?.rejections).toContainEqual({ code: 'COURSE_NOT_RESOLVED', subject: 'course_selection' });
  });

  it('adopts the level when select_course names that exact code in the same turn', () => {
    const chosen = proposal({
      move: { schema_version: 1, move: 'select_course', secondary_moves: ['select_payment_plan'], vetoes: [], course_reference: 'ingles_2', payment_plan: 'one_time', confidence: 1 },
      response: { messages: ['Perfecto, te lo preparo.'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'ingles_2', payment_plan: 'one_time' },
      course_mentions: [{ offering_code: 'ingles_2', role: 'paid' }],
    });
    const rejected = validateAgentATurnProposalV1({ proposal: chosen, context: context(), planned_fact_ids: [], rejection_id: ID });
    expect(rejected?.rejections.map((reason) => reason.code) ?? []).not.toContain('COURSE_NOT_RESOLVED');
    expect(pruneLinkActionWhileMissingRequirementsV1({ proposal: chosen, context: context() })).toBeNull();
  });

  it('evidence 3: «mandame el link» with no action and a level question is not a plan rejection', () => {
    const ask = proposal({ proposed_action: { type: 'none' } });
    expect(asksUnmetPaymentLinkRequirementV1({ proposal: ask, context: context() })).toBe(true);
    const rejected = validateAgentATurnProposalV1({ proposal: ask, context: context(), planned_fact_ids: [], rejection_id: ID });
    expect(rejected?.rejections.map((reason) => reason.code) ?? []).not.toContain('PLAN_NOT_SELECTED');
  });

  it('asks the plan when only the plan is missing', () => {
    const ctx = context({ selected: 'ingles_2' });
    const ask = proposal({
      move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Cómo prefieres pagar: 12 cuotas, 6 cuotas o un solo pago?'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'ingles_2', payment_plan: 'one_time' },
    });
    expect(pruneLinkActionWhileMissingRequirementsV1({ proposal: ask, context: ctx })?.proposed_action).toEqual({ type: 'none' });
  });

  it('a reply that claims the link is sent is never pruned into acceptance', async () => {
    const lying = proposal({ response: { messages: ['Listo, te envío el enlace de pago. Desde qué nivel arrancas?'], call_offer: null } });
    const repair = vi.fn(async () => generated(proposal({ repair_of: { rejection_id: ID, attempt: 1 } })));
    const { result } = await resolve(lying, context(), repair);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective.proposal.response.messages).toEqual([ASK_LEVEL]);
  });

  it('recomputes with the latest state: a chosen level and plan leave nothing to ask', () => {
    const ctx = context({ selected: 'ingles_3', plan: 'monthly_6' });
    expect(asksUnmetPaymentLinkRequirementV1({ proposal: proposal(), context: ctx })).toBe(false);
  });
});

describe('a promise about the link is never a question (architect review)', () => {
  const link = (messages: string[]) => pruneLinkActionWhileMissingRequirementsV1({
    proposal: proposal({ response: { messages, call_offer: null } }), context: context() });
  it.each([
    ['Te preparo el link del curso Inglés 1. Te sirve en 12 cuotas?'],
    ['Ya te genero el enlace, qué nivel?'],
    ['Te armo el link ahora. Desde qué nivel arrancas?'],
  ])('keeps the rejection for %s', (text) => {
    expect(link([text])).toBeNull();
  });
  it('still accepts a plain level question and one that only names the link as a noun in a question', () => {
    expect(link([ASK_LEVEL])).not.toBeNull();
    expect(link(['Para pasarte el link, desde qué nivel arrancas: Inglés 1, Inglés 2, Inglés 3 o Inglés IV?'])).toBeNull();
  });
  it('needs an interrogative sentence that names the first missing item', () => {
    expect(link(['Hay varios niveles de inglés.'])).toBeNull();
  });
});

describe('claim compatibility with the previous bot (v213)', () => {
  const requirement = { action: 'send_payment_link', ready: false, missing: ['course_selection'],
    options: { course_selection_kind: 'levels', course_selection: LEVELS, payment_plan: [] } };
  it('parses the new top-level field and ignores it when absent', () => {
    const parsed = ClaimedTurnSchema.shape.action_requirements.parse([requirement]);
    expect(parsed?.[0]?.options.course_selection).toHaveLength(4);
    expect(ClaimedTurnSchema.shape.action_requirements.parse(undefined)).toBeUndefined();
  });
  it('is a non-strict top-level key, so a bot without it strips it instead of failing', () => {
    const previous = ClaimedTurnSchema.omit({ action_requirements: true });
    expect(previous.shape).not.toHaveProperty('action_requirements');
    expect(Object.keys(ClaimedTurnSchema.shape)).toContain('action_requirements');
    // Zod objects strip unknown keys unless .strict(); the claim object must not be strict.
    expect((ClaimedTurnSchema as unknown as { _def: { unknownKeys?: string } })._def.unknownKeys ?? 'strip').not.toBe('strict');
  });
});

describe('brain prompt v214 requirements contract', () => {
  it('lists the missing items with every option and the same-turn plan rule only when the link lacks something', () => {
    const missing = buildAgentABrainInstructionsV1(context());
    expect(missing).toContain('<pending_payment_link_context>');
    expect(missing).not.toContain('kind="payment_requirements"');
    expect(missing).toContain('ask for the FIRST missing item');
    expect(missing).toContain('Inglés IV (ingles_4)');
    expect(missing).toContain('select_payment_plan');
    expect(missing).toContain('never carry that plan over');
    expect(missing).toContain('Levels of the course the customer named');
    const ready = buildAgentABrainInstructionsV1(context({ selected: 'ingles_2', plan: 'one_time' }));
    expect(ready).not.toContain('pending_payment_link_context');
  });

  it('keeps the pending link as background context during an active call (v215 incident: «oki» during a live call)', () => {
    const live = context();
    live.turn.batch_messages = [{ id: 'm2', text: 'oki' }];
    live.commercial_state.active_call = { call_id: '00000000-0000-4000-8000-000000000001', status: 'in_progress' };
    const prompt = buildAgentABrainInstructionsV1(live);
    expect(prompt).toContain('<pending_payment_link_context>');
    expect(prompt).not.toContain('kind="payment_requirements"');
    expect(prompt).toContain('Background only.');
  });

  it('with an active call and a link request lacking the level, still asks for the level', () => {
    const live = context();
    live.commercial_state.active_call = { call_id: '00000000-0000-4000-8000-000000000001', status: 'in_progress' };
    expect(buildAgentABrainInstructionsV1(live)).toContain('also during a call');
    const pruned = pruneLinkActionWhileMissingRequirementsV1({ proposal: proposal(), context: live });
    expect(pruned?.proposed_action).toEqual({ type: 'none' });
  });

  it('frames the pending link as background, not as a current effect contract, without an active call', () => {
    const prompt = buildAgentABrainInstructionsV1(context());
    expect(prompt).toContain('Background only.');
    expect(prompt).not.toContain('<current_effect_contract kind="payment_requirements">');
  });

  it('keeps «dale» as the answer to a pending payment_confirmation: link still authorized, not an acknowledgement', () => {
    const current = context({ selected: 'ingles_2', plan: 'one_time' });
    current.turn.batch_messages = [{ id: 'm3', text: 'dale' }];
    current.commercial_state.awaiting_reply = 'payment_confirmation';
    current.capabilities.may_send_payment_link = true;
    const prompt = buildAgentABrainInstructionsV1(current);
    expect(prompt).toContain('proposed_action=send_payment_link');
    expect(prompt).not.toMatch(/acknowledgement or greeting/);
  });

});
