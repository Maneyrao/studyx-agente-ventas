import { claimsImmediatePaymentLinkDeliveryV1 } from '../../../../src/shared/conversation/payment-link-claim'
import { inspectCourseBonusClaimsV1 } from '../../../../src/shared/conversation/course-bonus-claim'
import { courseLogisticsInV1 } from '../../../../src/shared/conversation/course-logistics'
import { hardClaimKindsInSentenceV1, splitClaimSentencesV1 } from '../../../../src/shared/conversation/hard-claims'
import { assertedCommercialPricesV1 } from '../../../../src/features/orchestration/domain/commercial-truth-guard'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import { claimsImmediateCallDispatchV1, withoutUnsupportedPrerequisiteClausesV1 } from './agent-a-brain'

/**
 * A wrong claim never silences a turn and never rewrites the model's voice.
 * These helpers remove only what is false (a bubble that claims an effect that
 * did not happen, or the single sentence that states a wrong fact) and, for a
 * wrong price/plan, append the canonical sentence built from catalog facts.
 * The caller always revalidates the whole proposal afterwards.
 */

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()

const PLAN_ORDER = ['monthly_12', 'monthly_6', 'one_time'] as const

/** Catalog payment facts rendered as one sentence; null when the catalog has none. */
export function canonicalPlansSentenceV1(context: AgentAContextV1): { message: string; fact_ids: string[] } | null {
  const plans = PLAN_ORDER.flatMap((code) => context.catalog.payment_plans.filter((plan) => plan.code === code))
  if (plans.length === 0) return null
  const labels = plans.map((plan) => plan.label.replace(/[.!?\s]+$/u, ''))
  const list = labels.length === 1 ? labels[0]! : `${labels.slice(0, -1).join(', ')} o ${labels.at(-1)}`
  return { message: `Las opciones son ${list}.`, fact_ids: plans.map((plan) => plan.fact_id) }
}

export type RemovedSentenceKindV1 = 'price' | 'prerequisites' | 'logistics' | 'promise' | 'hard_claim' | 'backend'

export interface RemovedSentenceV1 {
  readonly sentence: string
  readonly kinds: readonly string[]
  readonly price_related: boolean
}

function authorizedValues(context: AgentAContextV1): string[] {
  return [
    ...(context.catalog.selected_offering?.facts ?? []).map((fact) => fact.value),
    ...context.catalog.candidate_offerings.flatMap((offering) => (offering.facts ?? []).map((fact) => fact.value)),
    ...(context.catalog.bonus_candidate_fichas ?? []).map((candidate) => candidate.fact.value),
    ...(context.catalog.general_facts ?? []).map((fact) => fact.value),
    ...context.catalog.payment_plans.map((plan) => plan.label),
    ...(context.catalog.test_payment_options ?? []).map((option) => option.label),
  ]
}

function authorizedBonusNames(context: AgentAContextV1, proposal: AgentATurnProposalV1): string[] {
  const bonus = context.capabilities.course_bonus
  const action = proposal.proposed_action
  return [
    ...(bonus?.bonus_offerings ?? []).map((offering) => offering.display_name),
    ...(bonus?.delivered_bonus_offerings ?? []).map((offering) => offering.display_name),
    ...(action.type === 'offer_course_bonus'
      ? context.catalog.available_offerings.filter((offering) => offering.code === action.bonus_offering_code)
        .map((offering) => offering.display_name) : []),
  ]
}

/** Sentence-level removal of wrong facts across the reply bubbles. */
export function removeOffendingSentencesV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  /** Violating sentences reported by the backend guard. */
  readonly backend_sentences?: readonly string[]
}): { messages: string[]; call_offer: string | null; removed: RemovedSentenceV1[] } {
  const { proposal, context } = input
  const authorizedPrices = new Set(authorizedValues(context).flatMap((value) => assertedCommercialPricesV1(value)))
  const authorizedLogistics = new Set(authorizedValues(context).flatMap((value) => courseLogisticsInV1(value)))
  const bonusNames = authorizedBonusNames(context, proposal)
  const knownNames = context.catalog.available_offerings.map((offering) => offering.display_name)
  const paidNames = context.catalog.selected_offering ? [context.catalog.selected_offering.display_name] : []
  const backend = new Set((input.backend_sentences ?? []).map(fold))
  const removed: RemovedSentenceV1[] = []

  const inspect = (sentence: string, bubble: string): string[] => {
    const kinds: string[] = []
    if (backend.has(fold(sentence))) kinds.push('backend')
    if (assertedCommercialPricesV1(sentence).some((price) => !authorizedPrices.has(price))) kinds.push('price')
    if (courseLogisticsInV1(sentence).some((fact) => !authorizedLogistics.has(fact))) kinds.push('logistics')
    if (inspectCourseBonusClaimsV1({ content: sentence, authorized_bonus_names: bonusNames,
      known_offering_names: knownNames, paid_offering_names: paidNames }).has_unauthorized_claim) kinds.push('promise')
    for (const kind of hardClaimKindsInSentenceV1(sentence, { tradeText: bubble,
      promoExpiresAt: context.capabilities.course_bonus?.sales_flow?.promo_expires_at })) kinds.push(kind)
    return kinds
  }
  const clean = (text: string): string => {
    const kept: string[] = []
    for (const original of splitClaimSentencesV1(text)) {
      // Unsupported prerequisites: keep the supported part of the sentence when possible.
      const sentence = withoutUnsupportedPrerequisiteClausesV1(original) === original.trim()
        ? original : withoutUnsupportedPrerequisiteClausesV1(original)
      const prerequisiteTouched = sentence !== original
      const kinds = inspect(sentence, text)
      if (kinds.length > 0) {
        removed.push({ sentence: original.trim(), kinds,
          price_related: kinds.some((kind) => ['price', 'forbidden_price', 'invented_discount', 'backend'].includes(kind))
            && /usd|us\$|\$|\d|cuota|pago|precio|valor|descuento|beca/iu.test(original) })
        continue
      }
      if (prerequisiteTouched) removed.push({ sentence: original.trim(), kinds: ['prerequisites'], price_related: false })
      kept.push(sentence)
    }
    return kept.join('').replace(/\s{2,}/gu, ' ').trim()
  }
  const messages = proposal.response.messages.map(clean).filter((message) => message.length > 0)
  const callOffer = proposal.response.call_offer
  const cleanedOffer = typeof callOffer === 'string' ? clean(callOffer) : null
  return { messages, call_offer: cleanedOffer && cleanedOffer === callOffer ? callOffer : null, removed }
}

/**
 * Wrong fact: remove only the offending sentences, append the canonical plan
 * sentence when a price/plan claim was removed, and return the new proposal.
 * Returns null when nothing changed or nothing deliverable would remain.
 */
export function salvageFactClaimsV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly backend_sentences?: readonly string[]
}): AgentATurnProposalV1 | null {
  const { proposal, context } = input
  const result = removeOffendingSentencesV1(input)
  if (result.removed.length === 0) return null
  const messages = [...result.messages]
  const plans = canonicalPlansSentenceV1(context)
  let usedFactIds = proposal.used_fact_ids
  if (plans !== null && result.removed.some((entry) => entry.price_related)) {
    const text = fold(messages.join(' '))
    const alreadyStated = context.catalog.payment_plans.every((plan) => text.includes(fold(plan.label)))
    if (!alreadyStated) {
      if (messages.length < 2) messages.push(plans.message)
      else messages[messages.length - 1] = `${messages[messages.length - 1]} ${plans.message}`
      usedFactIds = [...new Set([...usedFactIds, ...plans.fact_ids])]
    }
  }
  if (messages.length === 0) return null
  const sameBubbles = messages.length === proposal.response.messages.length
  return {
    ...proposal,
    used_fact_ids: usedFactIds,
    response: { ...proposal.response, messages: messages as [string, ...string[]], call_offer: result.call_offer },
    profile_requests: sameBubbles ? proposal.profile_requests : [],
  }
}

function normalizedIncludes(message: string, name: string): boolean {
  return fold(message).includes(fold(name))
}

/**
 * An effect that did not happen cannot be claimed. Remove only the bubbles that
 * claim it (payment link delivered, call dispatched, gift named as bonus) and
 * drop the action. Returns null when no bubble claims anything or nothing remains.
 */
export function removeEffectClaimBubblesV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly bonus_offering_code?: string | null
}): AgentATurnProposalV1 | null {
  const { proposal, context } = input
  const bonusName = input.bonus_offering_code
    ? context.catalog.available_offerings.find((offering) => offering.code === input.bonus_offering_code)?.display_name ?? null
    : null
  const status = context.commercial_state.active_call?.status
  const claims = (message: string) => claimsImmediatePaymentLinkDeliveryV1(message)
    || claimsImmediateCallDispatchV1(message, status)
    || (bonusName !== null && normalizedIncludes(message, bonusName))
  const messages = proposal.response.messages.filter((message) => !claims(message))
  const offer = proposal.response.call_offer
  const offerClaims = typeof offer === 'string' && claims(offer)
  if (messages.length === proposal.response.messages.length && !offerClaims) return null
  if (messages.length === 0) return null
  return {
    ...proposal,
    proposed_action: { type: 'none' },
    course_mentions: bonusName === null ? proposal.course_mentions
      : (proposal.course_mentions ?? []).filter((mention) => !(mention.role === 'bonus' && mention.offering_code === input.bonus_offering_code)),
    response: { ...proposal.response, messages: messages as [string, ...string[]],
      call_offer: offerClaims ? null : proposal.response.call_offer },
    profile_requests: messages.length === proposal.response.messages.length ? proposal.profile_requests : [],
  }
}

/**
 * COURSE_ROLE_UNDECLARED is metadata, not prose. With no persisted selection
 * or package, rebuild course_mentions from the literal catalog names in the
 * reply: every named course not already declared in a valid role is an
 * `alternative`, and a `paid` declaration for a course that is not the current
 * focus is downgraded the same way. Prose, action and bonus declarations stay
 * untouched. Returns null when a durable selection/package exists or nothing
 * changes; the caller revalidates the whole proposal.
 */
export function repairCourseMentionRolesV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): AgentATurnProposalV1 | null {
  const { proposal, context } = input
  const bonus = context.capabilities.course_bonus
  if (context.catalog.selected_offering !== null && context.catalog.selected_offering !== undefined) return null
  if ((bonus?.delivered_bonus_offerings?.length ?? 0) > 0) return null
  if (proposal.proposed_action.type === 'offer_course_bonus') return null
  const text = [...proposal.response.messages, proposal.response.call_offer ?? ''].join('\n')
  const named = context.catalog.available_offerings.filter((offering) => normalizedIncludes(text, offering.display_name))
  const namedCodes = new Set(named.map((offering) => offering.code))
  const declared = new Map<string, AgentATurnProposalV1['course_mentions'][number]>()
  for (const mention of proposal.course_mentions ?? []) {
    if (!namedCodes.has(mention.offering_code) || mention.role === 'bonus') continue
    declared.set(mention.offering_code, mention.role === 'paid' ? { ...mention, role: 'alternative' } : mention)
  }
  for (const offering of named) {
    if (!declared.has(offering.code)) declared.set(offering.code, { offering_code: offering.code, role: 'alternative' })
  }
  const next = [...declared.values()]
  if (JSON.stringify(next) === JSON.stringify(proposal.course_mentions ?? [])) return null
  return { ...proposal, course_mentions: next }
}
