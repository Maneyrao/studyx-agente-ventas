const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_TIMEOUT_MS = 15000;

/**
 * Width of every vector this module produces. `extensions.vector(n)` columns
 * and the `search_*` functions are declared against this exact number, so a
 * provider or model swap has to land together with an additive migration.
 * `tests/integration/embedding-dimensions.test.ts` fails when they drift.
 */
export const EMBEDDING_DIMENSIONS = 768;

interface GeminiEmbedResponse {
  embedding?: { values?: unknown };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(EMBEDDING_MODEL)}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const body = { content: { parts: [{ text }] } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GEMINI_EMBED_HTTP_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as GeminiEmbedResponse;
  const values = payload?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('GEMINI_EMBED_NO_VALUES');
  }
  // A silently reshaped model would otherwise surface as a pgvector dimension
  // error deep inside a transaction; fail at the boundary instead.
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`GEMINI_EMBED_DIMENSION_MISMATCH:${values.length}`);
  }
  return values as number[];
}
