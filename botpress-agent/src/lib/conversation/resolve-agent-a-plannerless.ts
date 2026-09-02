import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import { validateAgentATurnProposalV1 } from './agent-a-brain'
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
  const rejection = validateAgentATurnProposalV1({
    proposal: input.proposal,
    context: input.context,
    planned_fact_ids: citedAuthorizedIds,
    rejection_id: input.rejection_id,
  })
  return rejection === null ? null : {
    ...rejection,
    authorized_alternatives: {
      ...rejection.authorized_alternatives,
      fact_ids: [...input.authorized_fact_ids],
    },
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

  const mayRepair = input.repair_enabled && input.initial.proposal.repair_of === null
  if (!mayRepair) {
    return {
      effective: input.initial,
      evidence: {
        rejection_codes: rejection.rejections.map((reason) => reason.code),
        repair_attempted: false, repaired: false, proposal_generation_calls: 1,
      },
      rejection,
    }
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

  return {
    effective: input.initial,
    evidence: {
      rejection_codes: rejection.rejections.map((reason) => reason.code),
      repair_attempted: true, repaired: false, proposal_generation_calls: 2,
    },
    rejection,
  }
}

export type PlannerlessAgentATurnProposalV2 = AgentATurnProposalV1
