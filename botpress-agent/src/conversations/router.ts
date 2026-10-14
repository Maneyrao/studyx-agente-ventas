import { Conversation, configuration, secrets } from '@botpress/runtime'
import { dispatch, logEvent } from '../channels'
import { evaluateWhatsAppCanarySend } from '../channels/whatsapp.channel'
import { processInboundTurn } from '../workflows/processInboundTurn'
import { ingestCanonicalTurnV1 } from '../lib/inbound/ingest-canonical-turn'
import { WorkflowInputSchema } from '../schemas/contracts'
import { StudyxHttpError } from '../utils/http'

/**
 * SINGLE Botpress Conversation handler for every channel.
 *
 * Two handlers with `channel: '*'` would each receive every message and start
 * two workflows for the same event. We rely on this being the only wildcard
 * registration in the project.
 *
 * Channel-specific normalization lives in `src/channels/*.channel.ts`. This
 * handler only:
 *   1. dispatches to the first matching adapter,
 *   2. logs skips,
 *   3. starts (or joins) the idempotent `processInboundTurn` workflow.
 */
export default new Conversation({
  channel: '*',
  async handler({ type, channel, message, conversation, chat }) {
    const traceId = crypto.randomUUID()
    const channelName = String(channel)

    const dispatched = dispatch({
      type,
      channel: channelName,
      message,
      conversation,
      traceId,
    })

    if (dispatched.kind === 'skip') {
      const isWhatsApp = channelName === 'whatsapp.channel'
      logEvent('studyx.router.message_skipped', {
        adapter: dispatched.adapter,
        channel: channelName,
        ...(isWhatsApp ? { trace_id: traceId } : { conversation_id: conversation.id }),
        reason: dispatched.reason,
      })
      return
    }

    const { input, adapter } = dispatched
    if (adapter === 'whatsapp') {
      const canary = evaluateWhatsAppCanarySend({
        automationEnabled: configuration.automationEnabled,
        whatsappPublicEnabled: configuration.whatsappPublicEnabled === true,
        whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
        allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
        phoneE164: input.phone_e164,
      })
      if (!canary.allowed) {
        logEvent('studyx.router.whatsapp_canary_blocked', {
          adapter,
          trace_id: traceId,
          reason: canary.reason,
        })
        return
      }
    }

    const workflowKey = `turn:botpress:${input.integration_id}:${input.external_message_id}`

    try {
      let preingested = null
      if (input.message.type === 'text') {
        try {
          // One fast attempt keeps normal text latency low. On a retryable
          // outage the workflow below becomes the sole retry owner.
          preingested = await ingestCanonicalTurnV1(input, { additionalRetries: 0 })
        } catch (error) {
          if (!(error instanceof StudyxHttpError) || !error.retryable) throw error
          // Persist the original envelope in Botpress even when StudyX cannot
          // acknowledge it. The workflow replays the same ingest idempotency key.
          logEvent('studyx.router.ingest_deferred', {
            adapter, trace_id: traceId, error_code: error.code,
          })
        }
      }
      const workflow = await processInboundTurn.getOrCreate({
        key: workflowKey,
        input: WorkflowInputSchema.parse({ ...input, preingested }),
      })

      logEvent('studyx.router.workflow_started', {
        adapter,
        trace_id: traceId,
        ...(adapter === 'whatsapp' ? {} : { external_message_id: input.external_message_id }),
        workflow_id: workflow.id,
      })
    } catch (error) {
      logEvent('studyx.router.workflow_start_failed', {
        adapter,
        trace_id: traceId,
        ...(adapter === 'whatsapp' ? {} : { external_message_id: input.external_message_id }),
        error_code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      })
      throw error
    }

    // Supabase is the canonical transcript and memory store for StudyX. Start
    // the durable workflow first so transcript housekeeping cannot delay the
    // persistence of a newer customer fragment and let a stale reply escape.
    // Botpress' managed transcript still stays empty so its quota-gated
    // summarizer cannot interfere with subsequent turns.
    if (chat) {
      try {
        await chat.clearTranscript()
        await chat.saveTranscript()
      } catch (error) {
        logEvent('studyx.router.transcript_reset_failed', {
          adapter,
          trace_id: traceId,
          error_code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        })
      }
    }
  },
})
