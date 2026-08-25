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

/**
 * Feature 007 — the classification the outbound send path relies on.
 *
 * These assert on `error_code`, never on `description`: Telegram publishes no
 * error-string contract, so a wording change must not alter behaviour.
 */
describe('TelegramBotApiClient error classification', () => {
  const respond = (status: number, body: Record<string, unknown>) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    }));

  const send = (fetchImpl: ReturnType<typeof respond>) =>
    new TelegramBotApiClient({ token: 't', fetchImpl, timeoutMs: 100 })
      .sendMessage({ chatId: '123', text: 'hola' });

  /** Runs a send expected to reject, and hands back the typed provider error. */
  const failure = async (fetchImpl: ReturnType<typeof respond>): Promise<TelegramApiError> => {
    try {
      await send(fetchImpl);
    } catch (error) {
      return error as TelegramApiError;
    }
    throw new Error('expected the send to reject');
  };

  it('treats a blocked bot (403) as permanent and retires the identity', async () => {
    const error = await failure(respond(403, {
      ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user',
    }));
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.kind).toBe('permanent');
    expect(error.retryable).toBe(false);
    expect(error.retiresIdentity).toBe(true);
  });

  it('treats an unknown chat (400) as permanent', async () => {
    const error = await failure(respond(400, {
      ok: false, error_code: 400, description: 'Bad Request: chat not found',
    }));
    expect(error.kind).toBe('permanent');
    expect(error.retiresIdentity).toBe(true);
  });

  // The one 400 that is worth retrying: the same message succeeds against the
  // new chat id, so retiring the identity here would lose a reachable contact.
  it('treats a supergroup migration (400 + migrate_to_chat_id) as transient', async () => {
    const error = await failure(respond(400, {
      ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded',
      parameters: { migrate_to_chat_id: -100123 },
    }));
    expect(error.kind).toBe('transient');
    expect(error.retryable).toBe(true);
    expect(error.migrateToChatId).toBe('-100123');
    expect(error.retiresIdentity).toBe(false);
  });

  it('treats a bad token (401) as a configuration fault, not the contact’s', async () => {
    const error = await failure(respond(401, { ok: false, error_code: 401, description: 'Unauthorized' }));
    expect(error.kind).toBe('config_error');
    expect(error.retiresIdentity).toBe(false);
  });

  it('treats a provider fault (5xx) as transient', async () => {
    const error = await failure(respond(500, { ok: false, error_code: 500, description: 'Internal Server Error' }));
    expect(error.kind).toBe('transient');
    expect(error.retryable).toBe(true);
  });

  it('carries retry_after on a rate limit', async () => {
    const error = await failure(respond(429, {
      ok: false, error_code: 429, description: 'Too Many Requests: retry after 7',
      parameters: { retry_after: 7 },
    }));
    expect(error.code).toBe('TELEGRAM_RATE_LIMITED');
    expect(error.kind).toBe('transient');
    expect(error.retryAfterSeconds).toBe(7);
  });

  // A timeout proves nothing: the message may already have reached the user.
  // Collapsing it into a permanent failure would invite a duplicate resend.
  it('reports a timeout as ambiguous, never as permanent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('aborted'));
    await expect(send(fetchImpl)).rejects.toBeInstanceOf(TelegramAmbiguousError);
  });

  it('omits the inline keyboard when no callbacks are given', async () => {
    const fetchImpl = respond(200, { ok: true, result: { message_id: 7 } });
    await send(fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).not.toHaveProperty('reply_markup');
  });

  it('still attaches the keyboard when callbacks are given', async () => {
    const fetchImpl = respond(200, { ok: true, result: { message_id: 7 } });
    await new TelegramBotApiClient({ token: 't', fetchImpl, timeoutMs: 100 }).sendMessage({
      chatId: '1', text: 'x', correctCallbackData: 'a', incorrectCallbackData: 'b',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toHaveProperty('reply_markup');
  });
});
