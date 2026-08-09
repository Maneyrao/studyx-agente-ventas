/**
 * Pure helpers for Telegram Bot A (sandbox). No dependency on `@botpress/runtime`.
 *
 * Identity strategy: mint a synthetic E.164 phone from the Telegram numeric user id.
 * Prefix `+999` is a country code reserved by the ITU (not routable) so the number
 * cannot dial or receive a real call/SMS.
 */

import { E164_PATTERN } from './emulator-envelope'

const SYNTHETIC_PHONE_PREFIX = '+999'
const SYNTHETIC_PHONE_USER_ID_PADDING = 10

export type TelegramUserId = number | string

export type TelegramSandboxEnvelopeInput = {
  telegramUserId: TelegramUserId
  telegramChatId: TelegramUserId
  integrationId: string
  externalMessageId: string
  traceId: string
  messageType: 'text' | 'audio' | 'image' | 'unsupported'
  text: string
  occurredAt: string
  replyToExternalMessageId: string | null
  audioReference: TelegramAudioReference | null
  metadata: Record<string, string | number | boolean>
  botpressConversationId: string
  botpressUserId: string
}

export type TelegramAudioReference = {
  provider_file_id: string
  mime_type: string
  duration_seconds: number | null
  transcription_status: 'ok' | 'failed' | 'skipped'
  transcription_provider: string | null
}

export type TelegramSandboxEnvelope = {
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
    audio_reference: TelegramAudioReference | null
    metadata: Record<string, string | number | boolean>
  }
  sandbox_provider: 'telegram_sandbox'
  botpress_conversation_id: string
  botpress_user_id: string
}

/**
 * Convert a Telegram numeric user id into a synthetic E.164 phone.
 *
 * `+999` + user id zero-padded to 10 digits = 13 digits after the '+',
 * within E.164's 8-15 digit range.
 *
 * Refuses:
 *  - non-integer or negative ids
 *  - ids that exceed the padding width (would overflow E.164)
 *  - ids that produce a leading-zero digit after the country code (E.164 forbids it)
 */
export function mintSyntheticPhone(userId: TelegramUserId): string {
  const asNumber = typeof userId === 'string' ? Number(userId) : userId

  if (
    typeof asNumber !== 'number' ||
    !Number.isFinite(asNumber) ||
    !Number.isInteger(asNumber) ||
    asNumber <= 0
  ) {
    throw new TypeError('telegram user id must be a positive integer')
  }

  const raw = String(asNumber)
  if (raw.length > SYNTHETIC_PHONE_USER_ID_PADDING) {
    throw new TypeError(
      `telegram user id exceeds synthetic phone width (${SYNTHETIC_PHONE_USER_ID_PADDING} digits)`,
    )
  }

  const padded = raw.padStart(SYNTHETIC_PHONE_USER_ID_PADDING, '0')
  const phone = `${SYNTHETIC_PHONE_PREFIX}${padded}`

  if (!E164_PATTERN.test(phone)) {
    throw new TypeError(`minted phone ${phone} failed E.164 validation`)
  }

  return phone
}

export function buildTelegramSandboxEnvelope(
  input: TelegramSandboxEnvelopeInput,
): TelegramSandboxEnvelope {
  const syntheticPhone = mintSyntheticPhone(input.telegramUserId)
  const chatIdString = String(input.telegramChatId)
  const userIdString = String(input.telegramUserId)

  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: input.integrationId,
    external_message_id: input.externalMessageId,
    external_conversation_id: `tg:chat:${chatIdString}`,
    external_user_id: `tg:user:${userIdString}`,
    phone_e164: syntheticPhone,
    trace_id: input.traceId,
    message: {
      type: input.messageType,
      text: input.text,
      occurred_at: input.occurredAt,
      reply_to_external_message_id: input.replyToExternalMessageId,
      audio_reference: input.audioReference,
      metadata: input.metadata,
    },
    sandbox_provider: 'telegram_sandbox',
    botpress_conversation_id: input.botpressConversationId,
    botpress_user_id: input.botpressUserId,
  }
}
