import { describe, expect, it } from 'vitest';

import {
  STUDYX_RELEASE_DESTINATION,
  assertBotpressReleaseDestination,
  assertBotpressReleaseRemoteIdentity,
  normalizeBotpressIntegrationField,
} from '../../../scripts/lib/botpress-release-destination.mjs';

describe('Botpress StudyX release destination', () => {
  it('pins publication to the shared StudyX admissions bot', () => {
    expect(STUDYX_RELEASE_DESTINATION).toEqual({
      profile: 'studyx-admissions',
      workspaceId: 'wkspace_01M75G5S9RYXD656HZ6J4SAHYQ',
      botId: 'e0f6be70-db0e-48e0-a9b7-f7864b6699d1',
      botName: 'Asesor de admisiones Studyx',
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

  it('requires the expected live WhatsApp connection in live mode', () => {
    const remote = {
      name: STUDYX_RELEASE_DESTINATION.botName,
      configuration: { data: {
        automationEnabled: true,
        whatsappPublicEnabled: true,
        whatsappCanaryEnabled: false,
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

  it('permits a registered but disabled WhatsApp connection only in preparation mode', () => {
    const remote = {
      name: STUDYX_RELEASE_DESTINATION.botName,
      configuration: { data: {
        automationEnabled: false,
        whatsappPublicEnabled: false,
        whatsappCanaryEnabled: false,
        whatsappAllowedBotPhoneNumberId: STUDYX_RELEASE_DESTINATION.whatsappBotPhoneNumberId,
      } },
      integrations: { whatsapp: {
        id: STUDYX_RELEASE_DESTINATION.whatsappIntegrationId,
        enabled: false,
        status: 'registered',
      } },
    };

    expect(() => assertBotpressReleaseRemoteIdentity(remote, { mode: 'preparation' }))
      .not.toThrow();
    expect(() => assertBotpressReleaseRemoteIdentity(remote)).toThrow(
      'REMOTE_WHATSAPP_CONNECTION_MISMATCH',
    );
    expect(() => assertBotpressReleaseRemoteIdentity({
      ...remote,
      configuration: { data: {
        ...remote.configuration.data,
        whatsappPublicEnabled: true,
      } },
    }, { mode: 'preparation' })).toThrow('REMOTE_PREPARATION_SAFETY_MISMATCH');
  });

  it('permits registration_pending while WhatsApp remains disabled in preparation mode', () => {
    const remote = {
      name: STUDYX_RELEASE_DESTINATION.botName,
      configuration: { data: {
        automationEnabled: false,
        whatsappPublicEnabled: false,
        whatsappCanaryEnabled: false,
        whatsappAllowedBotPhoneNumberId: STUDYX_RELEASE_DESTINATION.whatsappBotPhoneNumberId,
      } },
      integrations: { whatsapp: {
        id: STUDYX_RELEASE_DESTINATION.whatsappIntegrationId,
        enabled: false,
        status: 'registration_pending',
      } },
    };

    expect(() => assertBotpressReleaseRemoteIdentity(remote, { mode: 'preparation' }))
      .not.toThrow();
    expect(() => assertBotpressReleaseRemoteIdentity(remote))
      .toThrow('REMOTE_WHATSAPP_CONNECTION_MISMATCH');
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
