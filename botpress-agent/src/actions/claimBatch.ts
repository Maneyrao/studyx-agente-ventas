import { Action } from '@botpress/runtime'
import { ClaimBatchInputSchema, ClaimResponseSchema } from '../schemas/contracts'
import { requestStudyxJson } from '../utils/http'

// ADK 2.0.5 currently resolves two internal ZUI copies at this primitive
// boundary. Runtime validation still uses these schemas; the `any` parameters
// only prevent TypeScript from treating the duplicate package identities as
// incompatible.

/**
 * Take ownership of an inbound batch and, only if this caller wins it, receive
 * the one controlled context the model may see.
 *
 * The non-2xx statuses here are *answers*, not errors:
 *
 *   200 claimed   — this workflow owns the window
 *   202 waiting   — the window is still open; sleep `retry_after_ms`
 *   409 absorbed  — another workflow owns it; stop, do not call the model
 *   409 completed — the batch already produced its decision
 *   410 abandoned — terminal; the reconciler owns it now
 *
 * They are listed in `acceptStatuses` so a losing workflow reads its outcome
 * instead of raising, which is what keeps it from retrying into a duplicate.
 */
export const claimBatch = new Action<any, any>({
  name: 'claimBatch',
  title: 'Claim StudyX inbound batch',
  description: 'Takes ownership of one inbound batch and returns its controlled context.',
  input: ClaimBatchInputSchema as any,
  output: ClaimResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = ClaimBatchInputSchema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/batches/${validated.batch_id}/claim`,
      body: { trace_id: validated.trace_id, claimed_by: validated.claimed_by },
      idempotencyKey: `claim:${validated.batch_id}`,
      traceId: validated.trace_id,
      responseSchema: ClaimResponseSchema,
      acceptStatuses: [202, 404, 409, 410],
    })
  },
})
