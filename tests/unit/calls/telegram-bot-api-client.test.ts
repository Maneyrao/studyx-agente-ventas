import { describe, expect, it, vi } from 'vitest';
import {
  TelegramAmbiguousError,
  TelegramApiError,
  TelegramBotApiClient,
} from '@/features/calls/adapters/telegram-bot-api.client';

describe('TelegramBotApiClient', () => {
  it('returns provider acceptance evidence without exposing the token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new TelegramBotApiClient({ token: 'super-secret-token', fetchImpl, timeoutMs: 100 });
    await expect(client.sendMessage({
      chatId: '123', text: 'receipt', correctCallbackData: 'bctx:abcdefgh:ok', incorrectCallbackData: 'bctx:abcdefgh:bad',
    })).resolves.toMatchObject({ messageId: '42' });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/sendMessage');
    expect(JSON.parse(String(options?.body))).toMatchObject({ chat_id: '123', text: 'receipt' });
  });

  it('classifies confirmed provider errors and sanitizes their messages', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error_code: 400, description: 'token super-secret-token invalid',
    }), { status: 400 }));
    const client = new TelegramBotApiClient({ token: 'super-secret-token', fetchImpl, timeoutMs: 100 });
    const error = await client.sendMessage({ chatId: '123', text: 'x', correctCallbackData: 'bctx:abcdefgh:ok', incorrectCallbackData: 'bctx:abcdefgh:bad' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error).toMatchObject({ code: 'TELEGRAM_REJECTED', retryable: false });
    expect(String(error)).not.toContain('super-secret-token');
  });

  it('classifies 429 separately with retry evidence', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error_code: 429, parameters: { retry_after: 3 },
    }), { status: 429 }));
    const client = new TelegramBotApiClient({ token: 'secret', fetchImpl, timeoutMs: 100 });
    await expect(client.sendMessage({ chatId: '123', text: 'x', correctCallbackData: 'bctx:abcdefgh:ok', incorrectCallbackData: 'bctx:abcdefgh:bad' }))
      .rejects.toMatchObject({ code: 'TELEGRAM_RATE_LIMITED', retryable: true, retryAfterSeconds: 3 });
  });

  it('treats timeout as ambiguous because Telegram may have accepted the send', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const client = new TelegramBotApiClient({ token: 'secret', fetchImpl, timeoutMs: 1 });
    await expect(client.sendMessage({ chatId: '123', text: 'x', correctCallbackData: 'bctx:abcdefgh:ok', incorrectCallbackData: 'bctx:abcdefgh:bad' }))
      .rejects.toBeInstanceOf(TelegramAmbiguousError);
  });

  it('answers callback queries to close Telegram spinner', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    const client = new TelegramBotApiClient({ token: 'secret', fetchImpl, timeoutMs: 100 });
    await client.answerCallbackQuery({ callbackQueryId: 'callback-1', text: 'Registrado' });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/answerCallbackQuery');
  });
});
