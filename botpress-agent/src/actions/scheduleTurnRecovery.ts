import { Action, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'
const inputSchema = z.object({ batch_id: z.string().uuid(), claim_token: z.string().uuid(),
  trace_id: z.string().uuid(), reason_code: z.string().regex(/^[A-Z0-9_]{1,128}$/u) })
const outputSchema = z.object({ outcome: z.enum(['scheduled', 'exhausted', 'superseded', 'not_owner', 'already_decided']),
  attempt: z.number().int().min(0).max(3), delay_ms: z.number().int().nonnegative() })
export const scheduleTurnRecovery = new Action<any, any>({
  name: 'scheduleTurnRecovery', title: 'Recover an unfinished StudyX turn',
  description: 'Durably releases an owned rejected turn for bounded recovery.',
  input: inputSchema as any, output: outputSchema as any, cached: false,
  async handler({ input }: { input: unknown }) {
    const value = inputSchema.parse(input)
    return requestStudyxJson({ path: `/api/agent/batches/${value.batch_id}/recovery`,
      body: { trace_id: value.trace_id, claim_token: value.claim_token, reason_code: value.reason_code },
      traceId: value.trace_id, idempotencyKey: `recovery:${value.batch_id}:${value.claim_token}`,
      responseSchema: outputSchema, additionalRetries: 0 })
  },
})
