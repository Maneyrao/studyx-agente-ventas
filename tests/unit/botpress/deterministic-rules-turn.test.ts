import { bindCustomerCallInterpretationV1 } from '../../../botpress-agent/src/lib/conversation/customer-call-interpretation';
import { continueAgentAAfterActionFeedbackV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { TurnRejectionV1 } from '../../../botpress-agent/src/schemas/turn-rejection';
import { describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import type { GeneratedAgentATurnProposalV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { decideDeterministicRulesV1, finalizeDeterministicRulesCandidateV1, resolveDeterministicRulesTurnV1 } from '../../../botpress-agent/src/lib/conversation/deterministic-rules-turn';
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

// Owner 2026-11-03: one question per turn; a gift turn carries no Rule B invitation.
describe('live Rule A/B orchestration, bounded rewrite and validated fallback', () => {
  it('permits a model correction unknown → request_call grounded in the current explicit request, leaving backend permissions intact', async () => {
    const current = context(true);
    current.turn.batch_messages = [{ id: 'current', text: 'Por favor llamame ahora' }];
    current.capabilities.may_request_call_now = true;
    current.capabilities.intake_status = 'known';
    const initial = draft({ memory_candidates: [] });
    initial.proposal.move.move = 'unknown';
    const corrected = draft({ memory_candidates: [], proposed_action: { type: 'request_call_now', reason: 'direct_request' } });
    corrected.proposal.move.move = 'request_call';
    const repair = vi.fn(async () => corrected);
    const rejection: TurnRejectionV1 = { schema_version: 1, rejection_id: rejectionId, attempt: 1,
      rejections: [{ code: 'ACTION_NOT_AUTHORIZED', subject: 'request_call_now' }],
      authorized_alternatives: { actions: ['none', 'request_call_now'], fact_ids: [], missing_information: [] } };
    const continued = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      customer_call_interpretation: initial.proposal.move, effects_allowed: true,
      apiKey: 'fixture', signal: new AbortController().signal, model: 'deepseek-v4-flash', generate: repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(continued.proposal.move.move).toBe('request_call');
    const bound = bindCustomerCallInterpretationV1(initial.proposal.move, continued.proposal, current);
    const authorize = (allowed: boolean) => authorizeAgentTurnV2({ proposal: bound,
      state: { ...createDefaultConversationStateV1({ workspace_id: rejectionId, conversation_id: rejectionId, contact_id: rejectionId }),
        selected_offering_code: paid, stage: 'course_selected' },
      offerings: [{ code: paid, display_name: 'Introducción al Ecommerce' }], facts: [],
      current_customer_messages: ['Por favor llamame ahora'],
      contact_intake: { nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.com', telefono: '+5491112345678' },
      call_policy: { may_offer_call: true, may_request_call_now: allowed } });
    expect(authorize(true)).toMatchObject({ ok: true, action: { type: 'request_call_now' } });
    expect(authorize(false)).toMatchObject({ ok: false });
    const finalized = await finalizeDeterministicRulesCandidateV1({ context: current, initial: continued,
      customer_call_interpretation: initial.proposal.move, call_obligation: { kind: 'offer', response_ordinal: 2 },
      rejection_id: () => rejectionId, resolve: resolver(current) });
    expect(finalized.record).toMatchObject({ rule_b: 'not_applicable', rule_b_reason: 'current_call_request' });
    expect(finalized.resolved).toBeNull();
    expect(continued.proposal.response.call_offer).toBeNull();
  });

  it.each(['continue_by_chat', 'decline_call', 'request_call'] as const)('keeps original A+B obligations when the single rewrite invents %s and a call veto', async invented => {
    const current = context(true);
    const initial = draft();
    initial.proposal.move.move = 'defer_payment';
    const rewritten = offered(true);
    rewritten.proposal.move = { ...rewritten.proposal.move, move: invented,
      secondary_moves: ['continue_by_chat'], vetoes: ['call'], course_reference: 'Ecommerce' };
    const repair = vi.fn(async () => rewritten);
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial,
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(result.record).toMatchObject({ rule_a: 'rewrite', rule_b: 'not_applicable' });
    expect(result.resolved.effective.proposal.move).toMatchObject({ move: 'defer_payment',
      secondary_moves: [], vetoes: [], course_reference: 'Ecommerce' });
    expect(result.resolved.effective.proposal.response.call_offer).toBe(invitation);
  });

  it.each(['continue_by_chat', 'decline_call', 'request_call', 'veto'] as const)('preserves an original customer call control (%s) through a bonus rewrite', async control => {
    const current = context(true);
    const initial = draft();
    if (control === 'veto') initial.proposal.move.vetoes = ['call'];
    else initial.proposal.move.move = control;
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial,
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair: async () => offered() });
    expect(result.record.rule_b).toBe('not_applicable');
    const move = result.resolved.effective.proposal.move;
    if (control === 'veto') expect(move.vetoes).toContain('call');
    else expect([move.move, ...move.secondary_moves]).toContain(control);
    expect(result.resolved.effective.proposal.response.call_offer).toBeNull();
  });

  it.each(['permission', 'budget', 'checkout', 'actual_chat'] as const)('revokes a frozen call obligation when current authoritative conditions change (%s)', async revoked => {
    const current = context(true);
    const repair = vi.fn(async () => {
      if (revoked === 'permission') current.capabilities.may_offer_call = false;
      if (revoked === 'budget') current.commercial_state.call_offer_count = 2;
      if (revoked === 'checkout') current.commercial_state.stage = 'payment_link_sent';
      if (revoked === 'actual_chat') current.turn.batch_messages = [{ id: 'current', text: 'caro, prefiero seguir por chat' }];
      return offered();
    });
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: draft(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(result.record.rule_b).toBe('not_applicable');
    expect(result.resolved.effective.proposal.response.call_offer).toBeNull();
  });

  it('does not treat three generic navigation candidates as expressed customer interest for Rule B', () => {
    const current = context(true);
    current.turn.batch_messages = [{ id: 'current', text: '¿Qué opciones tienen?' }];
    current.commercial_state.selected_offering_code = null;
    current.catalog.selected_offering = null;
    current.catalog.resolution = 'no_catalog_intent';
    current.catalog.candidate_offerings = ['uno', 'dos', 'tres'].map(code => ({
      code, display_name: code, fact_id: `offering:${code}:name:v1`, area_code: null,
    }));
    const decision = decideDeterministicRulesV1(current, draft({ memory_candidates: [] }).proposal);
    expect(decision.call).toEqual({ kind: 'none', reason: 'no_expressed_interest' });
  });

  it.each(['current_customer_named_course', 'prior_agent_named_candidate'] as const)(
    'retains a positive current literal course reference as expressed interest for Rule B (%s)', source => {
      const current = context(true);
      current.turn.batch_messages = [{ id: 'current', text: 'Ecommerce me gusta' }];
      current.commercial_state.selected_offering_code = null;
      current.catalog.selected_offering = null;
      current.catalog.resolution = 'no_catalog_intent';
      current.catalog.candidate_offerings = [{ code: paid, display_name: 'Introducción al Ecommerce',
        fact_id: `offering:${paid}:name:v1`, area_code: 'marketing',
        reference: { source, matched_terms: ['ecommerce'] } }];
      expect(decideDeterministicRulesV1(current, draft({ memory_candidates: [] }).proposal).call)
        .toEqual({ kind: 'offer', response_ordinal: 2 });
    });

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
    expect(repair.mock.calls[0]?.[0].rejections.map(reason => reason.code)).toEqual(['BONUS_OFFER_REQUIRED']);
    expect(result.record).toMatchObject({ rule_a: 'rewrite', rule_b: 'not_applicable' });
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
    expect(result.record).toMatchObject({ rule_a: 'fixed', rule_b: 'not_applicable' });
    // Owner "modo promoción" fixed copy (no payment plans in this context).
    expect(result.resolved.effective.proposal.response.messages).toEqual([
      `Te lo puedo resolver! Tengo una promoción exclusiva para ti: si avanzas con Introducción al Ecommerce, te bonifico ${bonusName}, así te llevas dos cursos al precio de uno. Lo hacemos?!`,
    ]);
    expect(result.resolved.effective.proposal.response.call_offer).toBeNull();
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
    // One question per turn (owner 2026-11-03): a gift turn carries no invitation.
    expect(result.record.rule_b).toBe(bonusApplies ? 'not_applicable' : 'fixed');
    expect(result.resolved.effective.proposal.response.call_offer)
      .toBe(bonusApplies ? null : 'Si quieres, coordinamos una llamada corta para verlo juntos. Te sirve?');
    expect(result.resolved.action_rejection).toBeNull();
    expect(repair).toHaveBeenCalledOnce();
  });

  it.each([
    { priorCount: 1, repaired: true }, { priorCount: 1, repaired: false },
    { priorCount: 2, repaired: true }, { priorCount: 2, repaired: false },
  ])('requires a complete escalation recap through the real resolver ($priorCount prior, repaired=$repaired)', async ({ priorCount, repaired }) => {
    const current = context();
    const gifts = [
      { code: bonus, display_name: bonusName, position: 1 },
      { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 2 },
      { code: 'instagram_emprendedores', display_name: 'Instagram para Emprendedores', position: 3 },
    ];
    const prior = gifts.slice(0, priorCount);
    const next = gifts[priorCount];
    current.catalog.available_offerings = [current.catalog.available_offerings[0], ...gifts.map(course => ({ ...course,
      fact_id: `offering:${course.code}:name:v1`, area_code: 'marketing' }))];
    const capability = current.capabilities.course_bonus!;
    capability.package_status = 'offered';
    capability.bonus_offerings = prior;
    capability.delivered_bonus_offerings = prior;
    capability.rule_bonus = { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce',
      bonus_offering_code: next.code, display_name: next.display_name, position: priorCount + 1 };
    const original = draft({ response: { messages: [`Te sumo ${next.display_name} sin costo extra.`], call_offer: null },
      proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: next.code },
      course_mentions: [{ offering_code: next.code, role: 'bonus' }] });
    const full = draft({ ...original.proposal,
      response: { messages: [`Te quedan Introducción al Ecommerce + ${[...prior, next].map(course => course.display_name).join(' + ')} sin costo extra, al mismo precio. Avanzamos?`], call_offer: null },
      course_mentions: [{ offering_code: paid, role: 'paid' }, ...[...prior, next].map(course => ({ offering_code: course.code, role: 'bonus' as const }))] });
    const repair = vi.fn(async () => repaired ? full : original);
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: original,
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(result.record.rule_a).toBe(repaired ? 'rewrite' : 'fixed');
    const text = result.resolved.effective.proposal.response.messages.join(' ');
    for (const name of ['Introducción al Ecommerce', ...prior.map(course => course.display_name), next.display_name]) expect(text).toContain(name);
    expect(result.resolved.effective.proposal.proposed_action).toEqual(original.proposal.proposed_action);
    if (!repaired) expect(result.resolved.effective.proposal.response.messages[0])
      .toContain(`te llevas Introducción al Ecommerce + ${[...prior, next].map(course => course.display_name).join(priorCount === 1 ? ' y ' : ', ').replace(', Instagram', ' y Instagram')}`);
  });

  it.each([false, true])('reevaluates a generic repair introducing the trigger without another generation, preserving its origin (complete=%s)', async complete => {
    const current = context();
    const next = { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales' };
    current.catalog.available_offerings.push({ ...next, area_code: 'marketing', fact_id: `offering:${next.code}:name:v1` });
    const cap = current.capabilities.course_bonus!;
    cap.package_status = 'offered';
    cap.bonus_offerings = cap.delivered_bonus_offerings = [{ code: bonus, display_name: bonusName, position: 1 }];
    cap.may_offer_bonus = true;
    cap.ladder = deriveCourseBonusLadderV1({ observed_price_objection_count: 2,
      call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: false });
    cap.rule_bonus = { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce',
      bonus_offering_code: next.code, display_name: next.display_name, position: 2 };
    const initial = draft({ move: { schema_version: 1, move: 'report_payment', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: [] }, memory_candidates: [] });
    const introduced = draft({ response: { messages: [complete
      ? `Te quedan Introducción al Ecommerce + ${bonusName} + ${next.display_name} sin costo extra.`
      : `Te sumo ${next.display_name} sin costo extra.`] },
      proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: next.code },
      course_mentions: complete ? [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' },
        { offering_code: next.code, role: 'bonus' }] : [{ offering_code: next.code, role: 'bonus' }] });
    const genericRepair = vi.fn(async (rejection: TurnRejectionV1) => ({ ...introduced, proposal: { ...introduced.proposal,
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const } } }));
    const forbiddenAdditionalGeneration = vi.fn(async () => introduced);
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial, repair_enabled: true,
      rejection_id: () => rejectionId, repair: forbiddenAdditionalGeneration,
      resolve: (candidate, repair, rejection = rejectionId) => resolveAgentAPlannerlessProposalV2({
        initial: candidate, context: current, repair_enabled: repair, repair: genericRepair,
        rejection_id: rejection, semantic_rejections: 'advisory' }) });
    expect(genericRepair).toHaveBeenCalledOnce();
    expect(forbiddenAdditionalGeneration).not.toHaveBeenCalled();
    expect(result.record.rule_a).toBe(complete ? 'rewrite' : 'fixed');
    const text = result.resolved.effective.proposal.response.messages.join(' ');
    for (const name of ['Introducción al Ecommerce', bonusName, next.display_name]) expect(text).toContain(name);
  });

  it('keeps a validated fixed proposal classified as fixed at the common final boundary', async () => {
    const current = context();
    const fixed = await resolveDeterministicRulesTurnV1({ context: current, initial: draft(), repair_enabled: false,
      rejection_id: () => rejectionId, resolve: resolver(current), repair: async () => { throw new Error('not allowed'); } });
    const resolve = vi.fn(resolver(current));
    const final = await finalizeDeterministicRulesCandidateV1({ context: current, initial: fixed.resolved.effective,
      rejection_id: () => rejectionId, authored_outcome: fixed.record, resolve });
    expect(final.record.rule_a).toBe('fixed');
    expect(final.resolved).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
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

describe('dueño 2026-11-02 (segunda revisión): promo instantánea, pregunta de precio y sin cierres pasivos', () => {
  const probe = 'El precio es el único inconveniente? Te puedo buscar una promoción que se adapte si es el caso';
  function priceContext(text: string, objections = 0): AgentAContextV1 {
    const current = context(false);
    current.turn.batch_messages = [{ id: 'current', text }];
    current.capabilities.course_bonus!.ladder = deriveCourseBonusLadderV1({ observed_price_objection_count: objections,
      call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: false });
    return current;
  }
  it('un pedido de descuento sin «sí» previo no ofrece: vuelve a la pregunta del precio (dueño, tercera revisión 2026-11-03)', async () => {
    const current = priceContext('me hacés un descuento?');
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    const result = await resolveDeterministicRulesTurnV1({ context: current,
      initial: draft({ memory_candidates: [], response: { messages: ['Te busco algo!'], call_offer: null } }),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(result.record).toMatchObject({ rule_a: 'not_applicable', rule_c: 'fixed' });
    expect(result.resolved.effective.proposal.proposed_action.type).not.toBe('offer_course_bonus');
    expect(result.resolved.effective.proposal.response.messages.at(-1)).toBe(probe);
  });
  it('una pregunta de precio sin la frase: una reescritura y, si falla, burbuja fija al final', async () => {
    const current = priceContext('cuánto sale?');
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    const result = await resolveDeterministicRulesTurnV1({ context: current,
      initial: draft({ memory_candidates: [], response: { messages: ['Tenés varias formas de pago.'], call_offer: null } }),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(result.record).toMatchObject({ rule_a: 'not_applicable', rule_c: 'fixed' });
    expect(result.resolved.effective.proposal.response.messages).toEqual(['Tenés varias formas de pago.', probe]);
  });
  it('el modelo que ya incluye la frase cumple sin reescritura', async () => {
    const current = priceContext('cuánto sale?');
    const repair = vi.fn();
    const result = await resolveDeterministicRulesTurnV1({ context: current,
      initial: draft({ memory_candidates: [], response: { messages: ['Tenés varias formas de pago.', probe], call_offer: null } }),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).not.toHaveBeenCalled();
    expect(result.record).toMatchObject({ rule_c: 'model' });
  });
  it('un cierre pasivo se reescribe y, si persiste, se quita sólo esa oración', async () => {
    const current = priceContext('me gusta ecommerce');
    const repair = vi.fn(async () => { throw new Error('provider timeout'); });
    const result = await resolveDeterministicRulesTurnV1({ context: current,
      initial: draft({ memory_candidates: [], response: { messages: ['Son 8 clases online. Lo ves tranquilo y me avisás.'], call_offer: null } }),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(result.record).toMatchObject({ rule_d: 'fixed' });
    expect(result.resolved.effective.proposal.response.messages).toEqual(['Son 8 clases online.']);
  });
  it('"sí" a la pregunta de precio dispara la oferta', () => {
    const current = priceContext('sí, sólo eso');
    current.turn.recent_turns = [{ id: 'previous', direction: 'outbound', content: `Son USD 360.\n${probe}` }];
    expect(decideDeterministicRulesV1(current, draft({ memory_candidates: [] }).proposal).bonus)
      .toMatchObject({ kind: 'offer', trigger: 'price_probe_confirmed' });
  });
});

describe('dueño — nunca silencio', () => {
  it('un respaldo fijo inválido nunca lanza: sale el mejor candidato válido', async () => {
    const current = context(false);
    current.turn.batch_messages = [{ id: 'current', text: 'cuánto sale?' }];
    current.capabilities.course_bonus!.ladder = deriveCourseBonusLadderV1({ observed_price_objection_count: 0,
      call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: false });
    const real = resolver(current);
    let calls = 0;
    const resolve = vi.fn(async (...args: Parameters<typeof real>) => {
      calls += 1;
      if (calls === 2) throw new Error('PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:fixed');
      return real(...args);
    });
    const result = await resolveDeterministicRulesTurnV1({ context: current,
      initial: draft({ memory_candidates: [], response: { messages: ['Tenés varias formas de pago.'], call_offer: null } }),
      repair_enabled: false, rejection_id: () => rejectionId, resolve, repair: vi.fn() });
    expect(result.resolved.effective.proposal.response.messages.length).toBeGreaterThan(0);
    expect(result.record).toMatchObject({ rule_c: 'unmet' });
  });

  it('conserva la duración autorizada y quita sólo la logística inventada antes del último recurso', async () => {
    const current = context(true);
    current.turn.batch_messages = [{ id: 'current', text: 'Cuánto dura el curso?' }];
    current.catalog.selected_offering = {
      code: paid,
      display_name: 'Introducción al Ecommerce',
      area_code: 'marketing',
      facts: [
        { id: `offering:${paid}:name:v1`, kind: 'offering_name', value: 'Introducción al Ecommerce' },
        { id: `offering:${paid}:duration:v1`, kind: 'offering_duration', value: '8 clases' },
        { id: `offering:${paid}:modality:v1`, kind: 'offering_modality', value: 'online' },
      ],
    };
    const unsafe = draft({
      response: {
        messages: ['Son 8 clases online, así que podés avanzar a tu ritmo y repasar cuando quieras.'],
        call_offer: null,
      },
      used_fact_ids: [`offering:${paid}:duration:v1`, `offering:${paid}:modality:v1`],
      memory_candidates: [],
    });
    const rewritten = draft({
      response: {
        messages: ['Introducción al Ecommerce son 8 clases online, así que vas a poder avanzar a tu ritmo.'],
        call_offer: invitation,
      },
      used_fact_ids: [`offering:${paid}:duration:v1`, `offering:${paid}:modality:v1`],
      memory_candidates: [],
      repair_of: { rejection_id: rejectionId, attempt: 1 },
    });
    const result = await resolveDeterministicRulesTurnV1({
      context: current,
      initial: unsafe,
      repair_enabled: true,
      rejection_id: () => rejectionId,
      resolve: resolver(current),
      repair: vi.fn(async () => rewritten),
    });
    expect(result.resolved.effective.proposal.response.messages.join(' ')).toContain('8 clases online');
    expect(result.resolved.effective.proposal.response.messages.join(' ')).not.toContain('a tu ritmo');
    expect(result.resolved.effective.proposal.response.call_offer).toContain('llamada corta');
    expect(result.record).toMatchObject({ rule_b: 'unmet' });
  });
});

describe('owner rule E (2026-11-03): one retention attempt on the first definitive no', () => {
  const declineContext = () => {
    const current = context();
    current.turn.batch_messages = [{ id: 'current', text: 'no, gracias, no lo voy a comprar' }];
    // The backend authorizes the retention offer on the literal first decline (instant trigger).
    current.capabilities.course_bonus!.ladder = { ...current.capabilities.course_bonus!.ladder!, eligible: true,
      missing_steps: [], instant_trigger: true };
    return current;
  };
  const declined = () => draft({ move: { schema_version: 1, move: 'decline_purchase', secondary_moves: [], vetoes: ['purchase'], confidence: 1 },
    response: { messages: ['Perfecto, cualquier cosa me escribes.'], call_offer: null }, memory_candidates: [] });

  it('rewrites once, then sends the owner retention copy without closing the sale', async () => {
    const current = declineContext();
    const repair = vi.fn<(rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>>(async () => declined());
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: declined(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(repair.mock.calls[0]?.[0].rejections.map(reason => reason.code)).toEqual(['BONUS_OFFER_REQUIRED', 'RETENTION_REQUIRED']);
    const proposal = result.resolved.effective.proposal;
    // Owner 2026-11-03 second batch: the retention offers the next gift for real.
    expect(proposal.response.messages).toEqual([`Estás seguro? Te puedo sumar ${bonusName} sin costo con Introducción al Ecommerce, `
      + 'seguro te interesa! Qué te parece?!']);
    expect(proposal.proposed_action).toEqual({ type: 'offer_course_bonus', bonus_offering_code: bonus, interest_offering_code: paid });
    expect(proposal.move.move).not.toBe('decline_purchase');
  });

  it('a decline that names the course still yields a schema-valid retention fallback', async () => {
    const current = declineContext();
    const naming = () => draft({ move: { schema_version: 1, move: 'decline_purchase', course_reference: paid, secondary_moves: [],
      vetoes: ['purchase'], confidence: 1 }, response: { messages: ['Perfecto, cualquier cosa me escribes.'], call_offer: null }, memory_candidates: [] });
    const repair = vi.fn<(rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>>(async () => naming());
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: naming(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(result.resolved.effective.proposal.response.messages[0]).toMatch(/^Estás seguro\?/u);
    // Clean move on the paid course (never the decline's own references).
    expect(result.resolved.effective.proposal.move).toMatchObject({ move: 'ask_course_information', course_reference: paid });
  });

  it('respects the second no: no retention when it was already attempted', async () => {
    const current = declineContext();
    current.turn.recent_turns = [{ id: 'r', direction: 'outbound',
      content: 'Estás seguro? Te puedo buscar otra bonificación que seguro te interesa!' }];
    const repair = vi.fn();
    const result = await resolveDeterministicRulesTurnV1({ context: current, initial: declined(),
      repair_enabled: true, rejection_id: () => rejectionId, resolve: resolver(current), repair });
    expect(repair).not.toHaveBeenCalled();
    expect(result.resolved.effective.proposal.move.move).toBe('decline_purchase');
  });
});

