import { Trigger, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'
import { fallbackPostSaleNarrative, PostSaleClaimSchema } from '../utils/post-sale-instructions'

export default new Trigger({
  name: 'onStudyxPostSale',
  events: ['studyxPostSale'],
  handler: async ({ event }) => {
    const id = event.payload.notification_id
    const conversationId = event.conversationId
    if (!conversationId) return
    const traceId = crypto.randomUUID()
    const claimed = await requestStudyxJson({ path: `/api/agent/post-sale/${id}/claim`,
      body: { botpress_conversation_id: conversationId }, traceId, idempotencyKey: `post-sale-claim:${id}`, responseSchema: PostSaleClaimSchema })
    if (!claimed.claimed) return
    const narrative = fallbackPostSaleNarrative(claimed)
    try {
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
        body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
        traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`, responseSchema: z.object({ outcome: z.string() }),
      })
    } catch {
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/release`,
        body: { claim_token: claimed.claim_token }, traceId, idempotencyKey: `post-sale-release:${id}:${claimed.claim_token}`,
        responseSchema: z.object({ outcome: z.string() }),
      })
      console.warn(JSON.stringify({ event: 'studyx.post_sale.retry', notification_id: id }))
    }
  },
})
