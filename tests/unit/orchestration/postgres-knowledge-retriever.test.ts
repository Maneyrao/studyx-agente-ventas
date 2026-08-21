import { describe, expect, it, vi } from 'vitest';

// The adapter module builds default singletons at import time; keep the suite
// pure by mocking the lazy DB client and the embedding provider.
vi.mock('@/lib/db/orchestrator', () => ({
  sql: Object.assign(() => Promise.resolve([]), { end: async () => {} }),
}));
vi.mock('@/lib/embeddings/gemini', () => ({
  generateQueryEmbedding: async () => Array.from({ length: 768 }, () => 0.001),
}));

import { PostgresKnowledgeRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import type { DbClient } from '@/lib/db/types';

const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000bb';

function dbMock(rows: unknown[] = []) {
  const calls: Array<{ params: unknown[] }> = [];
  const fn = ((_strings: TemplateStringsArray, ...params: unknown[]) => {
    calls.push({ params });
    return Promise.resolve(rows);
  }) as unknown as DbClient;
  return { fn, calls };
}

const embed = async () => Array.from({ length: 768 }, () => 0.001);

describe('PostgresKnowledgeRetriever workspace scoping', () => {
  it('binds the backend-resolved workspace id as the first search parameter', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, embed, async () => WORKSPACE_ID);

    await retriever.search({ query: 'precio', limit: 5, min_similarity: 0.75 });

    expect(calls).toHaveLength(1);
    expect(calls[0].params[0]).toBe(WORKSPACE_ID);
  });

  it('fails closed when the workspace cannot be resolved: throws without querying', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, embed, async () => {
      throw new Error('MISSING_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG');
    });

    await expect(
      retriever.search({ query: 'precio', limit: 5, min_similarity: 0.75 })
    ).rejects.toThrow(/MISSING_BUSINESS_CONFIG/);
    expect(calls).toHaveLength(0);
  });

  it('search input cannot override the workspace: extra fields are ignored', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, embed, async () => WORKSPACE_ID);

    await retriever.search({
      query: 'precio',
      limit: 5,
      min_similarity: 0.75,
      // A hostile caller trying to smuggle a tenant in through the input.
      ...( { workspace_id: '11111111-1111-1111-1111-111111111111' } as object),
    });

    expect(calls[0].params[0]).toBe(WORKSPACE_ID);
  });
});
