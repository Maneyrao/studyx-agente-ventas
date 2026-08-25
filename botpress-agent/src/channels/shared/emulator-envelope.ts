/**
 * Pure helpers for building the canonical WorkflowInput from an emulator message.
 *
 * This file has NO dependency on `@botpress/runtime` on purpose — it must be
 * importable by both the adapter (`emulator.channel.ts`) and by tests that
 * cannot bundle the ADK runtime.
 */

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/

export const DEFAULT_DEVELOPMENT_EMULATOR_PHONE_E164 = '+15550000001'

function fnv1a32(value: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * Every emulator conversation represents an independent synthetic customer.
 * The configured number is retained as a namespace salt, while the +999
 * prefix makes the resulting identity unmistakably non-real.
 */
export function deriveEmulatorPhoneE164(
  configuredPhoneE164: string,
  externalConversationId: string,
): string {
  if (!E164_PATTERN.test(configuredPhoneE164)) {
    throw new TypeError('emulatorPhoneE164 must be a strict E.164 identity')
  }
  const input = `${configuredPhoneE164}:${externalConversationId}`
  const high = String(fnv1a32(input, 0x811c9dc5) % 1_000_000).padStart(6, '0')
  const low = String(fnv1a32(input, 0x9e3779b9) % 1_000_000).padStart(6, '0')
  return `+999${high}${low}`
}

export type EmulatorEnvelopeInput = {
  emulatorPhoneE164: string
  integrationId: string
  externalMessageId: string
  externalConversationId: string
  externalUserId: string
  traceId: string
  text: string
  occurredAt: string
  botpressConversationId: string
  botpressUserId: string
}

export type EmulatorEnvelope = {
  schema_version: 1
  source: 'botpress'
  channel: 'emulator'
  integration_id: string
  external_message_id: string
  external_conversation_id: string
  external_user_id: string
  phone_e164: string
  trace_id: string
  message: {
    type: 'text'
    text: string
    occurred_at: string
    reply_to_external_message_id: null
    audio_reference: null
    metadata: Record<string, never>
  }
  sandbox_provider: null
  botpress_conversation_id: string
  botpress_user_id: string
}

/**
 * Fail-closed E.164 check + envelope shape. Throws on invalid identity;
 * the adapter converts throws into a `skip` decision so the router never
 * crashes on bad config.
 */
export function buildEmulatorEnvelope(input: EmulatorEnvelopeInput): EmulatorEnvelope {
  const syntheticPhone = deriveEmulatorPhoneE164(
    input.emulatorPhoneE164,
    input.externalConversationId,
  )

  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: input.integrationId,
    external_message_id: input.externalMessageId,
    external_conversation_id: input.externalConversationId,
    external_user_id: input.externalUserId,
    phone_e164: syntheticPhone,
    trace_id: input.traceId,
    message: {
      type: 'text',
      text: input.text,
      occurred_at: input.occurredAt,
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
    botpress_conversation_id: input.botpressConversationId,
    botpress_user_id: input.botpressUserId,
  }
}
