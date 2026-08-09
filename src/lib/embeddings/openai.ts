import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_TIMEOUT_MS = 15000;

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await getOpenAIClient().embeddings.create(
      { model: EMBEDDING_MODEL, input: text },
      { signal: controller.signal }
    );
    return response.data[0].embedding;
  } finally {
    clearTimeout(timeout);
  }
}
