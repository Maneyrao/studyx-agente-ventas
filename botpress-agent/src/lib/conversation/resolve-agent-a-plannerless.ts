import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import { AgentATurnProposalV1Schema, type AgentAContextV1, type AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import {
  AgentABrainError,
  validateAgentATurnProposalV1,
} from './agent-a-brain'
import type {
  AgentAProposalCycleEvidenceV1,
  AgentAProposalEnvelopeV1,
} from './resolve-agent-a-proposal'


function authorizedFactIds(context: AgentAContextV1): string[] {
  return [
    ...(context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []),
    ...context.catalog.available_offerings.map((offering) => offering.fact_id),
    ...context.catalog.areas.map((area) => area.fact_id),
    ...context.catalog.candidate_offerings.flatMap((offering) => [
      offering.fact_id, ...(offering.facts?.map((fact) => fact.id) ?? []),
    ]),
    ...context.catalog.payment_plans.map((plan) => plan.fact_id),
    ...(context.catalog.test_payment_options?.map((option) => option.fact_id) ?? []),
  ]
}

function validatePlannerless(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly rejection_id: string
  readonly authorized_fact_ids: readonly string[]
}): TurnRejectionV1 | null {
  const parsed = AgentATurnProposalV1Schema.safeParse(input.proposal)
  if (!parsed.success) {
    return {
      schema_version: 1, rejection_id: input.rejection_id, attempt: 1,
      rejections: parsed.error.issues.map((issue) => ({
        code: issue.message === 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID'
          ? 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID' as const : 'PROPOSAL_SCHEMA_INVALID' as const,
        subject: issue.path.filter((part) => typeof part === 'string' && /^[a-z_]+$/iu.test(part)).join('.') || 'proposal',
      })),
      authorized_alternatives: { fact_ids: [...input.authorized_fact_ids], actions: ['none'], missing_information: [] },
    }
  }
  const authorized = new Set(input.authorized_fact_ids)
  // In the plannerless route, a fact becomes usable only when the model cites
  // it. The complete context list is returned as the repair alternative; it
  // does not silently authorize uncited prose.
  const citedAuthorizedIds = input.proposal.used_fact_ids.filter((id) => authorized.has(id))
  let rejection = validateAgentATurnProposalV1({
    proposal: input.proposal,
    context: input.context,
    planned_fact_ids: citedAuthorizedIds,
    rejection_id: input.rejection_id,
  })
  const moves = new Set([
    input.proposal.move.move,
    ...input.proposal.move.secondary_moves,
  ])
  const paymentDeferred = moves.has('defer_payment') || moves.has('decline_purchase')
    || input.proposal.move.vetoes.includes('payment_link')
    || input.proposal.move.vetoes.includes('purchase')
  const paymentActionRequested = !paymentDeferred && (moves.has('request_payment_link')
    || (moves.has('provide_contact_details')
      && input.context.commercial_state.awaiting_reply === 'contact_details'))
  const action = input.proposal.proposed_action
  const paymentTransitionAuthorized = action.type === 'send_payment_link'
    && input.context.capabilities.may_send_payment_link
    && paymentActionRequested
    && !input.proposal.move.vetoes.includes('payment_link')
    && !input.proposal.move.vetoes.includes('purchase')
    && (input.context.capabilities.intake_missing ?? []).length === 0
    && action.offering_code === input.context.commercial_state.selected_offering_code
    && action.payment_plan === (
      input.proposal.move.payment_plan
      ?? input.context.commercial_state.selected_payment_plan
    )
  if (rejection !== null && paymentTransitionAuthorized) {
    const remaining = rejection.rejections.filter((reason) => !(
      reason.subject === 'send_payment_link'
      || (reason.code === 'PLAN_NOT_SELECTED' && reason.subject === 'payment_plan')
    ))
    rejection = remaining.length === 0 ? null : { ...rejection, rejections: remaining }
  }
  if (input.proposal.proposed_action.type === 'send_payment_link' && !paymentActionRequested) {
    const actionReason = { code: 'ACTION_NOT_AUTHORIZED' as const, subject: 'send_payment_link' }
    rejection = rejection === null
      ? {
          schema_version: 1,
          rejection_id: input.rejection_id,
          attempt: 1,
          rejections: [actionReason],
          authorized_alternatives: {
            fact_ids: [], actions: ['none'],
            missing_information: [...(input.context.capabilities.intake_missing ?? [])],
          },
        }
      : {
          ...rejection,
          rejections: rejection.rejections.some((reason) => (
            reason.code === actionReason.code && reason.subject === actionReason.subject
          )) ? rejection.rejections : [...rejection.rejections, actionReason],
          authorized_alternatives: {
            ...rejection.authorized_alternatives,
            actions: rejection.authorized_alternatives.actions.filter(
              (action) => action !== 'send_payment_link',
            ),
          },
        }
  }
  return rejection === null ? null : {
    ...rejection,
    authorized_alternatives: {
      ...rejection.authorized_alternatives,
      fact_ids: [...input.authorized_fact_ids],
    },
  }
}

const SENDS_LINK_BEFORE_NOUN = /\b(?:ahora\s+)?te\s+(?:mando|env[ií]o|comparto|paso)\b.{0,48}\b(?:link|enlace)\b/iu
const SENDS_LINK_AFTER_NOUN = /\b(?:link|enlace)\b.{0,48}(?:\bya\s+(?:est[aá]|qued[oó])\b|\bte\s+(?:lo\s+)?(?:mand[eé]|envi[eé]|compart[ií]|pas[eé])\b)/iu

function claimsImmediatePaymentLinkDelivery(proposal: AgentATurnProposalV1): boolean {
  return proposal.response.messages.some((message) => (
    SENDS_LINK_BEFORE_NOUN.test(message) || SENDS_LINK_AFTER_NOUN.test(message)
  ))
}

/**
 * `request_payment_link` is already Agent A's structured tool decision. Map it
 * to the canonical resource call when every durable precondition is present;
 * this changes no customer-facing text and performs no semantic reinterpretation.
 */
function materializeAuthorizedPaymentAction<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly context: AgentAContextV1
}): T {
  if (input.initial.proposal.proposed_action.type !== 'none') return input.initial
  const moves = new Set([
    input.initial.proposal.move.move,
    ...input.initial.proposal.move.secondary_moves,
  ])
  if (!moves.has('request_payment_link')) return input.initial
  if (input.initial.proposal.move.vetoes.includes('payment_link')
    || input.initial.proposal.move.vetoes.includes('purchase')) return input.initial
  if (!input.context.capabilities.may_send_payment_link
    || (input.context.capabilities.intake_missing ?? []).length > 0) return input.initial
  const offeringCode = input.context.commercial_state.selected_offering_code
  const paymentPlan = input.initial.proposal.move.payment_plan
    ?? input.context.commercial_state.selected_payment_plan
  if (offeringCode === null || paymentPlan === null) return input.initial
  return {
    ...input.initial,
    proposal: {
      ...input.initial.proposal,
      proposed_action: {
        type: 'send_payment_link',
        offering_code: offeringCode,
        payment_plan: paymentPlan,
      },
    },
  }
}

/** Both the initial proposal and its one repair use this exact pipeline. */
function preparePlannerlessProposal<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
  readonly rejection_id: string
}): { effective: T; rejection: TurnRejectionV1 | null; originalRejection: TurnRejectionV1 | null } {
  const validate = (candidate: T) => validatePlannerless({
    proposal: candidate.proposal, context: input.context,
    authorized_fact_ids: input.authorized_fact_ids, rejection_id: input.rejection_id,
  })
  const originalRejection = validate(input.initial)
  if (originalRejection?.rejections.some((reason) => reason.code === 'PROPOSAL_SCHEMA_INVALID')) {
    return { effective: input.initial, rejection: originalRejection, originalRejection }
  }
  const effective = input.initial
  const rejection = validate(effective)
  if (rejection === null) return { effective, rejection, originalRejection }
  // An unavailable call needs the existing model repair: changing only the
  // action would publish an acknowledgement for a call that never occurred.
  if (hasOnlyNonBlockingGuidance(effective.proposal, rejection)) {
    return { effective, rejection: null, originalRejection }
  }
  return { effective, rejection, originalRejection }
}

/**
 * These codes describe conversational quality, not unsafe side effects.
 * They remain observable for evaluation, but must never discard a useful
 * model-authored reply or trigger a second paid generation.
 */
const NON_BLOCKING_GUIDANCE_CODES = new Set([
  'REPEATED_AGENT_REPLY',
  'CALL_OFFER_REQUIRED',
  'CHANNEL_PREFERENCE_NOT_SUPPORTED',
  'COURSE_NOT_RESOLVED',
  'MISSING_INTAKE',
])

function isNonBlockingGuidanceReason(
  reason: TurnRejectionV1['rejections'][number],
): boolean {
  if (NON_BLOCKING_GUIDANCE_CODES.has(reason.code)) return true
  // This heuristic only notices that Agent A compared unresolved candidates;
  // it does not prove a false catalog value. Treating it as a hard commercial
  // fact check duplicated the backend's canonical truth boundary and replaced
  // ordinary catalog guidance with a technical fallback. Prices, promises,
  // logistics, prerequisites and every other FACT_VALUE_MISMATCH stay hard.
  return reason.code === 'FACT_VALUE_MISMATCH'
    && reason.subject === 'candidate_course_detail'
}

function isMissingRequiredIntakeForRequestedCall(
  proposal: AgentATurnProposalV1,
  rejection: TurnRejectionV1,
): boolean {
  const moves = new Set([proposal.move.move, ...proposal.move.secondary_moves])
  return moves.has('request_call') && rejection.rejections.some((reason) => (
    reason.code === 'MISSING_INTAKE'
    && ['nombre', 'apellido', 'telefono'].includes(reason.subject)
  ))
}

function mayDegradeToBackendBoundary(
  proposal: AgentATurnProposalV1,
  rejection: TurnRejectionV1,
): boolean {
  // Afirmar un efecto que no ocurrió no es un hecho que el egress pueda podar:
  // la oración entera es la mentira. Eso sigue siendo un rechazo duro.
  if (claimsImmediatePaymentLinkDelivery(proposal)) return false
  if (isMissingRequiredIntakeForRequestedCall(proposal, rejection)) return false
  if ((proposal.proposed_action.type === 'send_payment_link'
    || proposal.proposed_action.type === 'send_test_payment_link') && rejection.rejections.some((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED' || reason.code === 'MISSING_INTAKE'
  ))) return false
  return rejection.rejections.every(isNonBlockingGuidanceReason)
}

function hasOnlyNonBlockingGuidance(
  proposal: AgentATurnProposalV1,
  rejection: TurnRejectionV1,
): boolean {
  if (isMissingRequiredIntakeForRequestedCall(proposal, rejection)) return false
  if ((proposal.proposed_action.type === 'send_payment_link'
    || proposal.proposed_action.type === 'send_test_payment_link') && rejection.rejections.some((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED' || reason.code === 'MISSING_INTAKE'
  ))) return false
  return rejection.rejections.every(isNonBlockingGuidanceReason)
}

function plannerlessRejectionError(rejection: TurnRejectionV1): Error {
  // Preserve the stable prefix used by callers while exposing only structural
  // rejection classes.  The workflow can then distinguish an invalid proposal
  // from a transport outage without recording customer text or model output.
  const classes = rejection.rejections
    .map((reason) => `${reason.code}:${reason.subject}`)
    .join(',')
  return new Error(`PLANNERLESS_PROPOSAL_REJECTED:${classes}`)
}

export type AgentActionRejectionActionV1 =
  | 'request_call_now'
  | 'send_payment_link'
  | 'send_test_payment_link'

export interface AgentActionRejectionV1 {
  readonly action: AgentActionRejectionActionV1
  readonly codes: readonly string[]
  readonly missing_fields: readonly string[]
  readonly retryable: boolean
}

export interface PlannerlessResolutionV2<T extends AgentAProposalEnvelopeV1> {
  readonly effective: T
  readonly evidence: AgentAProposalCycleEvidenceV1
  readonly rejection: TurnRejectionV1 | null
  readonly action_rejection: AgentActionRejectionV1 | null
}

const ACTION_REJECTION_CODES = new Set([
  'ACTION_NOT_AUTHORIZED',
  'MISSING_INTAKE',
  'PLAN_NOT_SELECTED',
])

function actionRejectionV1(
  proposal: AgentATurnProposalV1,
  rejection: TurnRejectionV1 | null,
): AgentActionRejectionV1 | null {
  const action = proposal.proposed_action.type
  if (action === 'none' || rejection === null) return null
  const codes = [...new Set(rejection.rejections
    .filter((reason) => ACTION_REJECTION_CODES.has(reason.code))
    .map((reason) => reason.code))]
  if (codes.length === 0) return null
  return {
    action,
    codes,
    missing_fields: [...new Set([
      ...rejection.authorized_alternatives.missing_information,
      ...(codes.includes('PLAN_NOT_SELECTED') ? ['payment_plan'] : []),
    ])],
    retryable: false,
  }
}

/**
 * Pre-commit validation for the plannerless route. DeepSeek still owns the
 * complete response and the next move. This boundary only tells it which
 * facts/actions were rejected and allows one rewrite before the backend
 * performs the same authoritative checks against durable state.
 */
export async function resolveAgentAPlannerlessProposalV2<
  T extends AgentAProposalEnvelopeV1,
>(input: {
  readonly initial: T
  readonly context: AgentAContextV1
  readonly repair_enabled: boolean
  readonly repair: (rejection: TurnRejectionV1) => Promise<T>
  readonly rejection_id: string
}): Promise<PlannerlessResolutionV2<T>> {
  const factIds = authorizedFactIds(input.context)
  const boundInitial = materializeAuthorizedPaymentAction({
    initial: input.initial,
    context: input.context,
  })
  const prepared = preparePlannerlessProposal({
    initial: boundInitial, context: input.context, authorized_fact_ids: factIds,
    rejection_id: input.rejection_id,
  })
  const rejection = prepared.rejection
  const initial = prepared.effective
  const originalRejection = prepared.originalRejection ?? rejection
  if (rejection === null) {
    return {
      effective: initial,
      evidence: {
        rejection_codes: originalRejection?.rejections.map((reason) => reason.code) ?? [],
        repair_attempted: false, repaired: false, proposal_generation_calls: 1,
      },
      rejection: originalRejection,
      action_rejection: null,
    }
  }
  const initialActionRejection = actionRejectionV1(initial.proposal, originalRejection)
  let terminalRejection = rejection
  const rejectedCodes = () => [...new Set([
    ...(originalRejection?.rejections.map((reason) => reason.code) ?? []),
    ...terminalRejection.rejections.map((reason) => reason.code),
  ])]
  const degraded = (repair_attempted: boolean) => ({
    effective: initial,
    evidence: {
      rejection_codes: rejectedCodes(),
      repair_attempted, repaired: false,
      proposal_generation_calls: repair_attempted ? (2 as const) : (1 as const),
    },
    rejection: terminalRejection,
    action_rejection: initialActionRejection,
  })
  const mayRepair = input.repair_enabled
    && initial.proposal.repair_of === null
  if (!mayRepair) {
    if (mayDegradeToBackendBoundary(initial.proposal, rejection)) return degraded(false)
    throw plannerlessRejectionError(rejection)
  }
  try {
    const candidate = await input.repair(rejection)
    if (candidate.proposal.repair_of?.rejection_id !== rejection.rejection_id) {
      terminalRejection = {
        ...rejection,
        rejections: [{ code: 'PROPOSAL_SCHEMA_INVALID', subject: 'repair_of.rejection_id' }],
      }
    } else {
      const repaired = preparePlannerlessProposal({
        initial: candidate, context: input.context, authorized_fact_ids: factIds,
        rejection_id: rejection.rejection_id,
      })
      if (repaired.rejection === null) {
        return {
          effective: repaired.effective,
          evidence: {
            rejection_codes: rejectedCodes(),
            repair_attempted: true, repaired: true, proposal_generation_calls: 2,
          },
          rejection: originalRejection,
          action_rejection: initialActionRejection,
        }
      }
      terminalRejection = repaired.rejection
    }
  } catch (error) {
    // A transport error never opens a second rewrite or authorizes a draft.
    // Retain the last structured validation result, not any customer text.
    if (error instanceof AgentABrainError && error.code === 'BRAIN_INVALID_SCHEMA') {
      const path = error.detail?.split(':')[0] ?? ''
      terminalRejection = {
        ...rejection,
        rejections: [{
          code: 'PROPOSAL_SCHEMA_INVALID',
          subject: /^[a-z_]+(?:\.[a-z_]+)*$/iu.test(path) ? path.slice(0, 160) : 'proposal',
        }],
      }
    }
  }
  const actionRejectedCandidate = pruneRejectedActionV1({
    initial,
    rejection,
    context: input.context,
    authorized_fact_ids: factIds,
  })
  if (actionRejectedCandidate !== null) {
    return {
      effective: actionRejectedCandidate,
      evidence: {
        rejection_codes: rejectedCodes(),
        repair_attempted: true, repaired: false, proposal_generation_calls: 2,
      },
      rejection: terminalRejection,
      action_rejection: initialActionRejection,
    }
  }
  if (mayDegradeToBackendBoundary(initial.proposal, rejection)) return degraded(true)
  throw plannerlessRejectionError(terminalRejection)
}

/**
 * An action rejection is not a conversation rejection. After the single
 * model repair has failed, remove only the structured effect and revalidate
 * the exact model-authored remainder. Existing validation still rejects any
 * wording that falsely claims the effect happened.
 */
function pruneRejectedActionV1<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly rejection: TurnRejectionV1
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
}): T | null {
  if (actionRejectionV1(input.initial.proposal, input.rejection) === null) return null
  // Removing the structured action cannot make an authored success claim
  // true. The response itself stays byte-for-byte model-owned; when it claims
  // an effect that did not happen, the whole proposal remains rejected and is
  // returned to Agent A for repair.
  if (claimsImmediatePaymentLinkDelivery(input.initial.proposal)) return null
  const candidate = {
    ...input.initial,
    proposal: {
      ...input.initial.proposal,
      proposed_action: { type: 'none' as const },
    },
  } as T
  const candidateRejection = validatePlannerless({
    proposal: candidate.proposal,
    context: input.context,
    rejection_id: input.rejection.rejection_id,
    authorized_fact_ids: input.authorized_fact_ids,
  })
  return candidateRejection === null
    || hasOnlyNonBlockingGuidance(candidate.proposal, candidateRejection)
    ? candidate
    : null
}

export type PlannerlessAgentATurnProposalV2 = AgentATurnProposalV1
