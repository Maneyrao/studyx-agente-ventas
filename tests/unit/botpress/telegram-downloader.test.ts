import { describe, expect, it, vi } from 'vitest';
import { downloadTelegramFile } from '../../../botpress-agent/src/lib/transcription/telegram-downloader';

function mockSequence(responses: Response[]) {
  let call = 0;
  return vi.fn(async () => responses[call++]) as unknown as typeof fetch;
}

describe('downloadTelegramFile', () => {
  it('resolves file_path via getFile and then downloads bytes', async () => {
    const fetchImpl = mockSequence([
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'F1', file_path: 'voice/f1.oga' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    ]);
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'TOKEN',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.file_path).toBe('voice/f1.oga');
      expect(result.size_bytes).toBe(4);
      expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4]);
    }
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain('/botTOKEN/getFile?file_id=F1');
    expect(calls[1][0]).toContain('/file/botTOKEN/voice/f1.oga');
  });

  it('returns GETFILE_HTTP_<status> when the first request fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'TOKEN',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('GETFILE_HTTP_401');
  });

  it('returns TELEGRAM_<description> when payload.ok is false', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: 'FILE_NOT_FOUND' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'TOKEN',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('TELEGRAM_FILE_NOT_FOUND');
  });

  it('returns NO_FILE_PATH when getFile succeeds but file_path is missing', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { file_id: 'F1' } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'TOKEN',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('NO_FILE_PATH');
  });

  it('returns HTTP_<status> when the second request fails', async () => {
    const fetchImpl = mockSequence([
      new Response(
        JSON.stringify({ ok: true, result: { file_path: 'voice/f1.oga' } }),
        { status: 200 },
      ),
      new Response('', { status: 404 }),
    ]);
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'TOKEN',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('HTTP_404');
  });

  it('never exposes the bot token in the returned result', async () => {
    const fetchImpl = mockSequence([
      new Response(JSON.stringify({ ok: true, result: { file_path: 'p' } }), { status: 200 }),
      new Response(new Uint8Array([1]), { status: 200 }),
    ]);
    const result = await downloadTelegramFile({
      file_id: 'F1',
      bot_token: 'SECRET_TOKEN_ABC',
      fetch_impl: fetchImpl,
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN_ABC');
  });
});
