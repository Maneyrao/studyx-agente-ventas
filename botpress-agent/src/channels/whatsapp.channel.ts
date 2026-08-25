import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterResult } from './shared/normalize'
import { resolveIntegrationId } from './shared/normalize'
import { buildWhatsAppEnvelope } from './shared/whatsapp-envelope'

const WHATSAPP_CHANNEL = 'whatsapp.channel'
const UNSUPPORTED_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'file'])
const UNSUPPORTED_MEDIA_MARKER = '[whatsapp_media_no_soportado]'
const UNSUPPORTED_TYPE_MARKER = '[whatsapp_tipo_no_soportado]'

type IncomingWhatsAppMessage = {
  id: string
  createdAt: string
  type: string
  direction: 'incoming'
  userId: string
  conversationId: string
  payload: Record<string, unknown>
  tags?: Record<string, string>
}

function isIncomingWhatsAppMessage(value: unknown): value is IncomingWhatsAppMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    typeof message.createdAt === 'string' &&
    typeof message.type === 'string' &&
    message.direction === 'incoming' &&
    typeof message.userId === 'string' &&
    typeof message.conversationId === 'string' &&
    !!message.payload &&
    typeof message.payload === 'object'
  )
}

function mapMessage(message: IncomingWhatsAppMessage): {
  type: 'text' | 'unsupported'
  text: string
} | null {
  if (message.type === 'text') {
    const text = message.payload.text
    if (typeof text !== 'string' || text === '') return null
    return { type: 'text', text }
  }
  if (UNSUPPORTED_MEDIA_TYPES.has(message.type)) {
    return { type: 'unsupported', text: UNSUPPORTED_MEDIA_MARKER }
  }
  return { type: 'unsupported', text: UNSUPPORTED_TYPE_MARKER }
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const whatsappChannel: ChannelAdapter = {
  name: 'whatsapp',

  matches(ctx: ChannelAdapterContext): boolean {
    return ctx.type === 'message' && ctx.channel === WHATSAPP_CHANNEL
  },

  toEnvelope(ctx: ChannelAdapterContext): ChannelAdapterResult {
    if (!isIncomingWhatsAppMessage(ctx.message)) {
      return { kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' }
    }

    const message = ctx.message
    const mapped = mapMessage(message)
    if (!mapped) return { kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' }

    const phone = nonEmpty(ctx.conversation.tags?.['whatsapp:userPhone'])
    if (!phone) return { kind: 'skip', reason: 'PHONE_E164_UNRESOLVED' }

    const botPhoneNumberId = nonEmpty(ctx.conversation.tags?.['whatsapp:botPhoneNumberId'])
    const replyTo = nonEmpty(message.tags?.['whatsapp:replyTo']) ?? null

    try {
      return {
        kind: 'envelope',
        input: buildWhatsAppEnvelope({
          integrationId: resolveIntegrationId(ctx.conversation, ctx.channel),
          externalMessageId: message.id,
          externalConversationId: message.conversationId,
          externalUserId: message.userId,
          phoneE164: phone,
          traceId: ctx.traceId,
          messageType: mapped.type,
          text: mapped.text,
          occurredAt: message.createdAt,
          replyToExternalMessageId: replyTo,
          metadata: {
            original_type: message.type,
            ...(botPhoneNumberId ? { bot_phone_number_id: botPhoneNumberId } : {}),
          },
          botpressConversationId: ctx.conversation.id,
          botpressUserId: message.userId,
        }),
      }
    } catch {
      return { kind: 'skip', reason: 'PHONE_E164_UNRESOLVED' }
    }
  },
}
