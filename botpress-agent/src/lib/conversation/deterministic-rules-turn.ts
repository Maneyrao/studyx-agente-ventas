import { bindCustomerCallInterpretationV1, type CustomerCallInterpretationV1 } from './customer-call-interpretation'
import { supportsCallRequestV1, supportsChatPreferenceV1 } from './channel-preference-evidence'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import type { GeneratedAgentATurnProposalV1 } from './agent-a-brain'
import type { PlannerlessResolutionV2 } from './resolve-agent-a-plannerless'
import { isTurnEvidencePersistenceError } from '../observability/turn-evidence'
import type { ModelObservation } from '../observability/turn-evidence'
import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import { removeUnsupportedCourseLogisticsAssertionsV1 } from './agent-a-brain'
import {
  CALL_FALLBACK_OFFER_V1, bonusFallbackMessagesV1, decideBonusRuleV1, decideCallRuleV1, decidePriceProbeRuleV1,
  draftFulfillsPromotionTaskV1, draftPresentsCallV1, messagesContainPriceProbeV1, passiveClosingSentencesV1, passiveRuleAppliesV1,
  PRICE_PROBE_V1, priceExpressionHintV1, priceObservationQuoteInBatchV1, withPriceProbeV1, withoutPassiveClosingV1,
  decideRetentionRuleV1, draftFulfillsRetentionV1, retentionFallbackMessageV1, type RetentionRuleDecisionV1,
  type BonusRuleDecisionV1, type CallRuleDecisionV1, type PromotionTaskDataV1, type PriceProbeRuleDecisionV1, type RuleContextV1, type RuleOutcomeV1,
} from '../../../../src/shared/conversation/deterministic-sales-rules'
import { latestAgentTurnMessages } from '../../../../src/features/orchestration/domain/course-focus'

/** Owner rules A/B (AGENTS.md, 2026-11-02). Botpress only orchestrates the
 * rewrite and the fixed fallback; the backend owns the course and the effect. */

const RECENT_TURNS_SCHEMA_MAX = 20

export function ruleContextFromAgentAContextV1(context: AgentAContextV1): RuleContextV1 {
  const bonus = context.capabilities.course_bonus
  const negotiation = context.commercial_state.negotiation
  const state = context.commercial_state
  return {
    batch_texts: context.turn.batch_messages.map(message => message.text),
    recent_turns: context.turn.recent_turns,
    recent_turns_complete: context.turn.recent_turns.length < RECENT_TURNS_SCHEMA_MAX,
    stage: state.stage,
    awaiting_reply: state.awaiting_reply,
    payment_paid: state.payment_verification?.status === 'paid',
    payment_link_request_pending: state.payment_link_request?.status === 'pending',
    bonus_enabled: bonus?.enabled === true,
    package_status: bonus?.package_status ?? null,
    delivered_bonus: bonus?.delivered_bonus_offerings ?? [],
    rule_bonus: bonus?.rule_bonus ?? null,
    prior_price_objection_count: bonus?.ladder?.observed_price_objection_count ?? negotiation?.price_objections.count ?? 0,
    price_only_confirmed: bonus?.ladder?.price_only_barrier_confirmed === true
      || negotiation?.price_only_barrier.status === 'confirmed',
    may_offer_call: context.capabilities.may_offer_call,
    call_offer_status: state.call_offer_status,
    call_offer_count: state.call_offer_count,
    call_preference: state.call_preference,
    customer_expressed_interest: state.selected_offering_code !== null
      || context.catalog.candidate_offerings.some(candidate => candidate.reference !== undefined)
      || context.catalog.resolution === 'exact' || context.catalog.resolution === 'ambiguous'
      || context.customer.memories.some(memory => memory.type === 'study_goal'),
    previous_agent_messages: latestAgentTurnMessages(context.turn.recent_turns),
    payment_reported: state.payment_reported,
    active_call: state.active_call != null,
    opted_out: !context.capabilities.may_reply,
    ...paidCourseV1(context),
  }
}

function paidCourseV1(context: AgentAContextV1): { paid_offering_code: string | null; paid_display_name: string | null } {
  const code = context.commercial_state.selected_offering_code ?? context.capabilities.course_bonus?.interest_offering_code ?? null
  const name = code ? context.catalog.available_offerings.find(offering => offering.code === code)?.display_name ?? null : null
  return { paid_offering_code: name ? code : null, paid_display_name: name }
}

export interface DeterministicRulesDecisionV1 {
  readonly bonus: BonusRuleDecisionV1
  readonly call: CallRuleDecisionV1
  /** Owner rule C (2026-11-02): price concern → "El precio es el único inconveniente?..." */
  readonly probe: PriceProbeRuleDecisionV1
  /** Owner rule D (2026-11-02): no passive closings while the sale is open. */
  readonly passive_forbidden: boolean
  readonly price_expression_hint: boolean
  /** Owner rule E (2026-11-03): one retention attempt on the first definitive "no". */
  readonly retention?: RetentionRuleDecisionV1
}

export function decideDeterministicRulesV1(context: AgentAContextV1, draft: AgentATurnProposalV1,
  obligation?: Extract<CallRuleDecisionV1, { kind: 'offer' }>): DeterministicRulesDecisionV1 {
  const ruleContext = ruleContextFromAgentAContextV1(context)
  const bonus = decideBonusRuleV1(ruleContext, draft)
  // Once B was required for this intervention, a prose rewrite cannot invent
  // checkout/channel intent to erase it. Recheck authoritative lifecycle and
  // consent instead; no persisted permission is bypassed.
  const eligibilityDraft = obligation ? { ...draft, proposed_action: { type: 'none' },
    move: { move: 'unknown', secondary_moves: [] } } : draft
  const call = supportsChatPreferenceV1(ruleContext.batch_texts.join('\n'), ruleContext.awaiting_reply === 'call_or_chat')
    ? { kind: 'none' as const, reason: 'chat_preference' }
    : supportsCallRequestV1(ruleContext.batch_texts.join('\n'), ruleContext.awaiting_reply === 'call_or_chat')
      ? { kind: 'none' as const, reason: 'current_call_request' }
      : decideCallRuleV1(obligation ? { ...ruleContext, customer_expressed_interest: true } : ruleContext, eligibilityDraft, bonus)
  return {
    bonus,
    call: call.kind === 'offer' && obligation ? obligation : call,
    probe: decidePriceProbeRuleV1(ruleContext, draft, bonus),
    passive_forbidden: passiveRuleAppliesV1(ruleContext, draft),
    price_expression_hint: ruleContext.batch_texts.some(priceExpressionHintV1),
    retention: decideRetentionRuleV1(ruleContext, draft),
  }
}

function rulesApply(decision: DeterministicRulesDecisionV1, draft: AgentATurnProposalV1): boolean {
  return decision.bonus.kind === 'offer' || decision.call.kind === 'offer' || decision.probe.kind === 'ask'
    || decision.retention?.kind === 'retain'
    || (decision.passive_forbidden && passiveClosingSentencesV1(draft.response.messages).length > 0)
}

/** The backend validated the trigger with this turn's evidence; let the local
 * schema and validator accept the decided effect for this turn only. */
export function authorizeRuleBonusInContextV1(context: AgentAContextV1): void {
  const bonus = context.capabilities.course_bonus
  if (!bonus) return
  bonus.may_offer_bonus = true
  if (bonus.ladder) bonus.ladder = { ...bonus.ladder, eligible: true, missing_steps: [] }
}

export function ruleRejectionV1(input: {
  readonly decision: DeterministicRulesDecisionV1
  readonly rejection_id: string
  readonly context: AgentAContextV1
  readonly draft?: AgentATurnProposalV1
}): TurnRejectionV1 | null {
  const factIds = [
    ...input.context.catalog.available_offerings.map(offering => offering.fact_id),
    ...input.context.catalog.payment_plans.map(plan => plan.fact_id),
  ]
  const rejections: TurnRejectionV1['rejections'] = []
  if (input.decision.bonus.kind === 'offer') rejections.push({
    code: 'BONUS_OFFER_REQUIRED', subject: `rule_a:bonus:${input.decision.bonus.bonus_code}`,
  })
  if (input.decision.call.kind === 'offer') rejections.push({ code: 'CALL_OFFER_REQUIRED', subject: 'rule_b:call_offer' })
  if (input.decision.probe.kind === 'ask' && !(input.draft && messagesContainPriceProbeV1(input.draft.response.messages)))
    rejections.push({ code: 'PRICE_PROBE_REQUIRED', subject: 'rule_c:price_probe' })
  if (input.decision.passive_forbidden && (!input.draft || passiveClosingSentencesV1(input.draft.response.messages).length > 0)) rejections.push({ code: 'PASSIVE_CLOSING_FORBIDDEN', subject: 'rule_d:passive_closing' })
  if (input.decision.retention?.kind === 'retain' && !(input.draft && draftFulfillsRetentionV1(input.draft)))
    rejections.push({ code: 'RETENTION_REQUIRED', subject: `rule_e:retention:${input.decision.retention.variant}` })
  if (rejections.length) return {
    schema_version: 1, rejection_id: input.rejection_id, attempt: 1, rejections,
    authorized_alternatives: { fact_ids: factIds,
      actions: input.decision.bonus.kind === 'offer' ? ['offer_course_bonus'] : ['none'], missing_information: [] },
  }
  return null
}

/** Real data for the owner's promotion task: configured plans and the
 * customer's own goal from durable memory. */
export function promotionTaskDataV1(context: AgentAContextV1): PromotionTaskDataV1 {
  const goal = context.customer.memories.find(memory => memory.type === 'study_goal')?.value ?? null
  return { plan_codes: context.catalog.payment_plans.map(plan => plan.code), customer_goal: goal }
}

export function draftSatisfiesRulesV1(draft: AgentATurnProposalV1, decision: DeterministicRulesDecisionV1,
  context: AgentAContextV1): boolean {
  return (decision.bonus.kind !== 'offer' || draftFulfillsPromotionTaskV1(draft, decision.bonus, promotionTaskDataV1(context)))
    && (decision.call.kind !== 'offer' || draftPresentsCallV1(draft))
    && (decision.probe.kind !== 'ask' || messagesContainPriceProbeV1(draft.response.messages))
    && (!decision.passive_forbidden || passiveClosingSentencesV1(draft.response.messages).length === 0)
    && (decision.retention?.kind !== 'retain' || draftFulfillsRetentionV1(draft))
}

/** Rule E fallback (owner wording): the whole turn, sale kept open, payment link withdrawn. */
export function retentionFallbackProposalV1(draft: AgentATurnProposalV1,
  decision: Extract<RetentionRuleDecisionV1, { kind: 'retain' }>): AgentATurnProposalV1 {
  const vetoes = [...new Set([...(draft.move.vetoes ?? []).filter(veto => veto !== 'purchase'), 'payment_link' as const])]
  return { ...draft,
    move: { ...draft.move, move: 'unknown', secondary_moves: [], vetoes },
    response: { messages: [retentionFallbackMessageV1(decision)], call_offer: null },
    proposed_action: { type: 'none' },
    course_mentions: decision.variant === 'more_bonus' && decision.paid_code
      ? [{ offering_code: decision.paid_code, role: 'paid' }] : [],
    profile_requests: [] }
}

/** Rules C/D fallback on the model's own turn: drop passive sentences, then end
 * with the owner's probe bubble. Profile requests keep only unchanged bubbles. */
export function withFixedPriceRulesV1(draft: AgentATurnProposalV1, decision: DeterministicRulesDecisionV1): AgentATurnProposalV1 {
  let messages: string[] = decision.passive_forbidden ? withoutPassiveClosingV1(draft.response.messages) : [...draft.response.messages]
  if (decision.probe.kind === 'ask' && !messagesContainPriceProbeV1(messages)) messages = withPriceProbeV1(messages)
  const unchanged = (index: number) => messages[index] !== undefined && messages[index] === draft.response.messages[index]
  return { ...draft, response: { ...draft.response, messages: messages as [string, ...string[]] },
    profile_requests: (draft.profile_requests ?? []).filter(request => unchanged(request.message_index)) }
}

function offeringFactId(context: AgentAContextV1, code: string): string[] {
  const fact = context.catalog.available_offerings.find(offering => offering.code === code)?.fact_id
  return fact ? [fact] : []
}

/** Rule A fallback: the WHOLE turn is replaced by the owner's fixed message. Only the
 * model's interpretation metadata (memory) is kept, because it is the evidence
 * the backend revalidates for the trigger; no model prose survives. */
export function bonusFallbackProposalV1(input: {
  readonly context: AgentAContextV1
  readonly draft: AgentATurnProposalV1
  readonly decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>
}): AgentATurnProposalV1 {
  const { decision, context } = input
  const mentions = [
    { offering_code: decision.paid_code, role: 'paid' as const },
    ...decision.prior_bonus.map(course => ({ offering_code: course.code, role: 'bonus' as const })),
    { offering_code: decision.bonus_code, role: 'bonus' as const },
  ]
  return {
    schema_version: 1,
    move: input.draft.move,
    response: { messages: bonusFallbackMessagesV1(decision, promotionTaskDataV1(context)), call_offer: null },
    proposed_action: { type: 'offer_course_bonus', bonus_offering_code: decision.bonus_code, interest_offering_code: decision.paid_code },
    course_mentions: mentions,
    confirmed_phone: null,
    profile_updates: [],
    profile_requests: [],
    used_fact_ids: [...new Set([decision.paid_code, decision.bonus_code, ...decision.prior_bonus.map(course => course.code)]
      .flatMap(code => offeringFactId(context, code))),
      // The fixed copy names the configured installment plans.
      ...context.catalog.payment_plans.filter(plan => plan.code === 'monthly_12' || plan.code === 'monthly_6')
        .map(plan => plan.fact_id)],
    used_memory_ids: [],
    repair_of: input.draft.repair_of,
    memory_candidates: input.draft.memory_candidates,
  }
}

/** Rule B fallback: a fixed response.call_offer. The model's messages stay as written. */
export function withFixedCallOfferV1(draft: AgentATurnProposalV1): AgentATurnProposalV1 {
  return { ...draft, response: { ...draft.response, call_offer: CALL_FALLBACK_OFFER_V1 } }
}

/** Fact-only never-silence repair. It does not author sales prose or infer the
 * customer's phase: it removes only logistics assertions detected by the same
 * validator when no selected-course fact authorizes them. */
function withoutUnsupportedCourseLogisticsV1(
  context: AgentAContextV1,
  source: GeneratedAgentATurnProposalV1,
): GeneratedAgentATurnProposalV1 | null {
  const authorizedValues = [
    ...(context.catalog.selected_offering?.facts ?? []).map((fact) => fact.value),
    ...context.catalog.candidate_offerings.flatMap((offering) => (offering.facts ?? []).map((fact) => fact.value)),
  ]
  const messages = source.proposal.response.messages
    .flatMap((message) => removeUnsupportedCourseLogisticsAssertionsV1(message, authorizedValues))
    .map((message) => message.trim())
    .filter(Boolean)
  if (messages.length === 0 || messages.join('\n') === source.proposal.response.messages.join('\n')) return null
  return { ...source, proposal: { ...source.proposal,
    response: { ...source.proposal.response, messages: messages as [string, ...string[]] },
    profile_requests: [] } }
}

export interface RuleOutcomeRecordV1 {
  readonly kind: 'deterministic_rules'
  readonly rule_a: RuleOutcomeV1
  readonly rule_a_reason: string
  readonly rule_a_bonus_code: string | null
  readonly rule_b: RuleOutcomeV1
  readonly rule_b_reason: string
  readonly rule_c?: RuleOutcomeV1
  readonly rule_d?: RuleOutcomeV1
  readonly price_expression_hint: boolean
}

type RuleOutcomesV1 = { readonly rule_a: RuleOutcomeV1; readonly rule_b: RuleOutcomeV1;
  readonly rule_c?: RuleOutcomeV1; readonly rule_d?: RuleOutcomeV1 }

export function ruleOutcomeRecordV1(decision: DeterministicRulesDecisionV1,
  outcome: RuleOutcomeV1 | RuleOutcomesV1, passiveApplied = false): RuleOutcomeRecordV1 {
  const outcomes: RuleOutcomesV1 = typeof outcome === 'string'
    ? { rule_a: outcome, rule_b: outcome, rule_c: outcome, rule_d: outcome } : outcome
  return {
    kind: 'deterministic_rules',
    rule_a: decision.bonus.kind === 'offer' ? outcomes.rule_a : 'not_applicable',
    rule_a_reason: decision.bonus.kind === 'offer' ? decision.bonus.trigger : decision.bonus.reason,
    rule_a_bonus_code: decision.bonus.kind === 'offer' ? decision.bonus.bonus_code : null,
    rule_b: decision.call.kind === 'offer' ? outcomes.rule_b : 'not_applicable',
    rule_b_reason: decision.call.kind === 'offer' ? `response_${decision.call.response_ordinal}` : decision.call.reason,
    rule_c: decision.probe.kind === 'ask' ? (outcomes.rule_c ?? outcomes.rule_a) : 'not_applicable',
    rule_d: passiveApplied ? (outcomes.rule_d ?? outcomes.rule_a) : 'not_applicable',
    price_expression_hint: decision.price_expression_hint,
  }
}


/** Preserve only literal initial model evidence needed by Rule A across its
 * bounded rewrite. The rewrite may change prose, never erase its own trigger. */
export function preserveRuleTriggerEvidenceV1(original: AgentATurnProposalV1,
  rewritten: AgentATurnProposalV1, batch: readonly string[]): AgentATurnProposalV1 {
  const evidence = original.memory_candidates.filter(candidate => (
    candidate.type === 'objection' && candidate.key === 'price_objection'
    || candidate.type === 'constraint' && candidate.key === 'price_only_barrier'
  ) && priceObservationQuoteInBatchV1(candidate.source_quote, batch))
  const key = (candidate: AgentATurnProposalV1['memory_candidates'][number]) =>
    JSON.stringify([candidate.type, candidate.key, candidate.value, candidate.source_quote])
  const originalKeys = new Set(evidence.map(key))
  return { ...rewritten, memory_candidates: [...evidence,
    ...rewritten.memory_candidates.filter(candidate => !originalKeys.has(key(candidate)))].slice(0, 10) }
}

/** Shared, tested orchestration used by the live workflow. One rewrite for A+B
 * together; fixed copy still traverses the same fact/action validator. */
export async function resolveDeterministicRulesTurnV1(input: {
  readonly context: AgentAContextV1
  readonly initial: GeneratedAgentATurnProposalV1
  readonly repair_enabled: boolean
  readonly customer_call_interpretation?: CustomerCallInterpretationV1
  readonly call_obligation?: Extract<CallRuleDecisionV1, { kind: 'offer' }>
  readonly rejection_id: () => string
  readonly resolve: (candidate: GeneratedAgentATurnProposalV1, repair: boolean,
    rejectionId?: string) => Promise<PlannerlessResolutionV2<GeneratedAgentATurnProposalV1>>
  readonly repair: (rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>
  readonly observe?: (event: ModelObservation) => void
  readonly on_failure?: (stage: 'validation' | 'rewrite' | 'fixed', error: unknown) => void
}): Promise<{ resolved: PlannerlessResolutionV2<GeneratedAgentATurnProposalV1>; record: RuleOutcomeRecordV1 }> {
  const interpretation = input.customer_call_interpretation ?? input.initial.proposal.move
  const initial = { ...input.initial, proposal: bindCustomerCallInterpretationV1(interpretation, input.initial.proposal, input.context) }
  let decision = decideDeterministicRulesV1(input.context, initial.proposal, input.call_obligation)
  const callObligation = input.call_obligation ?? (decision.call.kind === 'offer' ? decision.call : undefined)
  const passiveApplied = decision.passive_forbidden && passiveClosingSentencesV1(initial.proposal.response.messages).length > 0
  const applies = rulesApply(decision, initial.proposal)
  if (!applies) {
    const resolved = await input.resolve(initial, input.repair_enabled)
    const boundEffective = { ...resolved.effective, proposal: bindCustomerCallInterpretationV1(interpretation, resolved.effective.proposal, input.context) }
    const effectiveDecision = decideDeterministicRulesV1(input.context, boundEffective.proposal, callObligation)
    if (rulesApply(effectiveDecision, boundEffective.proposal)) {
      // A generic repair can introduce literal model evidence and a new rule
      // obligation. Its generation already consumed the rewrite: finalize with
      // validation/fixed copy only, never another provider request.
      const finalized = await resolveDeterministicRulesTurnV1({ ...input, initial: boundEffective, repair_enabled: false,
        customer_call_interpretation: interpretation, call_obligation: callObligation })
      if (!resolved.evidence.repair_attempted) return finalized
      return { ...finalized, record: { ...finalized.record,
        rule_a: finalized.record.rule_a === 'model' ? 'rewrite' : finalized.record.rule_a,
        rule_b: finalized.record.rule_b === 'model' ? 'rewrite' : finalized.record.rule_b,
        rule_c: finalized.record.rule_c === 'model' ? 'rewrite' : finalized.record.rule_c,
        rule_d: finalized.record.rule_d === 'model' ? 'rewrite' : finalized.record.rule_d } }
    }
    return { resolved: { ...resolved, effective: boundEffective }, record: ruleOutcomeRecordV1(effectiveDecision, 'not_applicable') }
  }
  if (decision.bonus.kind === 'offer') authorizeRuleBonusInContextV1(input.context)
  let resolved: PlannerlessResolutionV2<GeneratedAgentATurnProposalV1> | null = null
  let candidate = initial
  let authored: 'model' | 'rewrite' = 'model'
  const validate = async (draft: GeneratedAgentATurnProposalV1, rejectionId?: string) => {
    decision = { ...decision, call: decideDeterministicRulesV1(input.context, draft.proposal, callObligation).call }
    const result = await input.resolve(draft, false, rejectionId)
    return result.action_rejection === null && draftSatisfiesRulesV1(result.effective.proposal, decision, input.context) ? result : null
  }
  try { resolved = await validate(candidate) }
  catch (error) {
    if (isTurnEvidencePersistenceError(error)) throw error
    input.on_failure?.('validation', error)
  }
  if (resolved) return { resolved, record: ruleOutcomeRecordV1(decision, 'model', passiveApplied) }
  const rejection = ruleRejectionV1({ decision, context: input.context, rejection_id: input.rejection_id(), draft: initial.proposal })
    ?? ruleRejectionV1({ decision, context: input.context, rejection_id: input.rejection_id() })!
  input.observe?.({ kind: 'proposal_rejected', rejection })
  try {
    if (!input.repair_enabled) throw new Error('RULE_REWRITE_DISABLED')
    const rewritten = await input.repair(rejection)
    candidate = { ...rewritten, proposal: preserveRuleTriggerEvidenceV1(initial.proposal,
      bindCustomerCallInterpretationV1(interpretation, rewritten.proposal, input.context),
      input.context.turn.batch_messages.map(message => message.text)) }
    authored = 'rewrite'
    resolved = await validate(candidate, rejection.rejection_id)
  } catch (error) {
    if (isTurnEvidencePersistenceError(error)) throw error
    input.on_failure?.('rewrite', error)
  }
  if (resolved) return { resolved, record: ruleOutcomeRecordV1(decision, 'rewrite', passiveApplied) }
  const outcomes: { rule_a: RuleOutcomeV1; rule_b: RuleOutcomeV1; rule_c: RuleOutcomeV1; rule_d: RuleOutcomeV1 } =
    { rule_a: authored, rule_b: authored, rule_c: authored, rule_d: authored }
  let fixed = candidate.proposal
  if (decision.bonus.kind === 'offer') {
    fixed = bonusFallbackProposalV1({ context: input.context, draft: { ...initial.proposal,
      repair_of: fixed.repair_of }, decision: decision.bonus })
    outcomes.rule_a = 'fixed'
  } else if (decision.retention?.kind === 'retain') {
    fixed = retentionFallbackProposalV1(initial.proposal, decision.retention)
  } else if (decision.probe.kind === 'ask' || passiveClosingSentencesV1(fixed.response.messages).length > 0) {
    // Rules C/D keep the model's answer and replace only the closing (owner wording).
    fixed = withFixedPriceRulesV1(fixed, decision)
    outcomes.rule_c = 'fixed'
    outcomes.rule_d = 'fixed'
  }
  // No call_offer from a rejected proposal is trusted merely because it is
  // nonempty (for example an unauthorized immediate-call promise).
  if (decision.call.kind === 'offer') {
    fixed = withFixedCallOfferV1(fixed)
    outcomes.rule_b = 'fixed'
  }
  try {
    resolved = await validate({ ...candidate, proposal: fixed })
    if (!resolved) throw new Error('RULE_FIXED_FALLBACK_NOT_AUTHORIZED')
  } catch (error) {
    if (isTurnEvidencePersistenceError(error)) throw error
    input.on_failure?.('fixed', error)
    // Never silence (owner bound): an invalid fixed fallback never ends the turn.
    // Best valid model candidate, then the initial draft, then the owner's probe.
    const unmet = { rule_a: decision.bonus.kind === 'offer' ? 'unmet' as const : outcomes.rule_a,
      rule_b: decision.call.kind === 'offer' ? 'unmet' as const : outcomes.rule_b, rule_c: 'unmet' as const, rule_d: 'unmet' as const }
    const factSafeFixed = withoutUnsupportedCourseLogisticsV1(input.context, { ...candidate, proposal: fixed })
    const factSafeCandidate = withoutUnsupportedCourseLogisticsV1(input.context, candidate)
    const factSafeInitial = withoutUnsupportedCourseLogisticsV1(input.context, initial)
    const lastResort: GeneratedAgentATurnProposalV1 = { ...initial, proposal: { ...initial.proposal,
      response: { messages: [PRICE_PROBE_V1], call_offer: null }, proposed_action: { type: 'none' },
      course_mentions: [], used_fact_ids: [], used_memory_ids: [], profile_updates: [], profile_requests: [] } }
    for (const option of [factSafeFixed, factSafeCandidate, candidate, factSafeInitial, initial,
      ...(input.context.capabilities.course_bonus?.enabled === true ? [lastResort] : [])].filter(
      (value): value is GeneratedAgentATurnProposalV1 => value !== null,
    )) {
      try {
        const plain = await input.resolve(option, false)
        return { resolved: plain, record: ruleOutcomeRecordV1(decision, unmet, passiveApplied) }
      } catch (plainError) {
        if (isTurnEvidencePersistenceError(plainError)) throw plainError
        input.on_failure?.('fixed', plainError)
      }
    }
    throw error
  }
  return { resolved, record: ruleOutcomeRecordV1(decision, outcomes, passiveApplied) }
}


/** Common final-candidate boundary, also used after backend repair and safe
 * conversation recovery. There is no provider capability in this API. */
export async function finalizeDeterministicRulesCandidateV1(input: {
  readonly context: AgentAContextV1
  readonly initial: GeneratedAgentATurnProposalV1
  readonly rejection_id: () => string
  readonly resolve: Parameters<typeof resolveDeterministicRulesTurnV1>[0]['resolve']
  readonly observe?: (event: ModelObservation) => void
  readonly customer_call_interpretation?: CustomerCallInterpretationV1
  readonly call_obligation?: Extract<CallRuleDecisionV1, { kind: 'offer' }>
  readonly authored_outcome?: RuleOutcomeV1 | { readonly rule_a: RuleOutcomeV1; readonly rule_b: RuleOutcomeV1 }
}): Promise<{ resolved: PlannerlessResolutionV2<GeneratedAgentATurnProposalV1> | null; record: RuleOutcomeRecordV1 }> {
  const decision = decideDeterministicRulesV1(input.context, input.initial.proposal, input.call_obligation)
  if (draftSatisfiesRulesV1(input.initial.proposal, decision, input.context)) return { resolved: null,
    record: ruleOutcomeRecordV1(decision, input.authored_outcome ?? 'model') }
  return resolveDeterministicRulesTurnV1({ ...input, repair_enabled: false,
    repair: async () => { throw new Error('FINAL_RULE_CANDIDATE_GENERATION_NOT_ALLOWED') } })
}
