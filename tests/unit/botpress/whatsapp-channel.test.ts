import { describe, expect, it } from 'vitest';
import {
  attestWhatsAppCanaryAllowlist,
  evaluateWhatsAppCanarySend,
  whatsappChannel,
} from '../../../botpress-agent/src/channels/whatsapp.channel';
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

  it('preserves Click-to-WhatsApp attribution supplied by Meta', () => {
    const result = whatsappChannel.toEnvelope(ctx({
      message: {
        ...incomingText,
        payload: {
          text: 'Quiero información',
          referral: {
            source_url: 'https://fb.me/ad/example?utm_campaign=ingles-meta&utm_content=video-1',
            source_id: '120210000000001',
            source_type: 'ad',
            headline: 'Aprende Community Manager',
            body: 'Consulta por el curso',
            ctwa_clid: 'ARbitrary-click-id',
          },
        },
      },
    }));

    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message.metadata).toMatchObject({
      meta_source_url: 'https://fb.me/ad/example?utm_campaign=ingles-meta&utm_content=video-1',
      meta_source_id: '120210000000001',
      meta_source_type: 'ad',
      meta_utm_campaign: 'ingles-meta',
      meta_utm_content: 'video-1',
      meta_headline: 'Aprende Community Manager',
      meta_body: 'Consulta por el curso',
      meta_ctwa_clid: 'ARbitrary-click-id',
    });
  });

  it('maps audio to one pending transcription with a workflow-only Botpress Files URL', () => {
    const result = whatsappChannel.toEnvelope(
      ctx({
        message: {
          ...incomingText,
          type: 'audio',
          payload: {
            audioUrl: 'https://files.bpcontent.cloud/2026/10/02/voice.ogg',
          },
        },
      }),
    );

    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message.type).toBe('audio');
    expect(result.input.message.text).toBe('[audio_pendiente_transcripcion]');
    expect(result.input.message.audio_reference).toMatchObject({
      provider_file_id: 'wamid.external-1',
      mime_type: 'audio/ogg',
      transcription_status: 'skipped',
    });
    expect(result.input.transport_media_url).toBe(
      'https://files.bpcontent.cloud/2026/10/02/voice.ogg',
    );
    expect(JSON.stringify(result.input.message.audio_reference)).not.toContain('https://');
  });

  it('does not mistake an audio without audioUrl for a supported transcription', () => {
    const result = whatsappChannel.toEnvelope(ctx({
      message: { ...incomingText, type: 'audio', payload: {} },
    }));
    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message.type).toBe('unsupported');
    expect(result.input.message.audio_reference).toBeNull();
  });

  it('maps an image to pending understanding while keeping its signed URL ephemeral', () => {
    const result = whatsappChannel.toEnvelope(
      ctx({
        message: {
          ...incomingText,
          type: 'image',
          payload: {
            imageUrl: 'https://files.bpcontent.cloud/2026/10/07/course-payment.jpg',
            caption: '¿Esto sirve?',
          },
        },
      }),
    );

    expect(result.kind).toBe('envelope');
    if (result.kind !== 'envelope') return;
    expect(result.input.message).toMatchObject({
      type: 'image',
      text: '[imagen_pendiente_descripcion]',
      audio_reference: null,
    });
    expect(result.input.transport_media_url).toBe(
      'https://files.bpcontent.cloud/2026/10/07/course-payment.jpg',
    );
    expect(JSON.stringify(result.input.message)).not.toContain('files.bpcontent.cloud');
  });

  it.each(['video', 'file', 'sticker'])(
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

describe('evaluateWhatsAppCanarySend', () => {
  const tester = '+5491112345678';
  const other = '+5491198765432';
  const productionBotPhoneNumberId = '1300545066485709';

  it('suppresses every official WhatsApp send while global automation is disabled', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: false,
      whatsappCanaryEnabled: true,
      allowlist: tester,
      phoneE164: tester,
    })).toEqual({ allowed: false, reason: 'AUTOMATION_DISABLED' });
  });

  it('allows only an exact E.164 match for the single configured tester', () => {
    const base = {
      automationEnabled: true,
      whatsappCanaryEnabled: true,
      allowlist: tester,
    };

    expect(evaluateWhatsAppCanarySend({ ...base, phoneE164: tester })).toEqual({
      allowed: true,
      reason: null,
    });
    expect(evaluateWhatsAppCanarySend({ ...base, phoneE164: other })).toEqual({
      allowed: false,
      reason: 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED',
    });
    expect(evaluateWhatsAppCanarySend({ ...base, phoneE164: tester.slice(1) })).toEqual({
      allowed: false,
      reason: 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED',
    });
  });

  it.each([undefined, '', 'not-a-phone', '+999123456789', `${tester},${other}`])(
    'fails closed for malformed, empty, synthetic, or multi-tester allowlist %s',
    (allowlist) => {
      expect(evaluateWhatsAppCanarySend({
        automationEnabled: true,
        whatsappCanaryEnabled: true,
        allowlist,
        phoneE164: tester,
      })).toEqual({ allowed: false, reason: 'WHATSAPP_CANARY_ALLOWLIST_INVALID' });
    },
  );

  it('fails closed when the canary switch is disabled', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: false,
      whatsappCanaryEnabled: false,
      allowlist: tester,
      phoneE164: tester,
    })).toEqual({ allowed: false, reason: 'WHATSAPP_CANARY_DISABLED' });
  });

  it('fails closed in public mode when the allowed business number is not configured', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: true,
      whatsappCanaryEnabled: false,
      allowlist: undefined,
      phoneE164: other,
      botPhoneNumberId: productionBotPhoneNumberId,
    })).toEqual({ allowed: false, reason: 'WHATSAPP_BOT_PHONE_ALLOWLIST_INVALID' });
  });

  it('blocks traffic routed through a different WhatsApp business number', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: true,
      whatsappCanaryEnabled: false,
      allowlist: undefined,
      phoneE164: other,
      allowedBotPhoneNumberId: productionBotPhoneNumberId,
      botPhoneNumberId: '263931016792682',
    })).toEqual({ allowed: false, reason: 'WHATSAPP_BOT_PHONE_NOT_ALLOWED' });

    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: true,
      whatsappCanaryEnabled: false,
      allowlist: undefined,
      phoneE164: other,
      allowedBotPhoneNumberId: productionBotPhoneNumberId,
      botPhoneNumberId: productionBotPhoneNumberId,
    })).toEqual({ allowed: true, reason: null });
  });

  it('blocks public traffic when the incoming business number id is absent', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: true,
      whatsappCanaryEnabled: false,
      allowlist: undefined,
      phoneE164: other,
      allowedBotPhoneNumberId: productionBotPhoneNumberId,
      botPhoneNumberId: undefined,
    })).toEqual({ allowed: false, reason: 'WHATSAPP_BOT_PHONE_NOT_ALLOWED' });
  });

  it('fails closed when public and canary rollout modes are enabled together', () => {
    expect(evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappPublicEnabled: true,
      whatsappCanaryEnabled: true,
      allowlist: tester,
      phoneE164: tester,
    })).toEqual({ allowed: false, reason: 'WHATSAPP_ROLLOUT_MODE_INVALID' });
  });

  it('never returns or logs the tested phone or allowlist value', () => {
    const logged: string[] = [];
    const result = evaluateWhatsAppCanarySend({
      automationEnabled: true,
      whatsappCanaryEnabled: true,
      allowlist: tester,
      phoneE164: other,
      log: (event) => logged.push(JSON.stringify(event)),
    });
    const serialized = JSON.stringify({ result, logged });

    expect(serialized).not.toContain(tester);
    expect(serialized).not.toContain(other);
  });
});

describe('attestWhatsAppCanaryAllowlist', () => {
  it('attests exactly one strict non-synthetic E.164 tester without returning it', () => {
    const tester = '+5491112345678';
    const result = attestWhatsAppCanaryAllowlist(tester);

    expect(result).toEqual({ valid: true, count: 1 });
    expect(JSON.stringify(result)).not.toContain(tester);
  });

  it.each([
    [undefined, { valid: false, count: 0 }],
    ['', { valid: false, count: 0 }],
    ['not-a-phone', { valid: false, count: 1 }],
    ['+999123456789', { valid: false, count: 1 }],
    ['+5491112345678,+5491198765432', { valid: false, count: 2 }],
  ])('fails closed and returns only validity/count for %s', (allowlist, expected) => {
    expect(attestWhatsAppCanaryAllowlist(allowlist)).toEqual(expected);
  });
});
