import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'

/**
 * Owner rule 2026-11-18: a payment-link action that lacks the course level or the plan is not a
 * rejection when Agent A asks for exactly that, with the canonical options, in its own words.
 * The backend publishes `action_requirements`; this module only reads it. It never writes text.
 */
type Requirement = NonNullable<AgentAContextV1['capabilities']['action_requirements']>[number]

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase()
  .replace(/\s+/gu, ' ').trim()

function moveSet(proposal: AgentATurnProposalV1): Set<string> {
  return new Set([proposal.move.move, ...proposal.move.secondary_moves])
}

/** Missing items still unmet after what this very proposal supplies (level and/or plan). */
export function unmetPaymentLinkRequirementsV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly action_type: 'send_payment_link' | 'send_test_payment_link' | 'none'
}): Requirement | null {
  const { proposal, context } = input
  const type = input.action_type === 'none' ? 'send_payment_link' : input.action_type
  const requirement = context.capabilities.action_requirements?.find((entry) => entry.action === type)
  if (!requirement || requirement.ready) return null
  const state = context.commercial_state
  const action = proposal.proposed_action
  const moves = moveSet(proposal)
  const reference = proposal.move.course_reference
  const levelChosenNow = moves.has('select_course') && reference !== undefined
    && context.catalog.available_offerings.some((offering) => offering.code === reference)
    && (action.type === 'none' || ('offering_code' in action && action.offering_code === reference))
  const planCarriedNow = proposal.move.payment_plan !== undefined
    && context.catalog.payment_plans.some((plan) => plan.code === proposal.move.payment_plan)
    && (action.type === 'none' || ('payment_plan' in action && action.payment_plan === proposal.move.payment_plan))
  const missing = requirement.missing.filter((item) => (
    item === 'course_selection'
      ? state.selected_offering_code === null && !levelChosenNow
      : state.selected_payment_plan === null && !planCarriedNow
  ))
  return missing.length === 0 ? null : { ...requirement, missing }
}

/** The reply asks (with a question) for the first missing item, naming its options or the item itself. */
export function asksForFirstMissingRequirementV1(messages: readonly string[], requirement: Requirement): boolean {
  const text = fold(messages.join(' '))
  if (!text.includes('?')) return false
  const first = requirement.missing[0]
  if (first === 'course_selection') {
    return requirement.options.course_selection.some((option) => text.includes(fold(option.display_name)))
      || /\b(nivel|curso)\b/u.test(text)
  }
  if (first === 'payment_plan') return /\b(pago|pagos|cuota|cuotas|plan|mensual|mensuales)\b/u.test(text)
  return false
}

/**
 * A link action that lacks level/plan, whose reply asks for the first missing item: drop only
 * the action and keep the model's text. Null when it does not apply (the existing rejection
 * and its one repair stand). A reply that claims the link was sent is still rejected later.
 */
export function pruneLinkActionWhileMissingRequirementsV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): AgentATurnProposalV1 | null {
  const action = input.proposal.proposed_action
  // The test link needs no level or plan; only the sale link is pruned here.
  if (action.type !== 'send_payment_link') return null
  const requirement = unmetPaymentLinkRequirementsV1({ ...input, action_type: action.type })
  if (requirement === null || !asksForFirstMissingRequirementV1(input.proposal.response.messages, requirement)) return null
  return { ...input.proposal, proposed_action: { type: 'none' } }
}

/** The proposal leaves a link requirement unmet and its reply asks for it with the canonical options. */
export function asksUnmetPaymentLinkRequirementV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): boolean {
  const requirement = unmetPaymentLinkRequirementsV1({ ...input, action_type: 'none' })
  return requirement !== null && asksForFirstMissingRequirementV1(input.proposal.response.messages, requirement)
}
