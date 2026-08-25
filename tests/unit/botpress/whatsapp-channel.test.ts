import { describe, expect, it } from 'vitest';
import { whatsappChannel } from '../../../botpress-agent/src/channels/whatsapp.channel';
import type { ChannelAdapterContext } from '../../../botpress-agent/src/channels/shared/normalize';

const conversation = {
  id: 'bp-conversation-1',
  alias: 'whatsapp',
  integration: 'whatsapp',
  tags: {
    'whatsapp:userPhone': '5491112345678',
    'whatsapp:botPhoneNumberId': 'sender-ref-1',
  },
};

const incomingText = {
  id: 'wamid.external-1',
  createdAt: '2026-08-25T10:15:00.000Z',
  type: 'text',
  direction: 'incoming',
  userId: 'bp-user-external-1',
  conversationId: 'bp-conversation-external-1',
  payload: { text: 'Necesito información' },
  tags: { 'whatsapp:replyTo': 'wamid.external-0' },
};

function ctx(overrides: Partial<ChannelAdapterContext> = {}): ChannelAdapterContext {
  return {
    type: 'message',
    channel: 'whatsapp.channel',
    message: incomingText,
    conversation,
    traceId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

describe('whatsappChannel.matches', () => {
  it('matches only message events on the official whatsapp.channel identifier', () => {
    expect(whatsappChannel.matches(ctx())).toBe(true);
    expect(whatsappChannel.matches(ctx({ channel: 'telegram.channel' }))).toBe(false);
    expect(whatsappChannel.matches(ctx({ channel: 'webchat.channel' }))).toBe(false);
    expect(whatsappChannel.matches(ctx({ type: 'event' }))).toBe(false);
  });
});

describe('whatsappChannel.toEnvelope', () => {
  it('uses payload.text and only the approved non-sensitive metadata', () => {
    const result = whatsappChannel.toEnvelope(ctx());

    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message.text).toBe('Necesito información');
    expect(result.input.phone_e164).toBe('+5491112345678');
    expect(result.input.external_message_id).toBe('wamid.external-1');
    expect(result.input.external_conversation_id).toBe('bp-conversation-external-1');
    expect(result.input.external_user_id).toBe('bp-user-external-1');
    expect(result.input.message.reply_to_external_message_id).toBe('wamid.external-0');
    expect(result.input.message.metadata).toEqual({
      original_type: 'text',
      bot_phone_number_id: 'sender-ref-1',
    });
    expect(JSON.stringify(result.input.message.metadata)).not.toContain('5491112345678');
    expect(JSON.stringify(result.input.message.metadata)).not.toContain('Necesito información');
  });

  it.each(['image', 'audio', 'video', 'file'])(
    'maps %s media to one unsupported marker without media references',
    (type) => {
      const result = whatsappChannel.toEnvelope(
        ctx({
          message: {
            ...incomingText,
            type,
            payload: {
              url: 'https://media.example.invalid/private',
              fileId: 'private-file-reference',
            },
          },
        }),
      );

      expect(result.kind).toBe('envelope');
      if (result.kind !== 'envelope') return;
      expect(result.input.message.type).toBe('unsupported');
      expect(result.input.message.text).toBe('[whatsapp_media_no_soportado]');
      expect(result.input.message.audio_reference).toBeNull();
      expect(JSON.stringify(result.input)).not.toContain('media.example.invalid');
      expect(JSON.stringify(result.input)).not.toContain('private-file-reference');
    },
  );

  it('returns PHONE_E164_UNRESOLVED when the documented phone tag is absent', () => {
    const result = whatsappChannel.toEnvelope(
      ctx({
        conversation: {
          id: conversation.id,
          alias: conversation.alias,
          integration: conversation.integration,
          tags: { 'whatsapp:botPhoneNumberId': 'sender-ref-1' },
        },
      }),
    );

    expect(result).toEqual({ kind: 'skip', reason: 'PHONE_E164_UNRESOLVED' });
  });

  it('skips outbound messages so Botpress replies cannot re-enter the workflow', () => {
    const result = whatsappChannel.toEnvelope(
      ctx({ message: { ...incomingText, direction: 'outgoing' } }),
    );
    expect(result).toEqual({ kind: 'skip', reason: 'UNSUPPORTED_MESSAGE' });
  });
});
