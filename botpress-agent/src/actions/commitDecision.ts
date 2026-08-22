import { Action, z } from '@botpress/runtime'
import { CommitDecisionInputSchema, CommitDecisionResponseSchema } from '../schemas/contracts'
import { requestStudyxJson } from '../utils/http'

/**
 * Extends the frozen wire contract (`CommitDecisionInputSchema` in
 * schemas/contracts.ts, which Next.js also validates against and stays
 * untouched here) with the batch fencing pair the backend needs to close
 * the batch right after a successful — or replayed — commit
 * (docs/contracts/agent-a-operational-mvp.md §8: "El batch debe terminar
 * completed"). Declared locally because this widens only what THIS action
 * accepts before forwarding; the backend independently revalidates both
 * fields against its own claim/lease state before ever closing anything.
 */
const CommitDecisionWithBatchSchema = CommitDecisionInputSchema.extend({
  batch_id: z.string().uuid(),
  claim_token: z.string().uuid(),
})

export const commitDecision = new Action<any, any>({
  name: 'commitDecision',
  title: 'Commit StudyX turn decision',
  description: 'Asks the canonical backend to validate and atomically commit one turn decision, then close its batch.',
  input: CommitDecisionWithBatchSchema as any,
  output: CommitDecisionResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = CommitDecisionWithBatchSchema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/turns/${encodeURIComponent(validated.turn_id)}/decision`,
      body: validated,
      idempotencyKey: `decision:${validated.turn_id}`,
      traceId: validated.trace_id,
      responseSchema: CommitDecisionResponseSchema,
    })
  },
})
