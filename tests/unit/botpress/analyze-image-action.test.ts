import { afterEach, describe, expect, it, vi } from 'vitest';
import { secrets } from '../../helpers/botpress-runtime-stub';

afterEach(() => {
  delete secrets.GEMINI_API_KEY;
  vi.unstubAllGlobals();
});

describe('analyzeImage action', () => {
  it('downloads a trusted Botpress image and returns its Gemini description without returning the URL', async () => {
    secrets.GEMINI_API_KEY = 'fake-gemini-key';
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://files.bpcontent.cloud/')) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
        });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Comprobante de transferencia por USD 50.' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const imageActionModule = await import(
      '../../../botpress-agent/src/actions/analyzeImage'
    ).catch(() => null);
    const handler = imageActionModule
      ? (imageActionModule.analyzeImage as unknown as {
        definition: { handler: (args: { input: unknown }) => Promise<unknown> };
      }).definition.handler
      : null;
    const result = handler
      ? await handler({
        input: {
          media_download_url: 'https://files.bpcontent.cloud/2026/10/07/payment.jpg',
        },
      })
      : null;

    expect(result).toEqual({
      status: 'ok',
      text: 'Comprobante de transferencia por USD 50.',
      provider: 'gemini/gemini-2.5-flash',
      reason: null,
    });
    expect(JSON.stringify(result)).not.toContain('files.bpcontent.cloud');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
