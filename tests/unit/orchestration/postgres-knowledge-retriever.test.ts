import { describe, expect, it, vi } from 'vitest';

// The adapter module builds default singletons at import time; keep the suite
// pure by mocking the lazy DB client and the embedding provider.
vi.mock('@/lib/db/orchestrator', () => ({
  sql: Object.assign(() => Promise.resolve([]), { end: async () => {} }),
}));
vi.mock('@/lib/embeddings/gemini', () => ({
  EMBEDDING_EPOCH: 'gemini-embedding-2:768:retrieval-v1',
  generateQueryEmbedding: async () => Array.from({ length: 768 }, () => 0.001),
}));

import {
  PostgresKnowledgeRetriever,
  PostgresMemoryRetriever,
} from '@/features/orchestration/adapters/postgres-retrievers';
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

const VECTOR = Array.from({ length: 768 }, (_, index) => index === 0 ? 0.25 : 0);

describe('PostgresKnowledgeRetriever workspace scoping', () => {
  it('binds the backend-resolved workspace id as the first search parameter', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, async () => WORKSPACE_ID);

    await retriever.search({ embedding: VECTOR, limit: 5, min_similarity: 0.75 });

    expect(calls).toHaveLength(1);
    expect(calls[0].params[0]).toBe(WORKSPACE_ID);
    expect(calls[0].params[1]).toBe(`[${VECTOR.join(',')}]`);
    expect(calls[0].params[2]).toBe('gemini-embedding-2:768:retrieval-v1');
  });

  it('fails closed when the workspace cannot be resolved: throws without querying', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, async () => {
      throw new Error('MISSING_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG');
    });

    await expect(
      retriever.search({ embedding: VECTOR, limit: 5, min_similarity: 0.75 })
    ).rejects.toThrow(/MISSING_BUSINESS_CONFIG/);
    expect(calls).toHaveLength(0);
  });

  it('search input cannot override the workspace: extra fields are ignored', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresKnowledgeRetriever(fn, async () => WORKSPACE_ID);

    await retriever.search({
      embedding: VECTOR,
      limit: 5,
      min_similarity: 0.75,
      // A hostile caller trying to smuggle a tenant in through the input.
      ...( { workspace_id: '11111111-1111-1111-1111-111111111111' } as object),
    });

    expect(calls[0].params[0]).toBe(WORKSPACE_ID);
  });
});

describe('PostgresMemoryRetriever vector boundary', () => {
  it('searches with the caller-provided vector without embedding inside the adapter', async () => {
    const { fn, calls } = dbMock([]);
    const retriever = new PostgresMemoryRetriever(fn);

    await retriever.search({
      contact_id: '00000000-0000-0000-0000-0000000000aa',
      embedding: VECTOR,
      limit: 5,
      min_similarity: 0.75,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].params[1]).toBe(`[${VECTOR.join(',')}]`);
    expect(calls[0].params[2]).toBe('gemini-embedding-2:768:retrieval-v1');
  });
});
