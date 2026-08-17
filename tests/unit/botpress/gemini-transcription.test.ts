import { describe, expect, it, vi } from 'vitest';
import { transcribeWithGemini } from '../../../botpress-agent/src/lib/transcription/gemini';

const AUDIO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function mockOk(text: string) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text }] } },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

function mockHttpError(status: number, body = '') {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

function mockNetworkError() {
  return vi.fn(async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
}

describe('transcribeWithGemini', () => {
  it('returns status:ok with trimmed text on a valid Gemini response', async () => {
    const fetchImpl = mockOk('  Hola, quería saber los precios.  ');
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.text).toBe('Hola, quería saber los precios.');
      expect(result.provider).toBe('gemini/gemini-2.5-flash');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the audio as base64 inline_data with the requested mime_type', async () => {
    const fetchImpl = mockOk('ok');
    await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/mpeg',
      api_key: 'fake',
      fetch_impl: fetchImpl,
    });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    const inlinePart = body.contents[0].parts.find((p: unknown) => (p as Record<string, unknown>).inline_data);
    expect(inlinePart).toBeDefined();
    expect(inlinePart.inline_data.mime_type).toBe('audio/mpeg');
    // base64 of [0xff,0xd8,0xff,0xe0,0x00,0x10]
    expect(inlinePart.inline_data.data).toBe(Buffer.from(AUDIO_BYTES).toString('base64'));
  });

  it('places the API key in the query string, not the body', async () => {
    const fetchImpl = mockOk('ok');
    await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'sk-my-secret',
      fetch_impl: fetchImpl,
    });
    const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('key=sk-my-secret');
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(JSON.stringify(body)).not.toContain('sk-my-secret');
  });

  it('honors a custom model in both the URL and the provider label', async () => {
    const fetchImpl = mockOk('ok');
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      model: 'gemini-2.5-pro',
      fetch_impl: fetchImpl,
    });
    const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/models/gemini-2.5-pro:generateContent');
    if (result.status === 'ok') {
      expect(result.provider).toBe('gemini/gemini-2.5-pro');
    }
  });

  it('returns failed with UNINTELLIGIBLE when Gemini returns the ininteligible marker', async () => {
    const fetchImpl = mockOk('[audio_ininteligible]');
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('UNINTELLIGIBLE');
  });

  it('returns failed with HTTP_<status> on non-200 responses', async () => {
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: mockHttpError(429, 'rate limited'),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason.startsWith('HTTP_429')).toBe(true);
  });

  it('returns failed with NETWORK_ERROR when fetch throws', async () => {
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: mockNetworkError(),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('NETWORK_ERROR');
  });

  it('returns failed with NO_TEXT_IN_RESPONSE when candidates.parts has no text', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{}] } }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const result = await transcribeWithGemini({
      audio_bytes: AUDIO_BYTES,
      mime_type: 'audio/ogg',
      api_key: 'fake',
      fetch_impl: fetchImpl,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('NO_TEXT_IN_RESPONSE');
  });
});
