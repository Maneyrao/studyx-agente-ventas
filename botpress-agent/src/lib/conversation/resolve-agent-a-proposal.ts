import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import type { ComposedNarrativeV1, TurnPlanV1 } from '../../schemas/conversation-pipeline'
import {
  buildSafeAgentABrainCompositionV1,
  decideRepairLevelV1,
  validateAgentATurnProposalV1,
} from './agent-a-brain'
import { lastAgentReplyV1 } from './conversation-composer'

export interface AgentAProposalEnvelopeV1 {
  readonly proposal: AgentATurnProposalV1
}

export interface AgentAProposalCycleEvidenceV1 {
  readonly rejection_codes: readonly string[]
  readonly repair_attempted: boolean
  readonly repaired: boolean
  readonly proposal_generation_calls: 1 | 2
}

/**
 * Provider-independent authority boundary shared by production and local evals.
 * It may validate and request one rewrite; it never performs I/O by itself.
 */
export async function resolveAgentAProposalV1<T extends AgentAProposalEnvelopeV1>(input: {
  readonly initial: T
  readonly context: AgentAContextV1
  readonly response_goal: TurnPlanV1['response_goal']
  readonly planned_fact_ids: readonly string[]
  readonly repair_enabled: boolean
  readonly repair: (rejection: TurnRejectionV1) => Promise<T>
  readonly rejection_id: string
}): Promise<{
  readonly composition: ComposedNarrativeV1
  readonly effective: T
  readonly evidence: AgentAProposalCycleEvidenceV1
  readonly rejection: TurnRejectionV1 | null
  readonly resolution_level: 'accepted' | 'N1' | 'N2' | 'N3'
}> {
  const rejection = validateAgentATurnProposalV1({
    proposal: input.initial.proposal,
    context: input.context,
    planned_fact_ids: input.planned_fact_ids,
    rejection_id: input.rejection_id,
  })

  if (rejection === null) {
    return {
      effective: input.initial,
      composition: buildSafeAgentABrainCompositionV1({
        proposal: input.initial.proposal,
        context: input.context,
        response_goal: input.response_goal,
        planned_fact_ids: input.planned_fact_ids,
      }),
      evidence: {
        rejection_codes: [],
        repair_attempted: false,
        repaired: false,
        proposal_generation_calls: 1,
      },
      rejection: null,
      resolution_level: 'accepted',
    }
  }

  const provisional = buildSafeAgentABrainCompositionV1({
    proposal: input.initial.proposal,
    context: input.context,
    response_goal: input.response_goal,
    planned_fact_ids: input.planned_fact_ids,
  })
  const prunedMessages = [
    provisional.narrative.opening,
    provisional.narrative.explanation,
    provisional.narrative.next_question,
  ].filter((message): message is string => typeof message === 'string')
  const ladder = decideRepairLevelV1({
    rejection,
    pruned_messages: prunedMessages,
    repair_enabled: input.repair_enabled,
    already_repaired: input.initial.proposal.repair_of !== null,
    previous_agent_reply: lastAgentReplyV1(input.context.turn.recent_turns),
  })

  let effective = input.initial
  let repairAttempted = false
  let repaired = false

  if (ladder.level === 'N2') {
    repairAttempted = true
    try {
      const candidate = await input.repair(rejection)
      const revalidated = validateAgentATurnProposalV1({
        proposal: candidate.proposal,
        context: input.context,
        planned_fact_ids: input.planned_fact_ids,
        rejection_id: rejection.rejection_id,
      })
      if (revalidated === null) {
        effective = candidate
        repaired = true
      }
    } catch {
      // N3/N1 composition below is the fail-closed result. The caller owns
      // provider-specific logging; this pure cycle owns only the evidence.
    }
  }

  return {
    effective,
    composition: buildSafeAgentABrainCompositionV1({
      proposal: effective.proposal,
      context: input.context,
      response_goal: input.response_goal,
      planned_fact_ids: input.planned_fact_ids,
    }),
    evidence: {
      rejection_codes: rejection.rejections.map((reason) => reason.code),
      repair_attempted: repairAttempted,
      repaired,
      proposal_generation_calls: repairAttempted ? 2 : 1,
    },
    rejection,
    resolution_level: ladder.level,
  }
}
