import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level tests: prove that one production Telegram event starts exactly
 * one durable workflow, that outbound/unknown events never start one, and that
 * the emulator (webchat) path keeps working alongside Telegram.
 *
 * `@botpress/runtime` and the workflow module are mocked so the test exercises
 * the real router + adapters without the ADK execution context.
 */
const { getOrCreate } = vi.hoisted(() => ({ getOrCreate: vi.fn() }));

vi.mock('../../../botpress-agent/src/workflows/processInboundTurn', () => ({
  processInboundTurn: { getOrCreate },
}));

// The router's `@botpress/runtime` import resolves to this stub via the vitest
// alias, so importing the stub directly yields the same module instance.
import { configuration } from '../../helpers/botpress-runtime-stub';
import router from '../../../botpress-agent/src/conversations/router';
import { deriveEmulatorPhoneE164 } from '../../../botpress-agent/src/channels/shared/emulator-envelope';

type RouterHandler = (props: {
  type: string;
  channel: string;
  message: unknown;
  conversation: { id: string; alias?: string; integration?: string; tags?: Record<string, string> };
  chat?: { clearTranscript: () => Promise<void>; saveTranscript: () => Promise<void> };
}) => Promise<void>;

const definition = (router as unknown as { definition: { channel: string; handler: RouterHandler } })
  .definition;

const PROD_TELEGRAM_USER_ID = '8464326323';

const telegramConversation = {
  id: 'conv_01KZTYMERFCW15NPR3WP8SJT2B',
  alias: 'telegram',
  integration: 'telegram',
  tags: {
    'telegram:fromUserId': PROD_TELEGRAM_USER_ID,
    'telegram:chatId': PROD_TELEGRAM_USER_ID,
  },
};

const telegramInbound = {
  id: '389430fc-1b87-4389-b657-e7903ec9bf44',
  createdAt: '2026-08-12T12:35:15.624Z',
  type: 'text',
  direction: 'incoming',
  userId: 'user_01KZTYMESMHSM7ECVYSZAEGZ5X',
  conversationId: 'conv_01KZTYMERFCW15NPR3WP8SJT2B',
  payload: { text: 'Hola' },
  tags: { 'telegram:id': '60', 'telegram:chatId': PROD_TELEGRAM_USER_ID },
};

beforeEach(() => {
  getOrCreate.mockReset();
  getOrCreate.mockResolvedValue({ id: 'wrkflow_test_1' });
});

describe('router registration', () => {
  it('registers a single wildcard conversation handler', () => {
    expect(definition.channel).toBe('*');
    expect(typeof definition.handler).toBe('function');
  });
});

describe('router dispatch for production Telegram events', () => {
  it('clears the managed Botpress transcript before starting StudyX', async () => {
    const chat = {
      clearTranscript: vi.fn(async () => undefined),
      saveTranscript: vi.fn(async () => undefined),
    };

    await definition.handler({
      type: 'message',
      channel: 'telegram.channel',
      message: telegramInbound,
      conversation: telegramConversation,
      chat,
    });

    expect(chat.clearTranscript).toHaveBeenCalledTimes(1);
    expect(chat.saveTranscript).toHaveBeenCalledTimes(1);
    expect(chat.clearTranscript.mock.invocationCallOrder[0]).toBeLessThan(
      getOrCreate.mock.invocationCallOrder[0]!,
    );
  });

  it('continues when managed transcript reset fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const chat = {
      clearTranscript: vi.fn(async () => { throw new Error('quota'); }),
      saveTranscript: vi.fn(async () => undefined),
    };

    await expect(definition.handler({
      type: 'message',
      channel: 'telegram.channel',
      message: telegramInbound,
      conversation: telegramConversation,
      chat,
    })).resolves.toBeUndefined();

    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(info.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringContaining('studyx.router.transcript_reset_failed'),
    );
  });

  it('starts exactly one workflow for one inbound Telegram message', async () => {
    await definition.handler({
      type: 'message',
      channel: 'telegram.channel',
      message: telegramInbound,
      conversation: telegramConversation,
    });

    expect(getOrCreate).toHaveBeenCalledTimes(1);
    const call = getOrCreate.mock.calls[0][0];
    expect(call.key).toBe(`turn:botpress:telegram:${telegramInbound.id}`);
    expect(call.input.phone_e164).toBe('+9998464326323');
    expect(call.input.sandbox_provider).toBe('telegram_sandbox');
  });

  it('derives the same idempotent workflow key when the same message is delivered twice', async () => {
    const props = {
      type: 'message',
      channel: 'telegram.channel',
      message: telegramInbound,
      conversation: telegramConversation,
    };
    await definition.handler(props);
    await definition.handler(props);

    expect(getOrCreate).toHaveBeenCalledTimes(2);
    expect(getOrCreate.mock.calls[0][0].key).toBe(getOrCreate.mock.calls[1][0].key);
  });

  it('never starts a workflow for an outbound Telegram message', async () => {
    await definition.handler({
      type: 'message',
      channel: 'telegram.channel',
      message: { ...telegramInbound, direction: 'outgoing' },
      conversation: telegramConversation,
    });
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('skips unknown channels without starting a workflow', async () => {
    await definition.handler({
      type: 'message',
      channel: 'slack.channel',
      message: telegramInbound,
      conversation: { id: 'conv_x', alias: 'slack', integration: 'slack' },
    });
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('survives a workflow start failure without throwing (degradación segura)', async () => {
    getOrCreate.mockRejectedValueOnce(new Error('boom'));
    await expect(
      definition.handler({
        type: 'message',
        channel: 'telegram.channel',
        message: telegramInbound,
        conversation: telegramConversation,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('router dispatch for the emulator (webchat) channel', () => {
  it('still routes webchat messages through the emulator adapter', async () => {
    await definition.handler({
      type: 'message',
      channel: 'webchat.channel',
      message: {
        id: 'msg-emulator-1',
        createdAt: '2026-08-12T12:00:00.000Z',
        type: 'text',
        direction: 'incoming',
        userId: 'user_01EMU',
        conversationId: 'conv_01EMU',
        payload: { text: 'Hola emulador' },
      },
      conversation: { id: 'conv_01EMU', alias: 'webchat', integration: 'webchat' },
    });

    expect(getOrCreate).toHaveBeenCalledTimes(1);
    const call = getOrCreate.mock.calls[0][0];
    expect(call.input.phone_e164).toBe(
      deriveEmulatorPhoneE164(configuration.emulatorPhoneE164, 'conv_01EMU'),
    );
    expect(call.key).toBe('turn:botpress:webchat:msg-emulator-1');
  });
});
