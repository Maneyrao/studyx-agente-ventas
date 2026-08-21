import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the DB tagged-template `sql` and the embedding provider so this
// suite runs pure without Supabase or OpenAI.
const sqlCalls: Array<{ strings: TemplateStringsArray; params: unknown[]; result: unknown[] }> = [];
let nextSqlResult: unknown[] = [];

function sqlMock(strings: TemplateStringsArray, ...params: unknown[]) {
  const result = nextSqlResult;
  sqlCalls.push({ strings, params, result });
  return Promise.resolve(result);
}
sqlMock.end = async () => {};

vi.mock('@/lib/db/orchestrator', () => ({ sql: sqlMock }));

const embedCalls: string[] = [];
vi.mock('@/lib/embeddings/gemini', () => ({
  generateQueryEmbedding: vi.fn(async (text: string) => {
    embedCalls.push(`query:${text}`);
    return Array.from({ length: 768 }, () => 0.001);
  }),
  generateDocumentEmbedding: vi.fn(async (input: { text: string }) => {
    embedCalls.push(`document:${input.text}`);
    return Array.from({ length: 768 }, () => 0.001);
  }),
}));

vi.mock('@/lib/observability/counters', () => ({
  counter: { increment: vi.fn() },
}));

vi.mock('@/lib/observability/structured-log', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { searchKnowledgeBase, ingestDocument } from '@/lib/services/knowledge-base.service';

beforeEach(() => {
  sqlCalls.length = 0;
  embedCalls.length = 0;
  nextSqlResult = [];
});

const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa';

describe('searchKnowledgeBase', () => {
  it('rejects when the query is missing or blank', async () => {
    await expect(searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: '', limit: 5, min_similarity: 0.75 }))
      .rejects.toThrow(/query is required/);
    await expect(searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: '   ', limit: 5, min_similarity: 0.75 }))
      .rejects.toThrow(/query is required/);
  });

  it('rejects a missing or malformed workspace_id before embedding anything', async () => {
    await expect(
      searchKnowledgeBase({ workspace_id: '', query: 'precio', limit: 5, min_similarity: 0.75 }),
    ).rejects.toThrow(/workspace_id/);
    await expect(
      searchKnowledgeBase({ workspace_id: 'not-a-uuid', query: 'precio', limit: 5, min_similarity: 0.75 }),
    ).rejects.toThrow(/workspace_id/);
    expect(embedCalls).toEqual([]);
  });

  it('uses the query embedding interface with the exact query text', async () => {
    nextSqlResult = [];
    await searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: '¿Cuánto sale el curso?', limit: 5, min_similarity: 0.75 });
    expect(embedCalls).toEqual(['query:¿Cuánto sale el curso?']);
  });

  it('scopes the SQL call to the given workspace', async () => {
    nextSqlResult = [];
    await searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: 'test', limit: 5, min_similarity: 0.75 });
    const call = sqlCalls[0];
    // params: [workspace_id, embedding_json, limit, min_similarity]
    expect(call.params[0]).toBe(WORKSPACE_ID);
  });

  it('caps limit at 20 (defense against caller mistakes)', async () => {
    nextSqlResult = [];
    await searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: 'test', limit: 999, min_similarity: 0 });
    const call = sqlCalls[0];
    // params: [workspace_id, embedding_json, limit, min_similarity]
    expect(call.params[2]).toBe(20);
  });

  it('returns rows verbatim from the SQL function', async () => {
    nextSqlResult = [
      {
        chunk_id: '00000000-0000-0000-0000-000000000001',
        document_id: '00000000-0000-0000-0000-000000000010',
        source_uri: 'kb/pricing.md',
        title: 'Pricing',
        content: 'The course costs 100 pesos.',
        similarity: 0.91,
      },
    ];
    const result = await searchKnowledgeBase({
      workspace_id: WORKSPACE_ID,
      query: 'precio del curso',
      limit: 5,
      min_similarity: 0.75,
    });
    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual(nextSqlResult[0]);
  });

  it('propagates embedding errors (fail-open is a caller responsibility)', async () => {
    const { generateQueryEmbedding } = await import('@/lib/embeddings/gemini');
    (generateQueryEmbedding as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('GEMINI_TIMEOUT'),
    );
    await expect(searchKnowledgeBase({ workspace_id: WORKSPACE_ID, query: 'x', limit: 5, min_similarity: 0.75 }))
      .rejects.toThrow(/GEMINI_TIMEOUT/);
  });
});

describe('ingestDocument', () => {
  it('rejects empty chunks', async () => {
    await expect(
      ingestDocument({ uri: 'kb/x.md', title: 'X', chunks: [] }),
    ).rejects.toThrow(/non-empty/);
  });

  it('picks version = max(existing)+1; first ingest is version 1', async () => {
    // Sequence per call: SELECT MAX(version) -> [{max_version: null}]
    //                    INSERT documents RETURNING id -> [{id: '...'}]
    //                    INSERT chunks (n calls) -> []
    const scripted: unknown[][] = [
      [{ max_version: null }],
      [{ id: '00000000-0000-0000-0000-000000000042' }],
      [],
    ];
    let cursor = 0;
    const originalMock = (await import('@/lib/db/orchestrator')).sql as unknown as {
      (...args: unknown[]): Promise<unknown[]>;
    };
    // Replace the module's sql fn with a scripted variant for this test only.
    vi.doMock('@/lib/db/orchestrator', () => ({
      sql: (_strings: TemplateStringsArray, ...params: unknown[]) => {
        const result = scripted[cursor] ?? [];
        sqlCalls.push({ strings: _strings, params, result });
        cursor++;
        return Promise.resolve(result);
      },
    }));
    vi.resetModules();
    const svc = await import('@/lib/services/knowledge-base.service');
    const result = await svc.ingestDocument({
      uri: 'kb/pricing.md',
      title: 'Pricing',
      chunks: [{ content: 'chunk zero content', token_count: 42 }],
    });
    void originalMock;
    expect(result.version).toBe(1);
    expect(result.chunks_written).toBe(1);
    expect(embedCalls).toEqual(['document:chunk zero content']);
  });
});
