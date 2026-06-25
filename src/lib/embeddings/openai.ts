import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_TIMEOUT_MS = 15000;

export async function generateEmbedding(text: string): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await openai.embeddings.create(
      { model: EMBEDDING_MODEL, input: text },
      { signal: controller.signal }
    );
    return response.data[0].embedding;
  } finally {
    clearTimeout(timeout);
  }
}
