import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

/**
 * Tenant isolation of the vector search itself, exercised directly against
 * the SQL function with crafted embeddings so similarity is deterministic:
 * basis vector e_i vs e_j has cosine similarity 1 when i = j and 0 otherwise.
 */
function basisVector(index: number): string {
  return JSON.stringify(Array.from({ length: 768 }, (_, k) => (k === index ? 1 : 0)));
}

async function workspaceFixture() {
  const slug = `test-isolation-${randomUUID()}`;
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name) VALUES (${slug}, 'Aislamiento Test') RETURNING id
  `;
  return rows[0].id;
}

async function addDocumentWithChunk(input: {
  workspaceId: string | null;
  title: string;
  content: string;
  embedding: string;
  archivedAt?: 'now' | null;
}) {
  const uri = `test/isolation/${randomUUID()}`;
  const docs = await db!<Array<{ id: string }>>`
    INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id, archived_at)
    VALUES (
      ${uri}, ${input.title}, 'manual', 1,
      ${input.workspaceId}::uuid,
      ${input.archivedAt === 'now' ? db!`now()` : null}
    )
    RETURNING id
  `;
  await db!`
    INSERT INTO knowledge_chunks (
      document_id, chunk_index, content, token_count, embedding, embedding_epoch
    )
    VALUES (
      ${docs[0].id}::uuid, 0, ${input.content}, 10,
      ${input.embedding}::extensions.vector, ${EMBEDDING_EPOCH}
    )
  `;
  return uri;
}

async function searchWorkspace(workspaceId: string | null, queryEmbedding: string) {
  return db!<Array<{ content: string; similarity: number }>>`
    SELECT content, similarity
    FROM search_knowledge_base(
      ${workspaceId}::uuid,
      ${queryEmbedding}::extensions.vector,
      ${EMBEDDING_EPOCH},
      5,
      0.0
    )
  `;
}

run('search_knowledge_base tenant isolation', () => {
  it('returns only chunks from the requested workspace even when a foreign chunk is semantically closer', async () => {
    const workspaceA = await workspaceFixture();
    const workspaceB = await workspaceFixture();

    // Foreign chunk is an exact match for the query (similarity 1.0); the own
    // chunk is orthogonal (similarity 0.0). Isolation must beat similarity.
    await addDocumentWithChunk({
      workspaceId: workspaceA,
      title: 'Propio',
      content: 'Contenido propio lejano.',
      embedding: basisVector(1),
    });
    await addDocumentWithChunk({
      workspaceId: workspaceB,
      title: 'Ajeno',
      content: 'Contenido ajeno idéntico a la consulta.',
      embedding: basisVector(0),
    });

    const results = await searchWorkspace(workspaceA, basisVector(0));
    expect(results.map((r) => r.content)).toEqual(['Contenido propio lejano.']);
  });

  it('never returns legacy documents that have no workspace', async () => {
    const workspaceA = await workspaceFixture();
    await addDocumentWithChunk({
      workspaceId: null,
      title: 'Legacy',
      content: 'Documento legacy global.',
      embedding: basisVector(2),
    });

    const results = await searchWorkspace(workspaceA, basisVector(2));
    expect(results).toEqual([]);
  });

  it('fails closed: a NULL workspace returns nothing', async () => {
    await addDocumentWithChunk({
      workspaceId: null,
      title: 'Legacy',
      content: 'Documento legacy global.',
      embedding: basisVector(3),
    });

    const results = await searchWorkspace(null, basisVector(3));
    expect(results).toEqual([]);
  });

  it('excludes archived documents from results', async () => {
    const workspaceA = await workspaceFixture();
    await addDocumentWithChunk({
      workspaceId: workspaceA,
      title: 'Archivado',
      content: 'Contenido archivado.',
      embedding: basisVector(4),
      archivedAt: 'now',
    });

    const results = await searchWorkspace(workspaceA, basisVector(4));
    expect(results).toEqual([]);
  });

  it('filters by workspace before applying the limit, not after', async () => {
    const workspaceA = await workspaceFixture();
    const workspaceB = await workspaceFixture();

    // Six foreign chunks that all match the query perfectly. With a global
    // top-K (limit 5) they would monopolize the candidate set and a
    // post-filter would return nothing for workspace A.
    for (let i = 0; i < 6; i++) {
      await addDocumentWithChunk({
        workspaceId: workspaceB,
        title: `Ajeno ${i}`,
        content: `Ajeno ${i}`,
        embedding: basisVector(5),
      });
    }
    await addDocumentWithChunk({
      workspaceId: workspaceA,
      title: 'Propio',
      content: 'Propio distante.',
      embedding: basisVector(6),
    });

    const results = await searchWorkspace(workspaceA, basisVector(5));
    expect(results.map((r) => r.content)).toEqual(['Propio distante.']);
  });
});
