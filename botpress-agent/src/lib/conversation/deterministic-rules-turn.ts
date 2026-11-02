import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import type { GeneratedAgentATurnProposalV1 } from './agent-a-brain'
import type { PlannerlessResolutionV2 } from './resolve-agent-a-plannerless'
import { isTurnEvidencePersistenceError } from '../observability/turn-evidence'
import type { ModelObservation } from '../observability/turn-evidence'
import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import {
  CALL_FALLBACK_OFFER_V1, bonusFallbackMessagesV1, decideBonusRuleV1, decideCallRuleV1,
  draftPresentsBonusV1, draftPresentsCallV1, priceExpressionHintV1, priceObservationQuoteInBatchV1,
  type BonusRuleDecisionV1, type CallRuleDecisionV1, type RuleContextV1, type RuleOutcomeV1,
} from '../../../../src/shared/conversation/deterministic-sales-rules'

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
      || context.catalog.candidate_offerings.length > 0
      || context.catalog.resolution === 'exact' || context.catalog.resolution === 'ambiguous'
      || context.customer.memories.some(memory => memory.type === 'study_goal'),
  }
}

export interface DeterministicRulesDecisionV1 {
  readonly bonus: BonusRuleDecisionV1
  readonly call: CallRuleDecisionV1
  readonly price_expression_hint: boolean
}

export function decideDeterministicRulesV1(context: AgentAContextV1, draft: AgentATurnProposalV1): DeterministicRulesDecisionV1 {
  const ruleContext = ruleContextFromAgentAContextV1(context)
  const bonus = decideBonusRuleV1(ruleContext, draft)
  return {
    bonus,
    call: decideCallRuleV1(ruleContext, draft, bonus),
    price_expression_hint: ruleContext.batch_texts.some(priceExpressionHintV1),
  }
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
  if (rejections.length) return {
    schema_version: 1, rejection_id: input.rejection_id, attempt: 1, rejections,
    authorized_alternatives: { fact_ids: factIds,
      actions: input.decision.bonus.kind === 'offer' ? ['offer_course_bonus'] : ['none'], missing_information: [] },
  }
  return null
}

export function draftSatisfiesRulesV1(draft: AgentATurnProposalV1, decision: DeterministicRulesDecisionV1): boolean {
  return (decision.bonus.kind !== 'offer' || draftPresentsBonusV1(draft, decision.bonus))
    && (decision.call.kind !== 'offer' || draftPresentsCallV1(draft))
}

function offeringFactId(context: AgentAContextV1, code: string): string[] {
  const fact = context.catalog.available_offerings.find(offering => offering.code === code)?.fact_id
  return fact ? [fact] : []
}

/** Rule A fallback: the WHOLE turn is replaced by the two fixed bubbles. Only the
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
    response: { messages: bonusFallbackMessagesV1(decision), call_offer: null },
    proposed_action: { type: 'offer_course_bonus', bonus_offering_code: decision.bonus_code, interest_offering_code: decision.paid_code },
    course_mentions: mentions,
    confirmed_phone: null,
    profile_updates: [],
    profile_requests: [],
    used_fact_ids: [...new Set([decision.paid_code, decision.bonus_code, ...decision.prior_bonus.map(course => course.code)]
      .flatMap(code => offeringFactId(context, code)))],
    used_memory_ids: [],
    repair_of: input.draft.repair_of,
    memory_candidates: input.draft.memory_candidates,
  }
}

/** Rule B fallback: a fixed response.call_offer. The model's messages stay as written. */
export function withFixedCallOfferV1(draft: AgentATurnProposalV1): AgentATurnProposalV1 {
  return { ...draft, response: { ...draft.response, call_offer: CALL_FALLBACK_OFFER_V1 } }
}

export interface RuleOutcomeRecordV1 {
  readonly kind: 'deterministic_rules'
  readonly rule_a: RuleOutcomeV1
  readonly rule_a_reason: string
  readonly rule_a_bonus_code: string | null
  readonly rule_b: RuleOutcomeV1
  readonly rule_b_reason: string
  readonly price_expression_hint: boolean
}

export function ruleOutcomeRecordV1(decision: DeterministicRulesDecisionV1,
  outcome: RuleOutcomeV1 | { readonly rule_a: RuleOutcomeV1; readonly rule_b: RuleOutcomeV1 }): RuleOutcomeRecordV1 {
  const outcomes = typeof outcome === 'string' ? { rule_a: outcome, rule_b: outcome } : outcome
  return {
    kind: 'deterministic_rules',
    rule_a: decision.bonus.kind === 'offer' ? outcomes.rule_a : 'not_applicable',
    rule_a_reason: decision.bonus.kind === 'offer' ? decision.bonus.trigger : decision.bonus.reason,
    rule_a_bonus_code: decision.bonus.kind === 'offer' ? decision.bonus.bonus_code : null,
    rule_b: decision.call.kind === 'offer' ? outcomes.rule_b : 'not_applicable',
    rule_b_reason: decision.call.kind === 'offer' ? `response_${decision.call.response_ordinal}` : decision.call.reason,
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
  readonly rejection_id: () => string
  readonly resolve: (candidate: GeneratedAgentATurnProposalV1, repair: boolean,
    rejectionId?: string) => Promise<PlannerlessResolutionV2<GeneratedAgentATurnProposalV1>>
  readonly repair: (rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>
  readonly observe?: (event: ModelObservation) => void
  readonly on_failure?: (stage: 'validation' | 'rewrite' | 'fixed', error: unknown) => void
}): Promise<{ resolved: PlannerlessResolutionV2<GeneratedAgentATurnProposalV1>; record: RuleOutcomeRecordV1 }> {
  const decision = decideDeterministicRulesV1(input.context, input.initial.proposal)
  const applies = decision.bonus.kind === 'offer' || decision.call.kind === 'offer'
  if (!applies) return { resolved: await input.resolve(input.initial, input.repair_enabled),
    record: ruleOutcomeRecordV1(decision, 'not_applicable') }
  if (decision.bonus.kind === 'offer') authorizeRuleBonusInContextV1(input.context)
  let resolved: PlannerlessResolutionV2<GeneratedAgentATurnProposalV1> | null = null
  let candidate = input.initial
  let authored: 'model' | 'rewrite' = 'model'
  const validate = async (draft: GeneratedAgentATurnProposalV1, rejectionId?: string) => {
    const result = await input.resolve(draft, false, rejectionId)
    return result.action_rejection === null && draftSatisfiesRulesV1(result.effective.proposal, decision) ? result : null
  }
  try { resolved = await validate(candidate) }
  catch (error) {
    if (isTurnEvidencePersistenceError(error)) throw error
    input.on_failure?.('validation', error)
  }
  if (resolved) return { resolved, record: ruleOutcomeRecordV1(decision, 'model') }
  const rejection = ruleRejectionV1({ decision, context: input.context, rejection_id: input.rejection_id() })!
  input.observe?.({ kind: 'proposal_rejected', rejection })
  try {
    if (!input.repair_enabled) throw new Error('RULE_REWRITE_DISABLED')
    const rewritten = await input.repair(rejection)
    candidate = { ...rewritten, proposal: preserveRuleTriggerEvidenceV1(input.initial.proposal,
      rewritten.proposal, input.context.turn.batch_messages.map(message => message.text)) }
    authored = 'rewrite'
    resolved = await validate(candidate, rejection.rejection_id)
  } catch (error) {
    if (isTurnEvidencePersistenceError(error)) throw error
    input.on_failure?.('rewrite', error)
  }
  if (resolved) return { resolved, record: ruleOutcomeRecordV1(decision, 'rewrite') }
  const outcomes = { rule_a: authored as RuleOutcomeV1, rule_b: authored as RuleOutcomeV1 }
  let fixed = candidate.proposal
  if (decision.bonus.kind === 'offer') {
    fixed = bonusFallbackProposalV1({ context: input.context, draft: { ...input.initial.proposal,
      repair_of: fixed.repair_of }, decision: decision.bonus })
    outcomes.rule_a = 'fixed'
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
    throw error
  }
  return { resolved, record: ruleOutcomeRecordV1(decision, outcomes) }
}
