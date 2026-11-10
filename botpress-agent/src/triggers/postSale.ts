import { Trigger, client } from '@botpress/runtime'
import { getOrCreateEvidenceWorkflow } from '../lib/observability/evidence-workflow'

export default new Trigger({
  name: 'onStudyxPostSale',
  events: ['studyxPostSale'],
  handler: async ({ event }) => {
    if (!event.conversationId) return
    await getOrCreateEvidenceWorkflow(client, {
      name: 'processPostSale',
      tags: { key: `studyx-post-sale:${event.payload.notification_id}` }, discriminateByTags: ['key'],
      conversationId: event.conversationId,
      timeoutAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      input: { notification_id: event.payload.notification_id, conversation_id: event.conversationId },
    })
  },
})
