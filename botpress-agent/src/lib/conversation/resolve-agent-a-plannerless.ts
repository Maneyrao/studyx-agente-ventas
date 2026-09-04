import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import {
  assertsUnsupportedPrerequisitesV1,
  removeRepeatedAgentQuestionMessagesV1,
  validateAgentATurnProposalV1,
} from './agent-a-brain'
import type {
  AgentAProposalCycleEvidenceV1,
  AgentAProposalEnvelopeV1,
} from './resolve-agent-a-proposal'

function authorizedFactIds(context: AgentAContextV1): string[] {
  return [
    ...(context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []),
    ...context.catalog.areas.map((area) => area.fact_id),
    ...context.catalog.candidate_offerings.map((offering) => offering.fact_id),
    ...context.catalog.payment_plans.map((plan) => plan.fact_id),
  ]
}

function validatePlannerless(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
  readonly rejection_id: string
  readonly authorized_fact_ids: readonly string[]
}): TurnRejectionV1 | null {
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
  const paymentActionRequested = moves.has('request_payment_link')
    || (moves.has('provide_contact_details')
      && input.context.commercial_state.awaiting_reply === 'contact_details')
  const action = input.proposal.proposed_action
  const paymentTransitionAuthorized = action.type === 'send_payment_link'
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

function pruneRepeatedQuestion<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly rejection: TurnRejectionV1
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
}): T | null {
  if (!input.rejection.rejections.every((reason) => reason.code === 'REPEATED_AGENT_REPLY')) {
    return null
  }
  const previous = [...input.context.turn.recent_turns]
    .reverse()
    .find((turn) => turn.direction === 'outbound')?.content
  if (!previous) return null
  const currentCustomerText = input.context.turn.batch_messages.map((message) => message.text).join(' ')
  const messages = removeRepeatedAgentQuestionMessagesV1(
    input.initial.proposal.response.messages,
    previous,
    currentCustomerText,
  )
  if (messages.length === 0 || messages.length === input.initial.proposal.response.messages.length) {
    return null
  }
  const candidate = {
    ...input.initial,
    proposal: {
      ...input.initial.proposal,
      response: {
        ...input.initial.proposal.response,
        messages: messages as AgentATurnProposalV1['response']['messages'],
      },
    },
  } as T
  return validatePlannerless({
    proposal: candidate.proposal,
    context: input.context,
    rejection_id: input.rejection.rejection_id,
    authorized_fact_ids: input.authorized_fact_ids,
  }) === null ? candidate : null
}

/**
 * Denying a side effect does not require a second author to replace safe
 * customer-facing copy. When the only defect is an early payment action, the
 * boundary can remove that capability while preserving DeepSeek's wording.
 * A sentence claiming the link was sent is not safe to preserve and must go
 * through the single model repair instead.
 */
function demoteUnauthorizedPaymentAction<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly rejection: TurnRejectionV1
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
}): T | null {
  if (input.initial.proposal.proposed_action.type !== 'send_payment_link') return null
  if (claimsImmediatePaymentLinkDelivery(input.initial.proposal)) return null
  if (!input.rejection.rejections.some((reason) => (
    (reason.code === 'ACTION_NOT_AUTHORIZED' && reason.subject === 'send_payment_link')
    || reason.code === 'MISSING_INTAKE'
  ))) return null
  if (!input.rejection.rejections.every((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED' || reason.code === 'MISSING_INTAKE'
  ))) return null

  const candidate = {
    ...input.initial,
    proposal: { ...input.initial.proposal, proposed_action: { type: 'none' as const } },
  }
  const candidateRejection = validatePlannerless({
    proposal: candidate.proposal,
    context: input.context,
    rejection_id: input.rejection.rejection_id,
    authorized_fact_ids: input.authorized_fact_ids,
  })
  return candidateRejection === null ? candidate : null
}

/**
 * Códigos que el backend vuelve a verificar por su cuenta y puede vetar a
 * nivel de oración. Dejar pasar la propuesta con uno de estos es más seguro
 * que descartarla: el hecho falso muere igual en el egress, y la conversación
 * —que era lo único que se perdía— sobrevive.
 */
const BACKEND_ENFORCEABLE_CODES = new Set([
  'FACT_VALUE_MISMATCH',
  'FACT_NOT_AUTHORIZED',
  'REPEATED_AGENT_REPLY',
])

function mayDegradeToBackendBoundary(
  proposal: AgentATurnProposalV1,
  rejection: TurnRejectionV1,
): boolean {
  // Afirmar un efecto que no ocurrió no es un hecho que el egress pueda podar:
  // la oración entera es la mentira. Eso sigue siendo un rechazo duro.
  if (claimsImmediatePaymentLinkDelivery(proposal)) return false
  return rejection.rejections.every((reason) => BACKEND_ENFORCEABLE_CODES.has(reason.code))
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
}): Promise<{
  readonly effective: T
  readonly evidence: AgentAProposalCycleEvidenceV1
  readonly rejection: TurnRejectionV1 | null
}> {
  const factIds = authorizedFactIds(input.context)
  const rejection = validatePlannerless({
    proposal: input.initial.proposal,
    context: input.context,
    rejection_id: input.rejection_id,
    authorized_fact_ids: factIds,
  })
  if (rejection === null) {
    return {
      effective: input.initial,
      evidence: {
        rejection_codes: [], repair_attempted: false, repaired: false,
        proposal_generation_calls: 1,
      },
      rejection: null,
    }
  }

  const prunedRepeat = pruneRepeatedQuestion({
    initial: input.initial,
    rejection,
    context: input.context,
    authorized_fact_ids: factIds,
  })
  if (prunedRepeat !== null) {
    return {
      effective: prunedRepeat,
      evidence: {
        rejection_codes: rejection.rejections.map((reason) => reason.code),
        repair_attempted: false, repaired: false, proposal_generation_calls: 1,
      },
      rejection,
    }
  }

  const demoted = demoteUnauthorizedPaymentAction({
    initial: input.initial,
    rejection,
    context: input.context,
    authorized_fact_ids: factIds,
  })
  if (demoted !== null) {
    return {
      effective: demoted,
      evidence: {
        rejection_codes: rejection.rejections.map((reason) => reason.code),
        repair_attempted: false, repaired: false, proposal_generation_calls: 1,
      },
      rejection,
    }
  }

  const degraded = (repair_attempted: boolean) => ({
    effective: input.initial,
    evidence: {
      rejection_codes: rejection.rejections.map((reason) => reason.code),
      repair_attempted,
      repaired: false,
      proposal_generation_calls: repair_attempted ? (2 as const) : (1 as const),
    },
    rejection,
  })

  const mayRepair = input.repair_enabled && input.initial.proposal.repair_of === null
  if (!mayRepair) {
    if (mayDegradeToBackendBoundary(input.initial.proposal, rejection)) return degraded(false)
    throw new Error('PLANNERLESS_PROPOSAL_REJECTED')
  }

  try {
    const candidate = await input.repair(rejection)
    if (candidate.proposal.repair_of?.rejection_id !== rejection.rejection_id) {
      throw new Error('PLANNERLESS_REPAIR_ID_MISMATCH')
    }
    const candidateRejection = validatePlannerless({
      proposal: candidate.proposal,
      context: input.context,
      rejection_id: rejection.rejection_id,
      authorized_fact_ids: factIds,
    })
    if (candidateRejection === null) {
      return {
        effective: candidate,
        evidence: {
          rejection_codes: rejection.rejections.map((reason) => reason.code),
          repair_attempted: true, repaired: true, proposal_generation_calls: 2,
        },
        rejection,
      }
    }
  } catch {
    // The backend remains the final fail-closed boundary. A provider failure
    // never opens a second rewrite and never authorizes the original draft.
  }

  const prunedPrerequisites = pruneUnsupportedPrerequisiteClaimV1({
    initial: input.initial,
    rejection,
    context: input.context,
    authorized_fact_ids: factIds,
  })
  if (prunedPrerequisites !== null) {
    return {
      effective: prunedPrerequisites,
      evidence: {
        rejection_codes: rejection.rejections.map((reason) => reason.code),
        repair_attempted: true, repaired: false, proposal_generation_calls: 2,
      },
      rejection,
    }
  }

  if (mayDegradeToBackendBoundary(input.initial.proposal, rejection)) return degraded(true)

  const pruned = pruneFalseLinkDeliveryClaimV1({
    initial: input.initial,
    rejection,
    context: input.context,
    authorized_fact_ids: factIds,
  })
  if (pruned !== null) {
    return {
      effective: pruned,
      evidence: {
        rejection_codes: rejection.rejections.map((reason) => reason.code),
        repair_attempted: true, repaired: false, proposal_generation_calls: 2,
      },
      rejection,
    }
  }

  throw new Error('PLANNERLESS_PROPOSAL_REJECTED')
}

/**
 * Último recurso antes del silencio.
 *
 * Afirmar que el link sale cuando la acción no está autorizada es una mentira
 * de oración entera, así que exige la reparación del modelo y no se puede
 * podar por hecho. Pero cuando esa única reparación también falla, lanzar
 * dejaba el turno mudo: el workflow lo clasificaba como cerebro caído y
 * committeaba `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`.
 *
 * Lo observó el arnés de workflow en `wf_03_plan_postergacion_link`: la
 * persona entregó sus cuatro datos, pidió el link y no recibió absolutamente
 * nada, con 2046 ms de cerebro gastados. Un turno mudo es el peor resultado
 * posible de la conversación y es peor que uno recortado.
 *
 * El criterio es el mismo que ya se aplica a la pregunta repetida: se quita la
 * oración ofensiva y se entrega lo que queda, siempre que lo que queda valide
 * limpio por sí solo. La afirmación falsa nunca viaja, y si no sobrevive nada
 * verdadero el rechazo sigue siendo duro.
 */
function pruneFalseLinkDeliveryClaimV1<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly rejection: TurnRejectionV1
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
}): T | null {
  if (!claimsImmediatePaymentLinkDelivery(input.initial.proposal)) return null

  const safeMessages = input.initial.proposal.response.messages.filter((message) => !(
    SENDS_LINK_BEFORE_NOUN.test(message) || SENDS_LINK_AFTER_NOUN.test(message)
  ))
  if (safeMessages.length === 0) return null

  const candidate = {
    ...input.initial,
    proposal: {
      ...input.initial.proposal,
      response: { ...input.initial.proposal.response, messages: safeMessages },
      proposed_action: { type: 'none' as const },
    },
  } as T
  const candidateRejection = validatePlannerless({
    proposal: candidate.proposal,
    context: input.context,
    rejection_id: input.rejection.rejection_id,
    authorized_fact_ids: input.authorized_fact_ids,
  })
  return candidateRejection === null ? candidate : null
}

export type PlannerlessAgentATurnProposalV2 = AgentATurnProposalV1

/**
 * Poda de la afirmación de prerequisitos que el catálogo no respalda.
 *
 * `FACT_VALUE_MISMATCH` degrada a la frontera del backend, y para los hechos
 * que el egress puede vetar por valor eso está bien. Pero esta afirmación no
 * es un valor: es una oración entera que asegura algo del producto que nadie
 * confirmó, y degradar la dejaba llegar al cliente intacta. El guard quedaba
 * decorativo.
 *
 * Se quitó también del prompt canónico (v4), donde la biblioteca de objeciones
 * la ordenaba, pero el modelo la sigue produciendo por su cuenta.
 *
 * Sólo se podan afirmaciones: `assertsUnsupportedPrerequisitesV1` ya saltea las
 * interrogativas, así que la pregunta de diagnóstico que el canónico prescribe
 * pasa intacta.
 */
function pruneUnsupportedPrerequisiteClaimV1<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly rejection: TurnRejectionV1
  readonly context: AgentAContextV1
  readonly authorized_fact_ids: readonly string[]
}): T | null {
  if (!input.rejection.rejections.some((reason) => (
    reason.code === 'FACT_VALUE_MISMATCH' && reason.subject === 'prerequisites'
  ))) return null

  const safeMessages = input.initial.proposal.response.messages
    .filter((message) => !assertsUnsupportedPrerequisitesV1(message))
  if (safeMessages.length === 0) return null

  const candidate = {
    ...input.initial,
    proposal: {
      ...input.initial.proposal,
      response: { ...input.initial.proposal.response, messages: safeMessages },
    },
  } as T
  const candidateRejection = validatePlannerless({
    proposal: candidate.proposal,
    context: input.context,
    rejection_id: input.rejection.rejection_id,
    authorized_fact_ids: input.authorized_fact_ids,
  })
  return candidateRejection === null ? candidate : null
}
