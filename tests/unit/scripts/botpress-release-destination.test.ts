import { describe, expect, it } from 'vitest';

import {
  STUDYX_RELEASE_DESTINATION,
  assertBotpressReleaseDestination,
  normalizeBotpressIntegrationField,
} from '../../../scripts/lib/botpress-release-destination.mjs';

describe('Botpress StudyX release destination', () => {
  it('pins publication to the IPSJ-owned StudyX bot', () => {
    expect(STUDYX_RELEASE_DESTINATION).toEqual({
      profile: 'studyx-ipsj',
      workspaceId: 'wkspace_01KZ3JKAY3J597821CASY95DJT',
      botId: '28eefcf3-4623-4d5f-b08e-7d4c20a84d28',
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
