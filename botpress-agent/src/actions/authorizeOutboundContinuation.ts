import { Action, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'

export const authorizeOutboundContinuation = new Action<any, any>({
  name: 'authorizeOutboundContinuation',
  title: 'Check pending outbound continuation',
  description: 'Checks ownership and ordering before resuming an unsent response part.',
  input: z.object({ outbound_id: z.string().uuid(), trace_id: z.string().uuid(),
    delivery_attempt: z.number().int().min(1) }) as any,
  output: z.object({ outcome: z.enum(['authorized', 'superseded', 'not_owner']),
    trace_id: z.string().uuid(), outbound_id: z.string().uuid(), reason: z.string().optional(),
    botpress_message_id: z.string().min(1).max(512).optional() }) as any,
  cached: false,
  async handler({ input }: { input: { outbound_id: string; trace_id: string; delivery_attempt: number } }) {
    return requestStudyxJson({
      path: `/api/agent/outbounds/${encodeURIComponent(input.outbound_id)}/continuation`,
      body: { trace_id: input.trace_id, delivery_attempt: input.delivery_attempt },
      idempotencyKey: `continuation:${input.outbound_id}:${input.delivery_attempt}`,
      traceId: input.trace_id,
      responseSchema: z.object({ outcome: z.enum(['authorized', 'superseded', 'not_owner']),
        trace_id: z.string().uuid(), outbound_id: z.string().uuid(), reason: z.string().optional(),
        botpress_message_id: z.string().min(1).max(512).optional() }),
    })
  },
})
