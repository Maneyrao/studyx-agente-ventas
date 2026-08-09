import { Action } from '@botpress/runtime'
import { DeliveryReportInputSchema, DeliveryReportResponseSchema } from '../schemas/contracts'
import { requestStudyxJson } from '../utils/http'

export const reportDelivery = new Action<any, any>({
  name: 'reportDelivery',
  title: 'Report StudyX delivery state',
  description: 'Records Botpress submission or failure without claiming provider delivery.',
  input: DeliveryReportInputSchema as any,
  output: DeliveryReportResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = DeliveryReportInputSchema.parse(input)
    const messageIdentity = validated.botpress_message_id ?? 'none'
    return requestStudyxJson({
      path: `/api/agent/outbounds/${encodeURIComponent(validated.outbound_id)}/delivery`,
      body: validated,
      idempotencyKey: `delivery:${validated.outbound_id}:${messageIdentity}:${validated.status}`,
      traceId: validated.trace_id,
      responseSchema: DeliveryReportResponseSchema,
    })
  },
})
