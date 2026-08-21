import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateDocumentEmbedding,
  generateQueryEmbedding,
} from '@/lib/embeddings/gemini';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-api-key';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.unstubAllGlobals();
});

describe('Gemini embeddings', () => {
  it('sends retrieval queries to Gemini Embedding 2 without exposing the API key in the URL', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      embedding: { values: Array.from({ length: 768 }, () => 0.125) },
    }), { status: 200 }));

    const embedding = await generateQueryEmbedding('precio del curso');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/models/gemini-embedding-2:embedContent');
    expect(String(url)).not.toContain('test-api-key');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-api-key');
    expect(JSON.parse(String(init?.body))).toEqual({
      content: { parts: [{ text: 'task: search result | query: precio del curso' }] },
      embedContentConfig: { outputDimensionality: 768 },
    });
    expect(embedding).toHaveLength(768);
    expect(embedding.every(Number.isFinite)).toBe(true);
  });

  it('uses the stable document retrieval instruction with its title and kind', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      embedding: { values: Array.from({ length: 768 }, () => 0.25) },
    }), { status: 200 }));

    await generateDocumentEmbedding({
      title: 'Guía de precios',
      text: 'Valores actualizados',
      kind: 'knowledge-base',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).content.parts[0].text).toBe(
      'title: Guía de precios | kind: knowledge-base | text: Valores actualizados',
    );
  });

  it.each([
    [401, 'terminal_configuration', false],
    [404, 'terminal_configuration', false],
    [429, 'retryable', true],
    [500, 'retryable', true],
  ])('classifies HTTP %i failures as %s', async (status, classification, retryable) => {
    fetchMock.mockResolvedValue(new Response('provider failure', { status }));

    await expect(generateQueryEmbedding('precio')).rejects.toMatchObject({
      classification,
      retryable,
      status,
    });
  });

  it('classifies malformed JSON in a successful response as retryable', async () => {
    fetchMock.mockResolvedValue(new Response('{', { status: 200 }));

    await expect(generateQueryEmbedding('precio')).rejects.toMatchObject({
      classification: 'retryable',
      retryable: true,
    });
  });

  it('rejects an embedding that is not exactly 768 finite numbers', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      embedding: { values: [...Array.from({ length: 767 }, () => 0.5), 'not-a-number'] },
    }), { status: 200 }));

    await expect(generateQueryEmbedding('precio')).rejects.toThrow('GEMINI_EMBED_INVALID_VALUES');
  });
});
