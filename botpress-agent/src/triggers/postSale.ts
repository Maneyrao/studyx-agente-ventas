import { Trigger } from '@botpress/runtime'
import { processPostSale } from '../workflows/processPostSale'
import { evidenceAwareWorkflow } from '../lib/observability/evidence-workflow'

export default new Trigger({
  name: 'onStudyxPostSale',
  events: ['studyxPostSale'],
  handler: async ({ event }) => {
    if (!event.conversationId) return
    await evidenceAwareWorkflow(statuses => processPostSale.getOrCreate({
      key: `studyx-post-sale:${event.payload.notification_id}`,
      statuses,
      input: { notification_id: event.payload.notification_id, conversation_id: event.conversationId },
    }))
  },
})
