import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { EMBEDDING_DIMENSIONS, EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';

/**
 * Every pgvector column and every vector-taking function has to agree with the
 * dimension the configured embedding provider actually emits. The migration to
 * The previous 768-dimensional embedding provider moved `message_embeddings` but left
 * `knowledge_chunks` at the OpenAI-era 1536, so knowledge-base ingest and search
 * fail on a dimension mismatch the moment a real key is present — invisible
 * while `searchKnowledgeBase` fails open on a missing `GEMINI_API_KEY`.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => db?.end());

function unitVector(dimensions: number): string {
  const values = Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0));
  return `[${values.join(',')}]`;
}

run('pgvector dimensions match the embedding provider', () => {
  it('declares every active materialization vector at the provider dimension', async () => {
    const columns = await db!<Array<{ relation: string; column_name: string; type: string }>>`
      SELECT
        a.attrelid::regclass::text AS relation,
        a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute AS a
      JOIN pg_class AS c ON c.oid = a.attrelid
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ('message_embeddings', 'selected_memories', 'knowledge_chunks')
        AND format_type(a.atttypid, a.atttypmod) LIKE 'vector(%'
      ORDER BY relation, column_name
    `;

    expect(columns.length).toBeGreaterThan(0);
    expect(columns.map((column) => `${column.relation}.${column.column_name}=${column.type}`)).toEqual(
      columns.map((column) => `${column.relation}.${column.column_name}=vector(${EMBEDDING_DIMENSIONS})`)
    );
  });

  it('accepts a provider-sized embedding in knowledge_chunks', async () => {
    const uri = `vitest://kb/${randomUUID()}`;
    const documents = await db!<Array<{ id: string }>>`
      INSERT INTO knowledge_documents (uri, title, source_type, version)
      VALUES (${uri}, 'Dimensiones', 'markdown', 1)
      RETURNING id
    `;

    await expect(db!`
      INSERT INTO knowledge_chunks (
        document_id, chunk_index, content, token_count, embedding, embedding_epoch
      )
      VALUES (
        ${documents[0].id}::uuid,
        0,
        'El curso de ventas dura ocho semanas.',
        9,
        ${unitVector(EMBEDDING_DIMENSIONS)}::extensions.vector,
        ${EMBEDDING_EPOCH}
      )
    `).resolves.toBeDefined();
  });

  it('searches the knowledge base with a provider-sized query vector', async () => {
    // The search entry point is workspace-scoped; an unknown workspace simply
    // yields no rows, which is enough to prove the vector dimension matches.
    const results = await db!<Array<{ chunk_id: string; similarity: number }>>`
      SELECT chunk_id, similarity
      FROM search_knowledge_base(
        ${randomUUID()}::uuid,
        ${unitVector(EMBEDDING_DIMENSIONS)}::extensions.vector,
        ${EMBEDDING_EPOCH},
        5,
        0.5
      )
    `;
    expect(results).toEqual([]);
  });

  it('searches contact memory with a provider-sized query vector', async () => {
    const results = await db!<Array<{ message_id: string }>>`
      SELECT message_id
      FROM search_contact_memory(
        ${randomUUID()}::uuid,
        ${unitVector(EMBEDDING_DIMENSIONS)}::extensions.vector,
        ${EMBEDDING_EPOCH},
        5
      )
    `;
    expect(results).toEqual([]);
  });
});
