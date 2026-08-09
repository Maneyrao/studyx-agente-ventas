import { Action } from '@botpress/runtime'
import { CommitDecisionInputSchema, CommitDecisionResponseSchema } from '../schemas/contracts'
import { requestStudyxJson } from '../utils/http'

export const commitDecision = new Action<any, any>({
  name: 'commitDecision',
  title: 'Commit StudyX turn decision',
  description: 'Asks the canonical backend to validate and atomically commit one turn decision.',
  input: CommitDecisionInputSchema as any,
  output: CommitDecisionResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = CommitDecisionInputSchema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/turns/${encodeURIComponent(validated.turn_id)}/decision`,
      body: validated,
      idempotencyKey: `decision:${validated.turn_id}`,
      traceId: validated.trace_id,
      responseSchema: CommitDecisionResponseSchema,
    })
  },
})
