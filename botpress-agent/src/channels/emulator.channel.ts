import { configuration } from '@botpress/runtime'
import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterResult } from './shared/normalize'
import { resolveIntegrationId } from './shared/normalize'
import { buildEmulatorEnvelope } from './shared/emulator-envelope'

const EMULATOR_CHANNEL_NAMES = new Set(['chat.channel', 'webchat.channel'])

type IncomingTextMessage = {
  id: string
  createdAt: string
  type: 'text'
  direction: 'incoming'
  userId: string
  conversationId: string
  payload: { text: string }
}

function isIncomingTextMessage(value: unknown): value is IncomingTextMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  const payload = message.payload

  return (
    typeof message.id === 'string' &&
    typeof message.createdAt === 'string' &&
    message.type === 'text' &&
    message.direction === 'incoming' &&
    typeof message.userId === 'string' &&
    typeof message.conversationId === 'string' &&
    !!payload &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).text === 'string' &&
    (payload as Record<string, unknown>).text !== ''
  )
}

export const emulatorChannel: ChannelAdapter = {
  name: 'emulator',

  matches(ctx: ChannelAdapterContext): boolean {
    return ctx.type === 'message' && EMULATOR_CHANNEL_NAMES.has(ctx.channel)
  },

  toEnvelope(ctx: ChannelAdapterContext): ChannelAdapterResult {
    if (!isIncomingTextMessage(ctx.message)) {
      return { kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' }
    }

    const message = ctx.message
    const integrationId = resolveIntegrationId(ctx.conversation, ctx.channel)

    try {
      return {
        kind: 'envelope',
        input: buildEmulatorEnvelope({
          emulatorPhoneE164: configuration.emulatorPhoneE164,
          integrationId,
          externalMessageId: message.id,
          externalConversationId: message.conversationId,
          externalUserId: message.userId,
          traceId: ctx.traceId,
          text: message.payload.text,
          occurredAt: message.createdAt,
          botpressConversationId: ctx.conversation.id,
          botpressUserId: message.userId,
        }),
      }
    } catch {
      return { kind: 'skip', reason: 'PHONE_E164_UNRESOLVED' }
    }
  },
}
