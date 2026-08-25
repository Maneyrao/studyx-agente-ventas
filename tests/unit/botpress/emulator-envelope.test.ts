import { describe, expect, it } from 'vitest';
import {
  buildEmulatorEnvelope,
  deriveEmulatorPhoneE164,
  type EmulatorEnvelopeInput,
} from '../../../botpress-agent/src/channels/shared/emulator-envelope';

const validInput: EmulatorEnvelopeInput = {
  emulatorPhoneE164: '+15550000001',
  integrationId: 'emulator:chat.channel',
  externalMessageId: 'message-1',
  externalConversationId: 'conversation-1',
  externalUserId: 'botpress-user-1',
  traceId: '11111111-1111-4111-8111-111111111111',
  text: 'hola',
  occurredAt: '2026-08-06T12:00:00.000Z',
  botpressConversationId: 'botpress-conversation-1',
  botpressUserId: 'botpress-user-1',
};

describe('Emulator ingest envelope', () => {
  it('derives a stable sandbox identity per conversation instead of merging test clients', () => {
    const first = deriveEmulatorPhoneE164('+15550000001', 'conversation-1');
    const replay = deriveEmulatorPhoneE164('+15550000001', 'conversation-1');
    const second = deriveEmulatorPhoneE164('+15550000001', 'conversation-2');

    expect(first).toMatch(/^\+999\d{12}$/);
    expect(replay).toBe(first);
    expect(second).not.toBe(first);
  });

  it('places the conversation-scoped sandbox identity in the ingest envelope', () => {
    const expectedPhone = deriveEmulatorPhoneE164(
      validInput.emulatorPhoneE164,
      validInput.externalConversationId,
    );
    expect(buildEmulatorEnvelope(validInput)).toEqual({
      schema_version: 1,
      source: 'botpress',
      channel: 'emulator',
      integration_id: 'emulator:chat.channel',
      external_message_id: 'message-1',
      external_conversation_id: 'conversation-1',
      external_user_id: 'botpress-user-1',
      phone_e164: expectedPhone,
      trace_id: '11111111-1111-4111-8111-111111111111',
      message: {
        type: 'text',
        text: 'hola',
        occurred_at: '2026-08-06T12:00:00.000Z',
        reply_to_external_message_id: null,
        audio_reference: null,
        metadata: {},
      },
      sandbox_provider: null,
      botpress_conversation_id: 'botpress-conversation-1',
      botpress_user_id: 'botpress-user-1',
    });
  });

  it.each([
    '15550000001',
    '+05550000001',
    '+1 555 000 0001',
    '+15550000001 ',
    '+1234567890123456',
    '+1234567',
  ])('rejects a non-E.164 configured identity: %s', (emulatorPhoneE164) => {
    expect(() => buildEmulatorEnvelope({ ...validInput, emulatorPhoneE164 })).toThrow(
      /emulatorPhoneE164.*E\.164/
    );
  });

  it('does not fall back to the Botpress user ID when configuration is invalid', () => {
    expect(() =>
      buildEmulatorEnvelope({
        ...validInput,
        emulatorPhoneE164: 'botpress-user-1',
        externalUserId: '+15550000002',
      })
    ).toThrow(/emulatorPhoneE164.*E\.164/);
  });
});
