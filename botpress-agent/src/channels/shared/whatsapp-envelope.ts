import { E164_PATTERN } from './emulator-envelope'

export type WhatsAppEnvelopeInput = {
  integrationId: string
  externalMessageId: string
  externalConversationId: string
  externalUserId: string
  phoneE164: string
  traceId: string
  messageType: 'text' | 'audio' | 'image' | 'unsupported'
  text: string
  occurredAt: string
  replyToExternalMessageId: string | null
  metadata: Record<string, string | number | boolean>
  botpressConversationId: string
  botpressUserId: string
}

export type InboundEnvelope = {
  schema_version: 1
  source: 'botpress'
  channel: 'whatsapp'
  integration_id: string
  external_message_id: string
  external_conversation_id: string
  external_user_id: string
  phone_e164: string
  trace_id: string
  message: {
    type: 'text' | 'audio' | 'image' | 'unsupported'
    text: string
    occurred_at: string
    reply_to_external_message_id: string | null
    audio_reference: null
    metadata: Record<string, string | number | boolean>
  }
  sandbox_provider: null
  botpress_conversation_id: string
  botpress_user_id: string
}

/** Normalize the documented digits-only form while refusing sandbox identities. */
export function normalizeWhatsAppPhone(raw: string): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new TypeError('WhatsApp phone is required')
  }

  const normalized = /^\d+$/.test(raw) ? `+${raw}` : raw
  if (!E164_PATTERN.test(normalized) || normalized.startsWith('+999')) {
    throw new TypeError('WhatsApp phone must be a real strict E.164 identity')
  }
  return normalized
}

export function buildWhatsAppEnvelope(input: WhatsAppEnvelopeInput): InboundEnvelope {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: input.integrationId,
    external_message_id: input.externalMessageId,
    external_conversation_id: input.externalConversationId,
    external_user_id: input.externalUserId,
    phone_e164: normalizeWhatsAppPhone(input.phoneE164),
    trace_id: input.traceId,
    message: {
      type: input.messageType,
      text: input.text,
      occurred_at: input.occurredAt,
      reply_to_external_message_id: input.replyToExternalMessageId,
      audio_reference: null,
      metadata: input.metadata,
    },
    sandbox_provider: null,
    botpress_conversation_id: input.botpressConversationId,
    botpress_user_id: input.botpressUserId,
  }
}
