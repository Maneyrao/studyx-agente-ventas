import { describe, expect, it } from 'vitest';
import { loadMessagingChannelsConfig } from '@/lib/config';

const env = (overrides: Record<string, string | undefined>) =>
  ({ ...overrides }) as NodeJS.ProcessEnv;

const whatsappEnv = {
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'token',
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456',
  WHATSAPP_CLOUD_GRAPH_API_VERSION: 'v26.0',
};

describe('loadMessagingChannelsConfig', () => {
  it('reports both channels as absent when nothing is configured', () => {
    const config = loadMessagingChannelsConfig(env({}));
    expect(config.telegram).toBeNull();
    expect(config.whatsapp).toBeNull();
  });

  it('enables Telegram from the bot token already used by agent B', () => {
    const config = loadMessagingChannelsConfig(env({ TELEGRAM_AGENT_B_BOT_TOKEN: 'bot-token' }));
    expect(config.telegram).toMatchObject({ botToken: 'bot-token', integrationId: 'telegram-bot' });
  });

  // A half-configured channel would fail at send time, in the middle of a live
  // call. Failing at load keeps the blast radius at boot.
  it('refuses a WhatsApp token without its phone number id', () => {
    expect(() => loadMessagingChannelsConfig(env({ WHATSAPP_CLOUD_ACCESS_TOKEN: 'token' })))
      .toThrow(/MISSING_MESSAGING_CONFIG:WHATSAPP_CLOUD_PHONE_NUMBER_ID/);
  });

  it('refuses a WhatsApp token without a pinned Graph API version', () => {
    expect(() => loadMessagingChannelsConfig(env({
      WHATSAPP_CLOUD_ACCESS_TOKEN: 'token',
      WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456',
    }))).toThrow(/MISSING_MESSAGING_CONFIG:WHATSAPP_CLOUD_GRAPH_API_VERSION/);
  });

  it('rejects a malformed Graph API version instead of guessing one', () => {
    expect(() => loadMessagingChannelsConfig(env({ ...whatsappEnv, WHATSAPP_CLOUD_GRAPH_API_VERSION: '26' })))
      .toThrow(/INVALID_MESSAGING_CONFIG:WHATSAPP_CLOUD_GRAPH_API_VERSION/);
  });

  it('enables WhatsApp when every required variable is present', () => {
    const config = loadMessagingChannelsConfig(env(whatsappEnv));
    expect(config.whatsapp).toMatchObject({
      accessToken: 'token',
      phoneNumberId: '123456',
      graphApiVersion: 'v26.0',
      integrationId: 'whatsapp-cloud',
    });
  });

  it('falls back to a 5s request timeout when none is given', () => {
    const config = loadMessagingChannelsConfig(env({ TELEGRAM_AGENT_B_BOT_TOKEN: 'bot-token' }));
    expect(config.telegram?.requestTimeoutMs).toBe(5_000);
  });

  it('honours an explicit request timeout', () => {
    const config = loadMessagingChannelsConfig(env({
      TELEGRAM_AGENT_B_BOT_TOKEN: 'bot-token',
      MESSAGING_REQUEST_TIMEOUT_MS: '1200',
    }));
    expect(config.telegram?.requestTimeoutMs).toBe(1_200);
  });

  it('defaults the preference order deterministically', () => {
    expect(loadMessagingChannelsConfig(env({})).channelPreference).toEqual(['whatsapp', 'telegram']);
  });

  it('accepts an explicit preference order and drops duplicates', () => {
    const config = loadMessagingChannelsConfig(env({ MESSAGING_CHANNEL_PREFERENCE: 'telegram, whatsapp,telegram' }));
    expect(config.channelPreference).toEqual(['telegram', 'whatsapp']);
  });

  it('rejects an unknown channel in the preference order', () => {
    expect(() => loadMessagingChannelsConfig(env({ MESSAGING_CHANNEL_PREFERENCE: 'telegram,sms' })))
      .toThrow(/INVALID_MESSAGING_CONFIG:MESSAGING_CHANNEL_PREFERENCE:sms/);
  });
});
