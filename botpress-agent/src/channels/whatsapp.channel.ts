import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterResult } from './shared/normalize'
import { resolveIntegrationId } from './shared/normalize'
import { E164_PATTERN } from './shared/normalize'
import { buildWhatsAppEnvelope } from './shared/whatsapp-envelope'

const WHATSAPP_CHANNEL = 'whatsapp.channel'
const UNSUPPORTED_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'file'])
const UNSUPPORTED_MEDIA_MARKER = '[whatsapp_media_no_soportado]'
const UNSUPPORTED_TYPE_MARKER = '[whatsapp_tipo_no_soportado]'

export type WhatsAppCanaryBlockReason =
  | 'AUTOMATION_DISABLED'
  | 'WHATSAPP_ROLLOUT_MODE_INVALID'
  | 'WHATSAPP_CANARY_DISABLED'
  | 'WHATSAPP_CANARY_ALLOWLIST_INVALID'
  | 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED'

type WhatsAppCanarySendInput = {
  automationEnabled: boolean
  whatsappPublicEnabled?: boolean
  whatsappCanaryEnabled: boolean
  allowlist: string | undefined
  phoneE164: string | undefined
  log?: (event: Record<string, unknown>) => void
}

export type WhatsAppCanarySendDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: WhatsAppCanaryBlockReason }

export type WhatsAppCanaryAllowlistAttestation = {
  valid: boolean
  count: number
}

/** Value-safe proof used by release readiness; never returns an entry. */
export function attestWhatsAppCanaryAllowlist(
  allowlist: string | undefined,
): WhatsAppCanaryAllowlistAttestation {
  if (typeof allowlist !== 'string' || allowlist === '') return { valid: false, count: 0 }
  const entries = allowlist.split(/[\n,]/).filter((entry) => entry !== '')
  const valid = entries.length === 1 &&
    entries[0] === allowlist &&
    E164_PATTERN.test(entries[0]) &&
    !entries[0].startsWith('+999')
  return { valid, count: entries.length }
}

/**
 * Final, fail-closed WhatsApp egress authorization. The canary is deliberately
 * limited to one strict E.164 tester and returns/logs reason codes only.
 */
export function evaluateWhatsAppCanarySend(
  input: WhatsAppCanarySendInput,
): WhatsAppCanarySendDecision {
  let decision: WhatsAppCanarySendDecision
  if (!input.automationEnabled) {
    decision = { allowed: false, reason: 'AUTOMATION_DISABLED' }
  } else if (input.whatsappPublicEnabled && input.whatsappCanaryEnabled) {
    decision = { allowed: false, reason: 'WHATSAPP_ROLLOUT_MODE_INVALID' }
  } else if (input.whatsappPublicEnabled) {
    decision = { allowed: true, reason: null }
  } else if (!input.whatsappCanaryEnabled) {
    decision = { allowed: false, reason: 'WHATSAPP_CANARY_DISABLED' }
  } else if (!attestWhatsAppCanaryAllowlist(input.allowlist).valid) {
    decision = { allowed: false, reason: 'WHATSAPP_CANARY_ALLOWLIST_INVALID' }
  } else if (input.phoneE164 !== input.allowlist) {
    decision = { allowed: false, reason: 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED' }
  } else {
    decision = { allowed: true, reason: null }
  }

  input.log?.({
    event: 'studyx.whatsapp_canary_gate',
    allowed: decision.allowed,
    reason: decision.reason,
  })
  return decision
}

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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstString(source: Record<string, unknown> | null, keys: readonly string[]): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 512)
  }
  return undefined
}

function sourceUrlAttribution(sourceUrl: string | undefined): Record<string, string> {
  if (!sourceUrl) return {}
  try {
    const url = new URL(sourceUrl)
    const campaign = url.searchParams.get('utm_campaign')?.trim()
    const content = url.searchParams.get('utm_content')?.trim()
    return {
      ...(campaign ? { meta_utm_campaign: campaign.slice(0, 512) } : {}),
      ...(content ? { meta_utm_content: content.slice(0, 512) } : {}),
    }
  } catch {
    return {}
  }
}

/** Preserve Meta Click-to-WhatsApp attribution without storing the raw payload. */
function referralMetadata(message: IncomingWhatsAppMessage): Record<string, string> {
  const context = record(message.payload.context)
  const referral = record(message.payload.referral) ?? record(context?.referral)
  const tags = message.tags ?? {}
  const sourceUrl = firstString(referral, ['source_url', 'sourceUrl'])
  const fields = {
    meta_source_url: sourceUrl,
    meta_source_id: firstString(referral, ['source_id', 'sourceId']),
    meta_source_type: firstString(referral, ['source_type', 'sourceType']),
    meta_headline: firstString(referral, ['headline']),
    meta_body: firstString(referral, ['body']),
    meta_ctwa_clid: firstString(referral, ['ctwa_clid', 'ctwaClid'])
      ?? nonEmpty(tags['whatsapp:ctwaClid']),
    meta_campaign_id: firstString(referral, ['campaign_id', 'campaignId'])
      ?? nonEmpty(tags['whatsapp:campaignId']),
    meta_campaign_name: firstString(referral, ['campaign_name', 'campaignName'])
      ?? nonEmpty(tags['whatsapp:campaignName']),
    meta_adset_id: firstString(referral, ['adset_id', 'adsetId']),
    meta_adset_name: firstString(referral, ['adset_name', 'adsetName']),
    meta_ad_id: firstString(referral, ['ad_id', 'adId']),
    meta_ad_name: firstString(referral, ['ad_name', 'adName']),
    ...sourceUrlAttribution(sourceUrl),
  }
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
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
            ...referralMetadata(message),
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
