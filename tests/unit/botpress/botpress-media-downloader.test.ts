import { describe, expect, it, vi } from 'vitest';
import * as mediaDownloader from '../../../botpress-agent/src/lib/transcription/botpress-media-downloader';

const { downloadBotpressAudio } = mediaDownloader;

describe('downloadBotpressAudio', () => {
  it('downloads audio only from Botpress Files and returns bytes without the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/ogg', 'content-length': '3' },
    })) as unknown as typeof fetch;

    const result = await downloadBotpressAudio({
      url: 'https://files.bpcontent.cloud/2026/10/02/audio.ogg',
      fetch_impl: fetchImpl,
    });

    expect(result).toEqual({
      status: 'ok',
      bytes: new Uint8Array([1, 2, 3]),
      size_bytes: 3,
      mime_type: 'audio/ogg',
    });
    expect(JSON.stringify(result)).not.toContain('files.bpcontent.cloud');
  });

  it.each([
    'http://files.bpcontent.cloud/audio.ogg',
    'https://files.bpcontent.cloud.evil.example/audio.ogg',
    'https://127.0.0.1/audio.ogg',
  ])('rejects an untrusted media URL before fetch: %s', async (url) => {
    const fetchImpl = vi.fn();
    const result = await downloadBotpressAudio({ url, fetch_impl: fetchImpl });
    expect(result).toEqual({ status: 'failed', reason: 'UNTRUSTED_MEDIA_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-audio response', async () => {
    const fetchImpl = vi.fn(async () => new Response('not audio', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;
    const result = await downloadBotpressAudio({
      url: 'https://files.bpcontent.cloud/audio.ogg',
      fetch_impl: fetchImpl,
    });
    expect(result).toEqual({ status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' });
  });
});

describe('downloadBotpressImage', () => {
  it('accepts an image from Botpress Files and rejects the same bytes under a non-image content type', async () => {
    const downloadImage = (mediaDownloader as unknown as {
      downloadBotpressImage?: (input: {
        url: string;
        fetch_impl?: typeof fetch;
      }) => Promise<unknown>;
    }).downloadBotpressImage;
    const imageResponse = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
    })) as unknown as typeof fetch;

    const accepted = downloadImage
      ? await downloadImage({
        url: 'https://files.bpcontent.cloud/2026/10/07/customer.jpg',
        fetch_impl: imageResponse,
      })
      : undefined;

    expect(accepted).toEqual({
      status: 'ok',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      size_bytes: 3,
      mime_type: 'image/jpeg',
    });

    const rejected = downloadImage
      ? await downloadImage({
        url: 'https://files.bpcontent.cloud/2026/10/07/not-an-image.jpg',
        fetch_impl: vi.fn(async () => new Response('html', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })) as unknown as typeof fetch,
      })
      : undefined;
    expect(rejected).toEqual({ status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' });
  });
});
