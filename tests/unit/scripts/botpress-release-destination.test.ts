import { describe, expect, it } from 'vitest';

import {
  STUDYX_RELEASE_DESTINATION,
  assertBotpressReleaseDestination,
  assertBotpressReleaseRemoteIdentity,
  normalizeBotpressIntegrationField,
} from '../../../scripts/lib/botpress-release-destination.mjs';

describe('Botpress StudyX release destination', () => {
  it('pins publication to the bot that owns the live WhatsApp ingress', () => {
    expect(STUDYX_RELEASE_DESTINATION).toEqual({
      profile: 'default',
      workspaceId: 'wkspace_01M0X4K3H2EE7RGM39Q29GF6VS',
      botId: '15050253-3088-47a4-940d-dc849c03860c',
      botName: 'StudyX Pruebas',
      whatsappIntegrationId: 'intver_01KZV3JDSXJDX3AVKT00J3J5RW',
      whatsappBotPhoneNumberId: '1300545066485709',
    });
    expect(() => assertBotpressReleaseDestination(STUDYX_RELEASE_DESTINATION)).not.toThrow();
  });

  it('fails closed for any other profile, workspace or bot', () => {
    expect(() => assertBotpressReleaseDestination({
      ...STUDYX_RELEASE_DESTINATION,
      profile: 'studyx-detmaneyro',
    })).toThrow('DESTINATION_MISMATCH');
    expect(() => assertBotpressReleaseDestination({
      ...STUDYX_RELEASE_DESTINATION,
      workspaceId: 'wkspace_other',
    })).toThrow('DESTINATION_MISMATCH');
    expect(() => assertBotpressReleaseDestination({
      ...STUDYX_RELEASE_DESTINATION,
      botId: 'bot_other',
    })).toThrow('DESTINATION_MISMATCH');
  });

  it('requires the expected live WhatsApp connection on the pinned bot', () => {
    const remote = {
      name: STUDYX_RELEASE_DESTINATION.botName,
      configuration: { data: {
        whatsappAllowedBotPhoneNumberId: STUDYX_RELEASE_DESTINATION.whatsappBotPhoneNumberId,
      } },
      integrations: { whatsapp: {
        id: STUDYX_RELEASE_DESTINATION.whatsappIntegrationId,
        enabled: true,
        status: 'registered',
      } },
    };
    expect(() => assertBotpressReleaseRemoteIdentity(remote)).not.toThrow();
    expect(() => assertBotpressReleaseRemoteIdentity({ ...remote, name: 'Other bot' }))
      .toThrow('REMOTE_BOT_IDENTITY_MISMATCH');
    expect(() => assertBotpressReleaseRemoteIdentity({
      ...remote,
      integrations: { whatsapp: { ...remote.integrations.whatsapp, enabled: false } },
    })).toThrow('REMOTE_WHATSAPP_CONNECTION_MISMATCH');
  });

  it('normalizes only reviewed provider defaults that do not alter a connection', () => {
    expect(normalizeBotpressIntegrationField('telegram', 'configuration', {})).toEqual({
      typingIndicatorEmoji: false,
    });
    expect(normalizeBotpressIntegrationField('telegram', 'configuration', {
      typingIndicatorEmoji: true,
    })).toEqual({ typingIndicatorEmoji: true });
    expect(normalizeBotpressIntegrationField('whatsapp', 'configuration', {})).toEqual({
      listenMessageEchoes: false,
    });
    expect(normalizeBotpressIntegrationField('telegram', 'enabled', false)).toBe(false);
  });
});
