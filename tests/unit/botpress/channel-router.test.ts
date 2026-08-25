import { describe, expect, it } from 'vitest';
import router from '../../../botpress-agent/src/conversations/router';
import { CHANNEL_ADAPTERS, dispatch } from '../../../botpress-agent/src/channels';
import { emulatorChannel } from '../../../botpress-agent/src/channels/emulator.channel';
import { telegramChannel } from '../../../botpress-agent/src/channels/telegram.channel';
import { whatsappChannel } from '../../../botpress-agent/src/channels/whatsapp.channel';
import type { ChannelAdapterContext } from '../../../botpress-agent/src/channels/shared/normalize';

const baseMessage = {
  id: 'message-1',
  createdAt: '2026-08-25T10:15:00.000Z',
  type: 'text',
  direction: 'incoming',
  userId: 'user-1',
  conversationId: 'conversation-1',
  payload: { text: 'Hola' },
  tags: {},
};

function ctx(overrides: Partial<ChannelAdapterContext>): ChannelAdapterContext {
  return {
    type: 'message',
    channel: 'whatsapp.channel',
    message: baseMessage,
    conversation: {
      id: 'conversation-1',
      alias: 'whatsapp',
      integration: 'whatsapp',
      tags: { 'whatsapp:userPhone': '5491112345678' },
    },
    traceId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

describe('channel adapter routing', () => {
  it('registers adapters in official WhatsApp, Telegram sandbox, emulator order', () => {
    expect(CHANNEL_ADAPTERS).toEqual([whatsappChannel, telegramChannel, emulatorChannel]);
  });

  it('routes one official WhatsApp text event only to whatsappChannel', () => {
    const context = ctx({});
    expect(CHANNEL_ADAPTERS.filter((adapter) => adapter.matches(context))).toEqual([
      whatsappChannel,
    ]);
    expect(dispatch(context)).toMatchObject({ kind: 'envelope', adapter: 'whatsapp' });
  });

  it('keeps Telegram events exclusive to telegramChannel', () => {
    const context = ctx({
      channel: 'telegram.channel',
      conversation: {
        id: 'telegram-conversation-1',
        alias: 'telegram',
        integration: 'telegram',
        tags: { 'telegram:fromUserId': '12345678', 'telegram:chatId': '12345678' },
      },
      message: {
        ...baseMessage,
        userId: 'telegram-user-1',
        conversationId: 'telegram-conversation-1',
        tags: { 'telegram:id': '42', 'telegram:chatId': '12345678' },
      },
    });

    expect(CHANNEL_ADAPTERS.filter((adapter) => adapter.matches(context))).toEqual([
      telegramChannel,
    ]);
    expect(dispatch(context)).toMatchObject({ kind: 'envelope', adapter: 'telegram' });
  });

  it('keeps webchat events routed to the emulator', () => {
    const context = ctx({
      channel: 'webchat.channel',
      conversation: {
        id: 'webchat-conversation-1',
        alias: 'webchat',
        integration: 'webchat',
      },
      message: {
        ...baseMessage,
        userId: 'webchat-user-1',
        conversationId: 'webchat-conversation-1',
      },
    });

    expect(CHANNEL_ADAPTERS.filter((adapter) => adapter.matches(context))).toEqual([
      emulatorChannel,
    ]);
    expect(dispatch(context)).toMatchObject({ kind: 'envelope', adapter: 'emulator' });
  });

  it('returns CHANNEL_UNSUPPORTED for an unregistered integration channel', () => {
    expect(dispatch(ctx({ channel: 'slack.channel' }))).toEqual({
      kind: 'skip',
      adapter: null,
      reason: 'CHANNEL_UNSUPPORTED',
    });
  });
});

describe('conversation router registration', () => {
  it('retains one wildcard conversation handler', () => {
    const definition = (router as unknown as { definition: { channel: string; handler: unknown } })
      .definition;
    expect(definition.channel).toBe('*');
    expect(typeof definition.handler).toBe('function');
  });
});
