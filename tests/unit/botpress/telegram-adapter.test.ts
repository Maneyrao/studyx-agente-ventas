import { describe, expect, it } from 'vitest';
import { telegramChannel } from '../../../botpress-agent/src/channels/telegram.channel';
import type { ChannelAdapterContext } from '../../../botpress-agent/src/channels/shared/normalize';

/**
 * Fixtures reproduce the EXACT production shape observed on bot
 * 28eefcf3-4623-4d5f-b08e-7d4c20a84d28 on 2026-08-12 (conversation
 * conv_01KZTYMERFCW15NPR3WP8SJT2B, message 389430fc-…):
 *  - handler channel string is `telegram.channel` (`${alias}.${channelName}`)
 *  - message tags are integration-namespaced: `telegram:id`, `telegram:chatId`
 *  - conversation tags carry `telegram:fromUserId` / `telegram:chatId`
 *  - the Botpress userId/conversationId are ULIDs, never numeric ids
 */
const PROD_TELEGRAM_USER_ID = '8464326323';

const prodConversation = {
  id: 'conv_01KZTYMERFCW15NPR3WP8SJT2B',
  alias: 'telegram',
  integration: 'telegram',
  tags: {
    'telegram:id': PROD_TELEGRAM_USER_ID,
    'telegram:fromUserId': PROD_TELEGRAM_USER_ID,
    'telegram:fromUserName': '. .',
    'telegram:chatId': PROD_TELEGRAM_USER_ID,
  },
};

const prodIncomingMessage = {
  id: '389430fc-1b87-4389-b657-e7903ec9bf44',
  createdAt: '2026-08-12T12:35:15.624Z',
  type: 'text' as const,
  direction: 'incoming' as const,
  userId: 'user_01KZTYMESMHSM7ECVYSZAEGZ5X',
  conversationId: 'conv_01KZTYMERFCW15NPR3WP8SJT2B',
  payload: { text: 'Hola' },
  tags: { 'telegram:id': '60', 'telegram:chatId': PROD_TELEGRAM_USER_ID },
};

const prodOutgoingMessage = {
  id: 'dcfbdf79-8bc6-42c4-bef5-c2cd702b94c7',
  createdAt: '2026-08-12T12:35:18.754Z',
  type: 'text' as const,
  direction: 'outgoing' as const,
  userId: 'user_01KZTQ23N5RP3QJD9P6GW2DS0V',
  conversationId: 'conv_01KZTYMERFCW15NPR3WP8SJT2B',
  payload: { text: '¡Hola! Bienvenido a Studyx…' },
  tags: { 'telegram:id': '61' },
};

function ctx(overrides: Partial<ChannelAdapterContext> = {}): ChannelAdapterContext {
  return {
    type: 'message',
    channel: 'telegram.channel',
    message: prodIncomingMessage,
    conversation: prodConversation,
    traceId: '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

describe('telegramChannel.matches', () => {
  it('matches the real production channel string `telegram.channel`', () => {
    expect(telegramChannel.matches(ctx())).toBe(true);
  });

  it.each(['webchat.channel', 'chat.channel', 'whatsapp.channel', 'telegram:message', 'telegram'])(
    'does not match channel %s',
    (channel) => {
      expect(telegramChannel.matches(ctx({ channel }))).toBe(false);
    },
  );

  it('does not match non-message events on the telegram channel', () => {
    expect(telegramChannel.matches(ctx({ type: 'event' }))).toBe(false);
  });
});

describe('telegramChannel.toEnvelope (production payload)', () => {
  it('builds the canonical envelope from the exact production inbound shape', () => {
    const result = telegramChannel.toEnvelope(ctx());
    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;

    expect(result.input.phone_e164).toBe('+9998464326323');
    expect(result.input.external_user_id).toBe(`tg:user:${PROD_TELEGRAM_USER_ID}`);
    expect(result.input.external_conversation_id).toBe(`tg:chat:${PROD_TELEGRAM_USER_ID}`);
    expect(result.input.external_message_id).toBe(prodIncomingMessage.id);
    expect(result.input.integration_id).toBe('telegram');
    expect(result.input.channel).toBe('whatsapp');
    expect(result.input.sandbox_provider).toBe('telegram_sandbox');
    expect(result.input.message.type).toBe('text');
    expect(result.input.message.text).toBe('Hola');
    expect(result.input.message.occurred_at).toBe(prodIncomingMessage.createdAt);
    expect(result.input.botpress_conversation_id).toBe(prodConversation.id);
    expect(result.input.botpress_user_id).toBe(prodIncomingMessage.userId);
  });

  it('falls back to the message `telegram:chatId` tag when conversation tags are absent', () => {
    const result = telegramChannel.toEnvelope(
      ctx({ conversation: { id: prodConversation.id, alias: 'telegram' } }),
    );
    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.phone_e164).toBe('+9998464326323');
  });

  it('fails closed (PHONE_E164_UNRESOLVED) when no numeric Telegram id exists anywhere', () => {
    const result = telegramChannel.toEnvelope(
      ctx({
        conversation: { id: prodConversation.id, alias: 'telegram' },
        message: { ...prodIncomingMessage, tags: {} },
      }),
    );
    expect(result).toEqual({ kind: 'skip', reason: 'PHONE_E164_UNRESOLVED' });
  });

  it('skips outbound messages so bot replies never re-enter as inbound', () => {
    const result = telegramChannel.toEnvelope(ctx({ message: prodOutgoingMessage }));
    expect(result).toEqual({ kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' });
  });

  it('is deterministic: the same production message always yields the same external ids', () => {
    const a = telegramChannel.toEnvelope(ctx());
    const b = telegramChannel.toEnvelope(ctx({ traceId: '00000000-0000-4000-8000-000000000002' }));
    if (a.kind !== 'envelope' || b.kind !== 'envelope') {
      throw new Error('expected envelopes');
    }
    expect(a.input.external_message_id).toBe(b.input.external_message_id);
    expect(a.input.integration_id).toBe(b.input.integration_id);
    expect(a.input.phone_e164).toBe(b.input.phone_e164);
  });

  it('maps a voice note to an audio envelope with a transcription-pending placeholder', () => {
    const voiceMessage = {
      ...prodIncomingMessage,
      id: 'a1b2c3d4-0000-4000-8000-000000000abc',
      type: 'voice' as const,
      payload: { voice: { file_id: 'AwACAgEAAxkBAAM', mime_type: 'audio/ogg', duration: 3 } },
    };
    const result = telegramChannel.toEnvelope(ctx({ message: voiceMessage }));
    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message.type).toBe('audio');
    expect(result.input.message.text).toBe('[audio_pendiente_transcripcion]');
    expect(result.input.message.audio_reference).toMatchObject({
      provider_file_id: 'AwACAgEAAxkBAAM',
      mime_type: 'audio/ogg',
      duration_seconds: 3,
      transcription_status: 'skipped',
    });
  });
});
