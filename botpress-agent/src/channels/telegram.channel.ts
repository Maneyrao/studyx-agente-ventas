import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterResult } from './shared/normalize'
import { resolveIntegrationId } from './shared/normalize'
import { buildTelegramSandboxEnvelope } from './shared/telegram-envelope'

/**
 * The ADK runtime names the handler channel `${integrationAlias}.${channelName}`
 * (see @botpress/runtime internal handler dispatch). The telegram integration's
 * only channel is literally named "channel", so production events arrive as
 * `telegram.channel`. Verified against the live prod conversation
 * (integration=telegram, channel=channel) on 2026-08-12.
 */
const TELEGRAM_CHANNEL_NAMES = new Set(['telegram.channel'])

type IncomingTelegramMessage = {
  id: string
  createdAt: string
  type: 'text' | 'audio' | 'voice' | 'image' | 'unsupported'
  direction: 'incoming'
  userId: string
  conversationId: string
  payload: {
    text?: string
    voice?: TelegramVoicePayload
    audio?: TelegramVoicePayload
    photo?: TelegramPhotoPayload
    reply_to_message?: { message_id: number | string }
  }
  /**
   * Real production message tags (integration-namespaced), e.g.
   * `{ "telegram:id": "60", "telegram:chatId": "8464326323" }` where
   * `telegram:id` is the Telegram message_id and `telegram:chatId` the chat id.
   */
  tags?: Record<string, string>
}

type TelegramVoicePayload = {
  file_id: string
  mime_type?: string
  duration?: number
}

type TelegramPhotoPayload = {
  file_id: string
  mime_type?: string
}

function isIncomingTelegramMessage(value: unknown): value is IncomingTelegramMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    typeof m.createdAt === 'string' &&
    m.direction === 'incoming' &&
    typeof m.userId === 'string' &&
    typeof m.conversationId === 'string' &&
    !!m.payload &&
    typeof m.payload === 'object'
  )
}

function mapMessageType(
  raw: IncomingTelegramMessage['type'],
): 'text' | 'audio' | 'image' | 'unsupported' {
  if (raw === 'text') return 'text'
  if (raw === 'voice' || raw === 'audio') return 'audio'
  if (raw === 'image') return 'image'
  return 'unsupported'
}

function extractText(m: IncomingTelegramMessage, mappedType: string): string {
  if (mappedType === 'text' && typeof m.payload.text === 'string') return m.payload.text
  if (mappedType === 'audio') return '[audio_pendiente_transcripcion]'
  if (mappedType === 'image') return '[imagen_no_soportada]'
  return '[tipo_no_soportado]'
}

function extractAudioReference(
  m: IncomingTelegramMessage,
  mappedType: string,
): {
  provider_file_id: string
  mime_type: string
  duration_seconds: number | null
  transcription_status: 'ok' | 'failed' | 'skipped'
  transcription_provider: string | null
} | null {
  if (mappedType !== 'audio') return null
  const src = m.payload.voice ?? m.payload.audio
  if (!src || typeof src.file_id !== 'string') return null
  return {
    provider_file_id: src.file_id,
    mime_type: src.mime_type ?? 'audio/ogg',
    duration_seconds: typeof src.duration === 'number' ? Math.trunc(src.duration) : null,
    transcription_status: 'skipped',
    transcription_provider: null,
  }
}

type ConversationTags = ChannelAdapterContext['conversation']['tags']

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => typeof v === 'string' && v !== '')
}

/**
 * Telegram numeric user id. Production sources, in priority order:
 *  1. conversation tag `telegram:fromUserId` (the human counterpart)
 *  2. conversation/message tag `telegram:chatId` (equals the user id in 1:1 chats)
 *  3. the Botpress `userId` — never numeric, so `mintSyntheticPhone` throws and
 *     the adapter fails closed with PHONE_E164_UNRESOLVED instead of inventing identity.
 */
function extractTelegramUserId(m: IncomingTelegramMessage, convTags: ConversationTags): string {
  return (
    firstNonEmpty(
      convTags?.['telegram:fromUserId'],
      convTags?.['telegram:chatId'],
      m.tags?.['telegram:chatId'],
    ) ?? m.userId
  )
}

function extractTelegramChatId(m: IncomingTelegramMessage, convTags: ConversationTags): string {
  return (
    firstNonEmpty(m.tags?.['telegram:chatId'], convTags?.['telegram:chatId']) ?? m.conversationId
  )
}

function extractReplyToExternal(m: IncomingTelegramMessage): string | null {
  const fromPayload = m.payload.reply_to_message?.message_id
  if (typeof fromPayload === 'number' || typeof fromPayload === 'string') return String(fromPayload)
  return null
}

export const telegramChannel: ChannelAdapter = {
  name: 'telegram',

  matches(ctx: ChannelAdapterContext): boolean {
    return ctx.type === 'message' && TELEGRAM_CHANNEL_NAMES.has(ctx.channel)
  },

  toEnvelope(ctx: ChannelAdapterContext): ChannelAdapterResult {
    if (!isIncomingTelegramMessage(ctx.message)) {
      return { kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' }
    }
    const message = ctx.message
    const mappedType = mapMessageType(message.type)
    const convTags = ctx.conversation.tags
    const telegramUserId = extractTelegramUserId(message, convTags)

    try {
      return {
        kind: 'envelope',
        input: buildTelegramSandboxEnvelope({
          telegramUserId,
          telegramChatId: extractTelegramChatId(message, convTags),
          integrationId: resolveIntegrationId(ctx.conversation, ctx.channel),
          externalMessageId: message.id,
          traceId: ctx.traceId,
          messageType: mappedType,
          text: extractText(message, mappedType),
          occurredAt: message.createdAt,
          replyToExternalMessageId: extractReplyToExternal(message),
          audioReference: extractAudioReference(message, mappedType),
          metadata: {
            original_type: message.type,
            ...(mappedType === 'audio' ? { voice_note: message.type === 'voice' } : {}),
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
