import { Action, z } from '@botpress/runtime'
import {
  ConversationMoveV1Schema,
  ConversationPlanResponseV1Schema,
} from '../schemas/conversation-pipeline'
import { requestStudyxJson } from '../utils/http'

const PlanConversationInputV1Schema = z.object({
  turn_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  move: ConversationMoveV1Schema,
}).strict()

/** Botpress sends semantic meaning; the backend returns the only authorized plan. */
export const planConversation = new Action<any, any>({
  name: 'planConversation',
  title: 'Plan a StudyX conversation turn',
  description: 'Resolves structured conversational meaning against canonical backend state and facts.',
  input: PlanConversationInputV1Schema as any,
  output: ConversationPlanResponseV1Schema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = PlanConversationInputV1Schema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/turns/${encodeURIComponent(validated.turn_id)}/plan`,
      body: { trace_id: validated.trace_id, move: validated.move },
      idempotencyKey: `conversation-plan:${validated.turn_id}`,
      traceId: validated.trace_id,
      responseSchema: ConversationPlanResponseV1Schema,
      additionalRetries: 0,
    })
  },
})
