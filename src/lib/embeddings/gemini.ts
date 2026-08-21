const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_TIMEOUT_MS = 15_000;

export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_EPOCH = 'gemini-embedding-2:768:retrieval-v1';

type EmbeddingErrorClassification = 'retryable' | 'terminal_configuration';

interface GeminiEmbedResponse {
  embedding?: { values?: unknown };
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly classification: EmbeddingErrorClassification,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }

  get retryable(): boolean {
    return this.classification === 'retryable';
  }
}

export function isTerminalEmbeddingConfigurationError(error: unknown): boolean {
  return error instanceof EmbeddingProviderError
    && error.classification === 'terminal_configuration';
}

export function generateQueryEmbedding(text: string): Promise<number[]> {
  return requestEmbedding(`task: search result | query: ${text}`);
}

export function generateDocumentEmbedding(input: {
  title: string;
  text: string;
  kind: string;
}): Promise<number[]> {
  return requestEmbedding(`title: ${input.title || 'none'} | kind: ${input.kind} | text: ${input.text}`);
}

async function requestEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingProviderError('GEMINI_EMBED_API_KEY_MISSING', 'terminal_configuration');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EMBEDDING_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_BASE_URL}/models/${encodeURIComponent(EMBEDDING_MODEL)}:embedContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          embedContentConfig: { outputDimensionality: EMBEDDING_DIMENSIONS },
        }),
        signal: controller.signal,
      },
    );
  } catch {
    throw new EmbeddingProviderError(
      timedOut ? 'GEMINI_EMBED_TIMEOUT' : 'GEMINI_EMBED_NETWORK_ERROR',
      'retryable',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const classification: EmbeddingErrorClassification = [400, 401, 403, 404].includes(response.status)
      ? 'terminal_configuration'
      : 'retryable';
    throw new EmbeddingProviderError(
      `GEMINI_EMBED_HTTP_${response.status}`,
      classification,
      response.status,
    );
  }

  const payload = (await response.json()) as GeminiEmbedResponse;
  const values = payload.embedding?.values;
  if (
    !Array.isArray(values)
    || values.length !== EMBEDDING_DIMENSIONS
    || !values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new EmbeddingProviderError('GEMINI_EMBED_INVALID_VALUES', 'retryable');
  }

  return values;
}
