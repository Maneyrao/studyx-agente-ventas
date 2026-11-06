import { rejectedProfileValuesInReplyV1, textMentionsRejectedValueV1 } from './contact-profile-receipt-claims'
import { claimsImmediatePaymentLinkDeliveryV1 } from '../../../../src/shared/conversation/payment-link-claim'
import { claimsProgramSendNowV1 } from '../../../../src/shared/conversation/program-send-claim'
import { inspectCourseBonusClaimsV1 } from '../../../../src/shared/conversation/course-bonus-claim'
import { courseLogisticsInV1 } from '../../../../src/shared/conversation/course-logistics'
import { hardClaimKindsInSentenceV1, splitClaimSentencesV1 } from '../../../../src/shared/conversation/hard-claims'
import { sentencesOverlapV1 } from '../../../../src/shared/conversation/sentence-locator'
import { assertedCommercialPricesV1 } from '../../../../src/features/orchestration/domain/commercial-truth-guard'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import {
  claimsImmediateCallDispatchV1,
  hasAuthorizedPrerequisiteStatementV1,
  withoutUnsupportedPrerequisiteClausesV1,
} from './agent-a-brain'

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

/** A sentence the backend guard flagged, with the reply bubble that carries it when it could tell. */
export interface BackendSentenceV1 {
  readonly sentence: string
  readonly message_index?: number
}

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

/**
 * profile_requests point at a bubble by index. When bubbles are removed, keep
 * the requests whose bubble survived and re-index them; a request whose bubble
 * was removed goes with it.
 */
export function remapProfileRequestsV1(
  requests: AgentATurnProposalV1['profile_requests'],
  keptIndices: readonly number[],
): AgentATurnProposalV1['profile_requests'] {
  return (requests ?? []).flatMap((request) => {
    const index = keptIndices.indexOf(request.message_index)
    return index < 0 ? [] : [{ ...request, message_index: index }]
  })
}

/** Sentence-level removal of wrong facts across the reply bubbles. */
export function removeOffendingSentencesV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  /** Violating sentences reported by the backend guard. */
  readonly backend_sentences?: readonly BackendSentenceV1[]
  /** Subjects of the backend rejection: a canonical plans sentence is only owed to price/payment subjects. */
  readonly backend_subjects?: readonly string[]
}): { messages: string[]; kept_indices: number[]; call_offer: string | null; removed: RemovedSentenceV1[] } {
  const { proposal, context } = input
  const authorizedPrices = new Set(authorizedValues(context).flatMap((value) => assertedCommercialPricesV1(value)))
  const authorizedLogistics = new Set(authorizedValues(context).flatMap((value) => courseLogisticsInV1(value)))
  const bonusNames = authorizedBonusNames(context, proposal)
  const knownNames = context.catalog.available_offerings.map((offering) => offering.display_name)
  const paidNames = context.catalog.selected_offering ? [context.catalog.selected_offering.display_name] : []
  const backend = input.backend_sentences ?? []
  const backendPriceSubject = input.backend_subjects === undefined
    || input.backend_subjects.some(subject => /^(?:price|payment|forbidden_price|invented_discount)/u.test(subject))
  const removed: RemovedSentenceV1[] = []
  const prerequisiteIsAuthorized = hasAuthorizedPrerequisiteStatementV1({
    context,
    fact_ids: proposal.used_fact_ids ?? [],
  })

  // Segmentation differs between backend and Botpress: match by bubble index plus containment.
  const inspect = (sentence: string, bubble: string, bubbleIndex: number): string[] => {
    const kinds: string[] = []
    if (backend.some((entry) => (entry.message_index === undefined || entry.message_index === bubbleIndex)
      && sentencesOverlapV1(entry.sentence, sentence))) kinds.push('backend')
    if (assertedCommercialPricesV1(sentence).some((price) => !authorizedPrices.has(price))) kinds.push('price')
    if (courseLogisticsInV1(sentence).some((fact) => !authorizedLogistics.has(fact))) kinds.push('logistics')
    if (inspectCourseBonusClaimsV1({ content: sentence, authorized_bonus_names: bonusNames,
      known_offering_names: knownNames, paid_offering_names: paidNames }).has_unauthorized_claim) kinds.push('promise')
    for (const kind of hardClaimKindsInSentenceV1(sentence, { tradeText: bubble,
      promoExpiresAt: context.capabilities.course_bonus?.sales_flow?.promo_expires_at })) kinds.push(kind)
    return kinds
  }
  const clean = (text: string, bubbleIndex: number): string => {
    const kept: string[] = []
    for (const original of splitClaimSentencesV1(text)) {
      // Unsupported prerequisites: keep the supported part of the sentence when possible.
      const sentence = prerequisiteIsAuthorized
        ? original
        : withoutUnsupportedPrerequisiteClausesV1(original) === original.trim()
          ? original : withoutUnsupportedPrerequisiteClausesV1(original)
      const prerequisiteTouched = sentence !== original
      const kinds = inspect(sentence, text, bubbleIndex)
      if (kinds.length > 0) {
        removed.push({ sentence: original.trim(), kinds,
          price_related: kinds.some((kind) => ['price', 'forbidden_price', 'invented_discount'].includes(kind)
            || (kind === 'backend' && backendPriceSubject))
            && /usd|us\$|\$|\d|cuota|pago|precio|valor|descuento|beca/iu.test(original) })
        continue
      }
      if (prerequisiteTouched) removed.push({ sentence: original.trim(), kinds: ['prerequisites'], price_related: false })
      kept.push(sentence)
    }
    return kept.join('').replace(/\s{2,}/gu, ' ').trim()
  }
  const cleaned = proposal.response.messages.map((message, index) => ({ index, message: clean(message, index) }))
    .filter((entry) => entry.message.length > 0)
  const messages = cleaned.map((entry) => entry.message)
  const callOffer = proposal.response.call_offer
  const cleanedOffer = typeof callOffer === 'string' ? clean(callOffer, -1) : null
  return { messages, kept_indices: cleaned.map((entry) => entry.index), call_offer: cleanedOffer && cleanedOffer === callOffer ? callOffer : null, removed }
}

/**
 * Wrong fact: remove only the offending sentences, append the canonical plan
 * sentence when a price/plan claim was removed, and return the new proposal.
 * Returns null when nothing changed or nothing deliverable would remain.
 */
export function salvageFactClaimsV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly backend_sentences?: readonly BackendSentenceV1[]
  readonly backend_subjects?: readonly string[]
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
  return {
    ...proposal,
    used_fact_ids: usedFactIds,
    response: { ...proposal.response, messages: messages as [string, ...string[]], call_offer: result.call_offer },
    profile_requests: remapProfileRequestsV1(proposal.profile_requests, result.kept_indices),
  }
}

/**
 * The only defect is a claim that the programme PDF is being sent now (it was already sent, or the
 * course has no PDF): drop just the claiming sentences, keep the rest of the reply and, when
 * nothing is left, state the canonical fact instead (facts, not sales copy). Never silence.
 */
export function salvageProgramSendClaimsV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): AgentATurnProposalV1 | null {
  const { proposal, context } = input
  const moves = [proposal.move?.move, ...(proposal.move?.secondary_moves ?? [])]
  const programTopic = moves.includes('request_course_program')
  let removedAny = false
  const clean = (text: string): string => splitClaimSentencesV1(text)
    .filter(sentence => {
      const claims = claimsProgramSendNowV1(sentence, { programTopic })
      removedAny ||= claims
      return !claims
    }).join('').replace(/\s{2,}/gu, ' ').trim()
  const kept = proposal.response.messages.map(clean).filter(message => message.length > 0)
  const offer = proposal.response.call_offer
  const cleanedOffer = typeof offer === 'string' ? clean(offer) : null
  if (!removedAny) return null
  const action = proposal.proposed_action
  const code = action.type === 'send_course_program' ? action.offering_code
    : context.catalog.selected_offering?.code ?? null
  const name = (code !== null ? context.catalog.available_offerings.find(offering => offering.code === code)?.display_name : undefined)
    ?? context.catalog.selected_offering?.display_name ?? null
  const programs = context.capabilities.course_programs
  const alreadySent = code !== null && programs?.sent_offering_codes.includes(code) === true
  // Structured availability, never prose: material the capability lists for
  // this course exists. A removed claim must not become "no tengo el archivo"
  // (2026-11-05, 18:20Z: Real Estate had image + PDF available).
  const available = code !== null && programs?.available_offering_codes.includes(code) === true
  const label = name === null ? 'El programa' : `El programa de ${name}`
  const fact = alreadySent
    ? `${label} te lo envié más arriba en este chat.`
    : available ? `${label} lo tengo disponible; si querés, te lo comparto.`
    : name === null ? 'No tengo el archivo del programa para enviarte, pero te cuento lo que incluye el curso.'
      : `No tengo el archivo del programa de ${name} para enviarte, pero te cuento lo que incluye el curso.`
  // The canonical fact always replaces what was removed, so the reply states the true situation once.
  // An available, unsent programme needs no statement when other copy remains.
  const statesDelivery = kept.some(message => /\bya\s+te\s+(?:lo\s+|la\s+)?(?:envi|mand|compart|pas|dej)\p{L}*|\bte\s+(?:lo|la)\s+hab[ií]a\s+\p{L}+|m[aá]s\s+arriba\b/iu.test(message))
  const messages = statesDelivery || (available && !alreadySent && kept.length > 0) ? kept : [fact, ...kept]
  return {
    ...proposal,
    proposed_action: { type: 'none' },
    response: { ...proposal.response, messages: messages.slice(0, 2) as [string, ...string[]],
      call_offer: cleanedOffer && cleanedOffer === offer ? offer : null },
    profile_requests: [],
  }
}

function normalizedIncludes(message: string, name: string): boolean {
  return fold(message).includes(fold(name))
}

/**
 * An effect that did not happen cannot be claimed. Remove only the bubbles that
 * claim it (payment link delivered, programme PDF being sent, call dispatched, gift named as bonus) and
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
  const rejectedValues = rejectedProfileValuesInReplyV1({ proposal, context })
  const programTopic = [proposal.move?.move, ...(proposal.move?.secondary_moves ?? [])].includes('request_course_program')
  const claims = (message: string) => claimsImmediatePaymentLinkDeliveryV1(message)
    || claimsProgramSendNowV1(message, { programTopic })
    || claimsImmediateCallDispatchV1(message, status)
    || (bonusName !== null && normalizedIncludes(message, bonusName))
    || rejectedValues.some((update) => textMentionsRejectedValueV1(message, update))
  const keptIndices = proposal.response.messages.flatMap((message, index) => (claims(message) ? [] : [index]))
  const messages = keptIndices.map((index) => proposal.response.messages[index]!)
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
    profile_requests: remapProfileRequestsV1(proposal.profile_requests, keptIndices),
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
