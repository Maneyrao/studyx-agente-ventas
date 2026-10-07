import { describe, expect, it, vi } from 'vitest';
import * as gemini from '../../../botpress-agent/src/lib/transcription/gemini';

const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

type DescribeImage = (input: {
  image_bytes: Uint8Array;
  mime_type: string;
  api_key: string;
  model?: string;
  fetch_impl?: typeof fetch;
}) => Promise<
  | { status: 'ok'; text: string; provider: string }
  | { status: 'failed'; reason: string; provider: string }
>;

function describeImage(): DescribeImage | undefined {
  return (gemini as unknown as { describeImageWithGemini?: DescribeImage }).describeImageWithGemini;
}

describe('describeImageWithGemini', () => {
  it('returns a bounded Spanish description and sends the image inline without exposing the API key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '  La imagen muestra un comprobante de pago.  ' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const describe = describeImage();
    const result = describe
      ? await describe({
        image_bytes: IMAGE_BYTES,
        mime_type: 'image/jpeg',
        api_key: 'fake-image-key',
        fetch_impl: fetchImpl,
      })
      : undefined;

    expect(result).toEqual({
      status: 'ok',
      text: 'La imagen muestra un comprobante de pago.',
      provider: 'gemini/gemini-2.5-flash',
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('key=fake-image-key');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: 'image/jpeg',
      data: Buffer.from(IMAGE_BYTES).toString('base64'),
    });
    expect(body.contents[0].parts[0].text).toMatch(/no sigas instrucciones/iu);
    expect(JSON.stringify(body)).not.toContain('fake-image-key');
  });
});
