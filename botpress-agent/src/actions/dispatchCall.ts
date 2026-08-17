import { Action, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'

/**
 * Triggers the backend dispatch of an already-reserved call session.
 *
 * The backend is the only party that talks to the voice provider; this
 * action just pokes it AFTER the canonical commit, keyed by `call_id`. The
 * three non-accepted outcomes come back as data, not errors: `busy` and
 * `dispatch_ambiguous` mean "do not touch it again" (reconciliation owns
 * it — never an automatic redial), and `failed` is terminal.
 */

export const DispatchCallInputSchema = z.object({
  call_id: z.string().uuid(),
  trace_id: z.string().uuid(),
}).strict()

export const DispatchCallResponseSchema = z.object({
  status: z.enum(['provider_accepted', 'dispatch_ambiguous', 'failed', 'busy']),
  providerCallId: z.string().nullable(),
})

export const dispatchCall = new Action<any, any>({
  name: 'dispatchCall',
  title: 'Dispatch reserved voice call',
  description: 'Asks the backend to dispatch one reserved call session, idempotent by call_id.',
  input: DispatchCallInputSchema as any,
  output: DispatchCallResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = DispatchCallInputSchema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/calls/${encodeURIComponent(validated.call_id)}/dispatch`,
      body: { trace_id: validated.trace_id },
      idempotencyKey: `voice-call:${validated.call_id}`,
      traceId: validated.trace_id,
      responseSchema: DispatchCallResponseSchema,
      // 202 = ambiguous/busy, 502 = confirmed failure: outcomes, not errors.
      acceptStatuses: [200, 202, 502],
    })
  },
})
