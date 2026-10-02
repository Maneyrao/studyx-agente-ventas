import { describe, expect, it, vi } from 'vitest';
import { transcribeWithGroq } from '../../../botpress-agent/src/lib/transcription/groq';

const AUDIO_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);

describe('transcribeWithGroq', () => {
  it('sends one multipart transcription request with Whisper large v3 turbo', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ text: '  Hola, quiero información de inglés.  ' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    const result = await transcribeWithGroq({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'groq-secret',
      fetch_impl: fetchImpl,
    });

    expect(result).toEqual({
      status: 'ok',
      text: 'Hola, quiero información de inglés.',
      provider: 'groq/whisper-large-v3-turbo',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer groq-secret');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('json');
    expect(form.get('temperature')).toBe('0');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('does not expose the API key when Groq returns an error body', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'invalid key groq-secret' } }),
      { status: 401 },
    )) as unknown as typeof fetch;

    const result = await transcribeWithGroq({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'groq-secret',
      fetch_impl: fetchImpl,
    });

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('groq-secret');
    if (result.status === 'failed') expect(result.reason).toBe('HTTP_401');
  });

  it('treats an empty transcript as unintelligible', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ text: '   ' }),
      { status: 200 },
    )) as unknown as typeof fetch;

    const result = await transcribeWithGroq({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: fetchImpl,
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'UNINTELLIGIBLE' });
  });
});
