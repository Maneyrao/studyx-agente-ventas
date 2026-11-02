import type { TurnRejectionV1 } from '../../../botpress-agent/src/schemas/turn-rejection';
import { describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import type { GeneratedAgentATurnProposalV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { resolveDeterministicRulesTurnV1 } from '../../../botpress-agent/src/lib/conversation/deterministic-rules-turn';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import { TurnEvidencePersistenceError } from '../../../botpress-agent/src/lib/observability/turn-evidence';

const paid = 'introduccion_ecommerce';
const bonus = 'fotografia_celulares_tiendas_online';
const bonusName = 'Fotografía con Celulares para Tiendas Online';
const invitation = 'Si querés, podemos verlo en una llamada corta. Te sirve?';
const rejectionId = '00000000-0000-4000-8000-000000000010';

function context(call = false): AgentAContextV1 {
  return {
    schema_version: 1, identity: null,
    turn: { batch_messages: [{ id: 'current', text: 'me sigue pareciendo caro' }],
      recent_turns: call ? [{ id: 'previous', direction: 'outbound', content: 'Contame qué buscás.' }] : [] },
    customer: { display_name: null, memories: [] },
    commercial_state: { selected_offering_code: paid, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false },
    catalog: { selected_offering: { code: paid, display_name: 'Introducción al Ecommerce',
      area_code: 'marketing', facts: [{ id: `offering:${paid}:name:v1`, kind: 'offering_name', value: 'Introducción al Ecommerce' }] },
      available_offerings: [
        { code: paid, display_name: 'Introducción al Ecommerce', area_code: 'marketing', fact_id: `offering:${paid}:name:v1` },
        { code: bonus, display_name: bonusName, area_code: 'marketing', fact_id: `offering:${bonus}:name:v1` },
      ], candidate_offerings: [], areas: [], payment_plans: [] },
    capabilities: { may_reply: true, may_offer_call: call, may_request_call_now: false,
      may_present_payment_options: false, may_send_payment_link: false, authorized_payment_plan: null,
      intake_status: 'unknown', intake_missing: [],
      course_bonus: { status: 'checkin_available', enabled: true, max_bonus_courses: 3,
        may_offer_bonus: false, may_schedule_checkin: false, may_request_review: false,
        may_accept_offer: false, may_send_promoted_payment: false, promotion_code: null,
        interest_offering_code: paid, bonus_offerings: [],
        ladder: deriveCourseBonusLadderV1({ observed_price_objection_count: 1,
          call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: call }),
        rule_bonus: { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce',
          bonus_offering_code: bonus, display_name: bonusName, position: 1 },
      } },
  };
}

function draft(overrides: Partial<AgentATurnProposalV1> = {}): GeneratedAgentATurnProposalV1 {
  return { provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    proposal: { schema_version: 1,
      move: { schema_version: 1, move: 'ask_course_information', course_reference: paid,
        secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Te cuento las opciones.'], call_offer: null },
      proposed_action: { type: 'none' }, course_mentions: [], confirmed_phone: null,
      profile_updates: [], profile_requests: [], used_fact_ids: [], used_memory_ids: [], repair_of: null,
      memory_candidates: [{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'caro', confidence: 1 }],
      ...overrides } };
}

function offered(call = false): GeneratedAgentATurnProposalV1 {
  return draft({ response: { messages: [`Te sumo ${bonusName} sin costo extra. Avanzamos?`], call_offer: call ? invitation : null },
    proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: bonus },
    course_mentions: [{ offering_code: bonus, role: 'bonus' }] });
}

function resolver(current: AgentAContextV1) {
  return (candidate: GeneratedAgentATurnProposalV1, repair: boolean, rejection = rejectionId) =>
    resolveAgentAPlannerlessProposalV2({ initial: candidate, context: current,
      repair_enabled: repair, rejection_id: rejection, semantic_rejections: 'advisory',
      repair: async () => { throw new Error('unexpected generic repair'); } });
}

describe('live Rule A/B orchestration, bounded rewrite and validated fallback', () => {
  it.each(['second_price_objection', 'price_only_barrier'] as const)('rewrites A and B together once, preserving original evidence (%s)', async trigger => {
    const current = context(true);
    const initial = draft();
    if (trigger === 'price_only_barrier') {
      current.turn.batch_messages = [{ id: 'current', text: 'Sí, sólo el precio me frena.' }];
      current.capabilities.course_bonus!.ladder!.observed_price_objection_count = 0;
      initial.proposal.memory_candidates = [{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed',
        source_quote: 'sólo el precio me frena', confidence: 1 }];
    }
    const rewritten = offered(true);
    const repair = vi.fn<(rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>>(async () => ({ ...rewritten, proposal: { ...rewritten.proposal, memory_candidates: [] } }));
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial,
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(repair.mock.calls[0]?.[0].rejections.map(reason => reason.code)).toEqual(['BONUS_OFFER_REQUIRED', 'CALL_OFFER_REQUIRED']);
    expect(result.record).toMatchObject({ rule_a: 'rewrite', rule_b: 'rewrite' });
    expect(result.resolved.effective.proposal.response.call_offer).toBe(invitation);
    expect(result.resolved.effective.proposal.memory_candidates).toEqual(initial.proposal.memory_candidates);
    expect(result.resolved.effective.proposal.proposed_action.type).toBe('offer_course_bonus');
  });

  it('falls back after an initially presented bonus fails factual validation and its one rewrite fails', async () => {
    const current = context(true);
    const realResolve = resolver(current);
    let initial = true;
    const resolve = vi.fn(async (...args: Parameters<typeof realResolve>) => {
      if (initial) { initial = false; throw new Error('PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:duration'); }
      return realResolve(...args);
    });
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: offered(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve, repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(result.record).toMatchObject({ rule_a: 'fixed', rule_b: 'fixed' });
    expect(result.resolved.effective.proposal.response.messages).toEqual([
      'Dejame revisar qué te puedo ofrecer, dame un segundo.',
      `Te puedo sumar ${bonusName} sin costo; el precio de Introducción al Ecommerce sigue igual. Avanzamos?`,
    ]);
    expect(result.resolved.effective.proposal.response.call_offer).toBeTruthy();
    expect(result.resolved.effective.proposal.memory_candidates).toEqual(draft().proposal.memory_candidates);
  });

  it('uses initial trigger evidence for fallback even if a returned rewrite drops it and fails the required effect', async () => {
    const current = context();
    const repair = vi.fn(async () => draft({ memory_candidates: [] }));
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: draft(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(result.record.rule_a).toBe('fixed');
    expect(result.resolved.effective.proposal.memory_candidates).toEqual(draft().proposal.memory_candidates);
  });

  it.each([false, true])('replaces a rejected immediate-call invitation instead of carrying it into fixed copy (bonus=%s)', async bonusApplies => {
    const current = context(true);
    if (!bonusApplies) current.capabilities.course_bonus!.enabled = false;
    const initial = bonusApplies ? offered() : draft();
    initial.proposal.response.call_offer = 'Te llamo ahora.';
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial,
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(result.record.rule_b).toBe('fixed');
    expect(result.resolved.effective.proposal.response.call_offer)
      .toBe('Si querés, coordinamos una llamada corta para verlo juntos. Te sirve?');
    expect(result.resolved.action_rejection).toBeNull();
    expect(repair).toHaveBeenCalledOnce();
  });

  it('does not claim fixed success if the validator rejects the fixed proposal', async () => {
    const current = context();
    const resolve = vi.fn(async () => { throw new Error('validator rejects'); });
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    await expect(resolveDeterministicRulesTurnV1({ context: current, initial: draft(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve, repair })).rejects.toThrow('validator rejects');
    expect(repair).toHaveBeenCalledOnce();
  });

  it('never converts an evidence-persistence failure into another paid generation or a fixed reply', async () => {
    const current = context();
    const repair = vi.fn(async () => offered());
    const resolve = vi.fn(async () => { throw new TurnEvidencePersistenceError(); });
    await expect(resolveDeterministicRulesTurnV1({ context: current, initial: draft(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve, repair })).rejects.toBeInstanceOf(TurnEvidencePersistenceError);
    expect(repair).not.toHaveBeenCalled();
  });
});
