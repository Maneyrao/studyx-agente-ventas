import { describe, expect, it } from 'vitest';
import {
  buildTelegramSandboxEnvelope,
  mintSyntheticPhone,
} from '../../../botpress-agent/src/channels/shared/telegram-envelope';

const E164 = /^\+[1-9]\d{7,14}$/;

describe('mintSyntheticPhone', () => {
  it('produces a +999-prefixed E.164-valid phone for a positive integer user id', () => {
    const phone = mintSyntheticPhone(12345678);
    expect(phone).toBe('+9990012345678');
    expect(phone).toMatch(E164);
  });

  it('accepts numeric strings and returns identical output to the numeric form', () => {
    expect(mintSyntheticPhone('12345678')).toBe(mintSyntheticPhone(12345678));
  });

  it('pads short user ids to 10 digits', () => {
    expect(mintSyntheticPhone(1)).toBe('+9990000000001');
    expect(mintSyntheticPhone(42)).toBe('+9990000000042');
  });

  it.each([0, -1, -12345, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid numeric user id: %s',
    (value) => {
      expect(() => mintSyntheticPhone(value)).toThrow(/positive integer/);
    },
  );

  it.each(['not-a-number', '1.5', ''])('rejects invalid string user id: %s', (value) => {
    expect(() => mintSyntheticPhone(value)).toThrow(/positive integer/);
  });

  it('rejects a user id wider than 10 digits (would overflow E.164)', () => {
    expect(() => mintSyntheticPhone(12345678901)).toThrow(/exceeds synthetic phone width/);
  });
});

const baseInput = {
  telegramUserId: 12345678,
  telegramChatId: 12345678,
  integrationId: 'telegram:bot-a',
  externalMessageId: 'tg:msg:12345678:99',
  traceId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-08-07T15:31:12.000-03:00',
  botpressConversationId: 'botpress-conv-1',
  botpressUserId: 'botpress-user-1',
};

describe('buildTelegramSandboxEnvelope', () => {
  it('emits channel=whatsapp and sandbox_provider=telegram_sandbox', () => {
    const envelope = buildTelegramSandboxEnvelope({
      ...baseInput,
      messageType: 'text',
      text: 'hola',
      replyToExternalMessageId: null,
      audioReference: null,
      metadata: {},
    });

    expect(envelope.channel).toBe('whatsapp');
    expect(envelope.sandbox_provider).toBe('telegram_sandbox');
    expect(envelope.source).toBe('botpress');
    expect(envelope.phone_e164).toBe('+9990012345678');
    expect(envelope.phone_e164).toMatch(E164);
  });

  it('encodes chat and user IDs with tg: prefix for auditability', () => {
    const envelope = buildTelegramSandboxEnvelope({
      ...baseInput,
      telegramUserId: 42,
      telegramChatId: 99,
      messageType: 'text',
      text: 'hola',
      replyToExternalMessageId: null,
      audioReference: null,
      metadata: {},
    });

    expect(envelope.external_conversation_id).toBe('tg:chat:99');
    expect(envelope.external_user_id).toBe('tg:user:42');
  });

  it('carries audio_reference through for voice messages', () => {
    const envelope = buildTelegramSandboxEnvelope({
      ...baseInput,
      messageType: 'audio',
      text: '[audio_pendiente_transcripcion]',
      replyToExternalMessageId: null,
      audioReference: {
        provider_file_id: 'AwACAgIAAxkBAAIC1WYQvT_abc123',
        mime_type: 'audio/ogg',
        duration_seconds: 8,
        transcription_status: 'skipped',
        transcription_provider: null,
      },
      metadata: { voice_note: true, original_type: 'voice' },
    });

    expect(envelope.message.type).toBe('audio');
    expect(envelope.message.audio_reference?.provider_file_id).toBe(
      'AwACAgIAAxkBAAIC1WYQvT_abc123',
    );
    expect(envelope.message.metadata).toMatchObject({ voice_note: true });
  });

  it('never places a URL in the audio_reference', () => {
    const envelope = buildTelegramSandboxEnvelope({
      ...baseInput,
      messageType: 'audio',
      text: '[audio]',
      replyToExternalMessageId: null,
      audioReference: {
        provider_file_id: 'file-id-xyz',
        mime_type: 'audio/ogg',
        duration_seconds: null,
        transcription_status: 'skipped',
        transcription_provider: null,
      },
      metadata: {},
    });

    const audioRef = envelope.message.audio_reference as Record<string, unknown> | null;
    expect(audioRef).not.toBeNull();
    for (const key of Object.keys(audioRef!)) {
      expect(key).not.toMatch(/url/i);
    }
  });

  it('preserves reply_to_external_message_id when provided', () => {
    const envelope = buildTelegramSandboxEnvelope({
      ...baseInput,
      messageType: 'text',
      text: 'ok',
      replyToExternalMessageId: 'tg:msg:12345678:98',
      audioReference: null,
      metadata: {},
    });

    expect(envelope.message.reply_to_external_message_id).toBe('tg:msg:12345678:98');
  });
});
