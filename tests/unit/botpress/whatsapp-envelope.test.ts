import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppEnvelope,
  normalizeWhatsAppPhone,
} from '../../../botpress-agent/src/channels/shared/whatsapp-envelope';

describe('normalizeWhatsAppPhone', () => {
  it('normalizes the documented digits-only WhatsApp phone to strict E.164', () => {
    expect(normalizeWhatsAppPhone('5491112345678')).toBe('+5491112345678');
  });

  it('preserves an already-normalized real E.164 phone', () => {
    expect(normalizeWhatsAppPhone('+5491112345678')).toBe('+5491112345678');
  });

  it.each([
    undefined,
    '',
    '549 11 1234 5678',
    'not-a-phone',
    '+9990012345678',
    '9990012345678',
    '+1234567890123456',
  ])('rejects a missing, malformed, synthetic, or overlong phone: %s', (raw) => {
    expect(() => normalizeWhatsAppPhone(raw as unknown as string)).toThrow(/WhatsApp phone/i);
  });
});

describe('buildWhatsAppEnvelope', () => {
  it('preserves official external identity and reply linkage in a production envelope', () => {
    const envelope = buildWhatsAppEnvelope({
      integrationId: 'whatsapp',
      externalMessageId: 'wamid.external-1',
      externalConversationId: 'bp-conversation-external-1',
      externalUserId: 'bp-user-external-1',
      phoneE164: '5491112345678',
      traceId: '11111111-1111-4111-8111-111111111111',
      messageType: 'text',
      text: 'Necesito información',
      occurredAt: '2026-08-25T10:15:00.000Z',
      replyToExternalMessageId: 'wamid.external-0',
      metadata: { original_type: 'text', bot_phone_number_id: 'sender-ref-1' },
      botpressConversationId: 'bp-conversation-1',
      botpressUserId: 'bp-user-1',
    });

    expect(envelope).toEqual({
      schema_version: 1,
      source: 'botpress',
      channel: 'whatsapp',
      integration_id: 'whatsapp',
      external_message_id: 'wamid.external-1',
      external_conversation_id: 'bp-conversation-external-1',
      external_user_id: 'bp-user-external-1',
      phone_e164: '+5491112345678',
      trace_id: '11111111-1111-4111-8111-111111111111',
      message: {
        type: 'text',
        text: 'Necesito información',
        occurred_at: '2026-08-25T10:15:00.000Z',
        reply_to_external_message_id: 'wamid.external-0',
        audio_reference: null,
        metadata: { original_type: 'text', bot_phone_number_id: 'sender-ref-1' },
      },
      sandbox_provider: null,
      botpress_conversation_id: 'bp-conversation-1',
      botpress_user_id: 'bp-user-1',
    });
  });

  it('rejects a synthetic phone before building a production WhatsApp envelope', () => {
    expect(() =>
      buildWhatsAppEnvelope({
        integrationId: 'whatsapp',
        externalMessageId: 'wamid.external-1',
        externalConversationId: 'bp-conversation-external-1',
        externalUserId: 'bp-user-external-1',
        phoneE164: '+9990012345678',
        traceId: '11111111-1111-4111-8111-111111111111',
        messageType: 'text',
        text: 'Hola',
        occurredAt: '2026-08-25T10:15:00.000Z',
        replyToExternalMessageId: null,
        metadata: {},
        botpressConversationId: 'bp-conversation-1',
        botpressUserId: 'bp-user-1',
      }),
    ).toThrow(/WhatsApp phone/i);
  });
});
