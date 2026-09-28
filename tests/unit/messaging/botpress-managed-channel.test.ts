import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BotpressManagedChannel,
} from '@/features/messaging/adapters/botpress-managed.channel';
import {
  AmbiguousChannelError,
} from '@/features/messaging/ports/message-channel';

afterEach(() => {
  vi.unstubAllGlobals();
});

function channel() {
  return new BotpressManagedChannel({
    apiUrl: 'https://api.botpress.test',
    token: 'secret-token',
    botId: 'bot-studyx',
    timeoutMs: 1_000,
  }, 'whatsapp');
}

describe('BotpressManagedChannel', () => {
  it('submits a proactive message to the existing Botpress conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { id: 'bp-message-1', createdAt: '2026-09-28T00:00:00.000Z' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(channel().sendText({
      destination: 'bp-conversation-1',
      text: 'No pudimos comunicarnos. Quieres que lo intentemos de nuevo?',
      correlationId: 'delivery-1',
    })).resolves.toEqual({
      providerMessageId: 'bp-message-1',
      acceptedAt: '2026-09-28T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.botpress.test/v1/chat/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'x-bot-id': 'bot-studyx',
        }),
        body: JSON.stringify({
          payload: { text: 'No pudimos comunicarnos. Quieres que lo intentemos de nuevo?' },
          userId: 'bot-studyx',
          conversationId: 'bp-conversation-1',
          type: 'text',
          tags: {},
          origin: 'synthetic',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('classifies an authorization failure as a confirmed configuration error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    await expect(channel().sendText({
      destination: 'bp-conversation-1', text: 'hola', correlationId: 'delivery-1',
    })).rejects.toMatchObject({
      name: 'ConfirmedChannelError', kind: 'config_error', code: 'BOTPRESS_HTTP_403',
    });
  });

  it('treats a timeout as ambiguous instead of retrying a possibly delivered message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(channel().sendText({
      destination: 'bp-conversation-1', text: 'hola', correlationId: 'delivery-1',
    })).rejects.toBeInstanceOf(AmbiguousChannelError);
  });
});
