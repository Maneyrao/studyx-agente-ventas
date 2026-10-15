import type { Client } from '@botpress/client'
import type { CanonicalWorkflowInput } from '../../channels/shared/normalize'
import { z } from '@botpress/runtime'
import { dispatch } from '../../channels'
import { requestStudyxJson, StudyxHttpError } from '../../utils/http'
import { ingestCanonicalTurnV1 } from './ingest-canonical-turn'

export async function synchronizeConversationInbound(params: {
  input: CanonicalWorkflowInput
  client: Pick<Client, 'getConversation' | 'listMessages'>
}): Promise<void> {
  const { input, client } = params
  // Local emulator turns have no managed channel source. Real WhatsApp and
  // Telegram turns must prove source completeness before claiming a batch.
  if (input.channel === 'emulator') return
  try {
    if (!input.botpress_conversation_id) throw new Error('SOURCE_CONVERSATION_REQUIRED')
    const cutoff = new Date().toISOString()
    const since = new Date(Date.parse(input.message.occurred_at) - 10 * 60_000).toISOString()
    const { conversation } = await client.getConversation({ id: input.botpress_conversation_id })
    if (conversation.id !== input.botpress_conversation_id) throw new Error('SOURCE_CONVERSATION_MISMATCH')
    const messages: Awaited<ReturnType<Client['listMessages']>>['messages'] = []
    const tokens = new Set<string>()
    let nextToken: string | undefined
    for (let page = 0; ; page += 1) {
      const response = await client.listMessages({ conversationId: conversation.id,
        afterDate: since, beforeDate: cutoff, pageSize: 100, ...(nextToken ? { nextToken } : {}) })
      messages.push(...response.messages)
      nextToken = response.meta.nextToken
      if (!nextToken) break
      if (page >= 4 || tokens.has(nextToken)) throw new Error('SOURCE_SNAPSHOT_INCOMPLETE')
      tokens.add(nextToken)
    }
    const incoming = messages.filter(message => message.direction === 'incoming' && message.origin !== 'synthetic')
    if (!incoming.some(message => message.id === input.external_message_id)) throw new Error('SOURCE_ORIGIN_NOT_OBSERVED')
    if (incoming.some(message => message.conversationId !== conversation.id
      || message.userId !== input.botpress_user_id)) throw new Error('SOURCE_IDENTITY_MISMATCH')
    const snapshot = [...new Map(incoming.map(message => [message.id, message])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    if (snapshot.length > 500) throw new Error('SOURCE_SNAPSHOT_INCOMPLETE')
    const receipts = await requestStudyxJson({ path: '/api/agent/inbound/receipts',
      body: { trace_id: input.trace_id, integration_id: input.integration_id,
        external_conversation_id: input.external_conversation_id, channel: input.channel,
        sandbox_provider: input.sandbox_provider ?? null, external_message_ids: snapshot.map(message => message.id) },
      traceId: input.trace_id,
      idempotencyKey: `inbound-receipts:${input.integration_id}:${input.external_conversation_id}`,
      responseSchema: z.object({ trace_id: z.string().uuid(), persisted_message_ids: z.array(z.string()) }),
      additionalRetries: 0,
    })
    const persisted = new Set(receipts.persisted_message_ids)
    const missing = snapshot.filter(message => !persisted.has(message.id))
    if (missing.some(message => Date.now() - Date.parse(message.createdAt) > 10 * 60_000)) {
      throw new StudyxHttpError('SOURCE_EVENT_REQUIRES_REVIEW', false)
    }
    // The audio owner must transcribe and save its own event. A second text
    // workflow must not turn a pending audio into a different canonical payload.
    if (missing.some(message => message.type !== 'text')) throw new Error('SOURCE_MEDIA_RECEIPT_PENDING')
    for (const message of missing) {
      const normalized = dispatch({ type: 'message', channel: `${input.channel}.channel`, message,
        conversation: { ...conversation, alias: input.integration_id }, traceId: input.trace_id })
      if (normalized.kind !== 'envelope' || normalized.input.phone_e164 !== input.phone_e164
        || normalized.input.external_conversation_id !== input.external_conversation_id) {
        throw new Error('SOURCE_NORMALIZATION_UNPROVEN')
      }
      await ingestCanonicalTurnV1(normalized.input, { additionalRetries: 0 })
    }
  } catch (error) {
    if (error instanceof StudyxHttpError) throw error
    // Native source-client errors do not share the canonical HTTP error type.
    // Keep the claim pending; no raw payload or customer content is logged.
    throw new StudyxHttpError('SOURCE_SYNC_PENDING', true)
  }
}
