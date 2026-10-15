import type { AgentAContextV1 } from '../../schemas/agent-a-brain'
import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import { authorizedFactIds } from './resolve-agent-a-plannerless'

export interface RecoveryFeedbackV1 {
  batch_id: string
  conversation_id: string
  turn_id: string
  selected_offering_code: string | null
  rejection: TurnRejectionV1
}

/** A prior rejection is evidence, never a carried permission or stale state. */
export function bindRecoveryFeedbackV1(input: {
  feedback: RecoveryFeedbackV1 | null | undefined
  batch_id: string
  conversation_id: string
  turn_id: string
  context: AgentAContextV1
}): TurnRejectionV1 | null {
  const prior = input.feedback
  if (!prior || prior.batch_id !== input.batch_id
    || prior.conversation_id !== input.conversation_id || prior.turn_id !== input.turn_id
    || prior.selected_offering_code !== input.context.commercial_state.selected_offering_code) return null
  return {
    ...prior.rejection,
    authorized_alternatives: {
      fact_ids: authorizedFactIds(input.context),
      actions: ['none'],
      missing_information: [...(input.context.capabilities.intake_missing ?? [])],
    },
  }
}
