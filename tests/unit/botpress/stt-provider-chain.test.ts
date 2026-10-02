import { describe, expect, it, vi } from 'vitest';
import { transcribeWithProviderChain } from '../../../botpress-agent/src/lib/transcription/provider-chain';

const bytes = new Uint8Array([1, 2, 3]);

describe('transcribeWithProviderChain', () => {
  it('uses the primary provider once and does not call the fallback after success', async () => {
    const groq = vi.fn(async () => ({
      status: 'ok' as const,
      text: 'Quiero estudiar inglés',
      provider: 'groq/whisper-large-v3-turbo',
    }));
    const gemini = vi.fn();

    const result = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: 'audio/ogg',
      providers: [
        { provider: 'groq', api_key: 'groq-key', model: 'whisper-large-v3-turbo' },
        { provider: 'gemini', api_key: 'gemini-key', model: 'gemini-configurado' },
      ],
      adapters: { groq, gemini },
    });

    expect(result.status).toBe('ok');
    expect(groq).toHaveBeenCalledTimes(1);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('falls back once when the primary provider fails', async () => {
    const groq = vi.fn(async () => ({
      status: 'failed' as const,
      reason: 'HTTP_429',
      provider: 'groq/whisper-large-v3-turbo',
    }));
    const gemini = vi.fn(async () => ({
      status: 'ok' as const,
      text: 'Quiero estudiar inglés',
      provider: 'gemini/gemini-configurado',
    }));

    const result = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: 'audio/ogg',
      providers: [
        { provider: 'groq', api_key: 'groq-key', model: 'whisper-large-v3-turbo' },
        { provider: 'gemini', api_key: 'gemini-key', model: 'gemini-configurado' },
      ],
      adapters: { groq, gemini },
    });

    expect(result).toMatchObject({ status: 'ok', provider: 'gemini/gemini-configurado' });
    expect(groq).toHaveBeenCalledTimes(1);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('keeps the turn recoverable when the primary adapter throws unexpectedly', async () => {
    const groq = vi.fn(async () => { throw new Error('provider exploded'); });
    const gemini = vi.fn(async () => ({
      status: 'ok' as const,
      text: 'Texto recuperado',
      provider: 'gemini/gemini-configurado',
    }));

    const result = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: 'audio/ogg',
      providers: [
        { provider: 'groq', api_key: 'groq-key', model: 'whisper-large-v3-turbo' },
        { provider: 'gemini', api_key: 'gemini-key', model: 'gemini-configurado' },
      ],
      adapters: { groq, gemini },
    });

    expect(result).toMatchObject({ status: 'ok', text: 'Texto recuperado' });
    expect(groq).toHaveBeenCalledTimes(1);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('fails without making a provider request when no provider is configured', async () => {
    const groq = vi.fn();
    const gemini = vi.fn();
    const result = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: 'audio/ogg',
      providers: [],
      adapters: { groq, gemini },
    });

    expect(result).toEqual({ status: 'failed', reason: 'STT_DISABLED', provider: 'disabled' });
    expect(groq).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('skips duplicate and keyless providers instead of producing extra calls', async () => {
    const groq = vi.fn(async () => ({
      status: 'failed' as const,
      reason: 'NETWORK_ERROR',
      provider: 'groq/whisper-large-v3-turbo',
    }));
    const gemini = vi.fn();
    const result = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: 'audio/ogg',
      providers: [
        { provider: 'groq', api_key: '', model: 'whisper-large-v3-turbo' },
        { provider: 'groq', api_key: 'groq-key', model: 'whisper-large-v3-turbo' },
        { provider: 'groq', api_key: 'other-key', model: 'whisper-large-v3-turbo' },
      ],
      adapters: { groq, gemini },
    });

    expect(result).toMatchObject({ status: 'failed', provider: 'groq/whisper-large-v3-turbo' });
    expect(groq).toHaveBeenCalledTimes(1);
    expect(gemini).not.toHaveBeenCalled();
  });
});
