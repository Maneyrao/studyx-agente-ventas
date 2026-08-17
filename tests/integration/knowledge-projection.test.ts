import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { knowledgeSourceUri, projectKnowledgeSources } from '@/lib/services/knowledge-projection.service';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const fakeEmbed = async () => Array.from({ length: 768 }, () => 0.001);

async function workspaceFixture() {
  const slug = `test-projection-${randomUUID()}`;
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name) VALUES (${slug}, 'Proyección Test') RETURNING id
  `;
  return rows[0].id;
}

async function addSource(workspaceId: string, title: string, content: string, status = 'active', version = 1) {
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO knowledge_sources (workspace_id, source_type, title, content, status, version)
    VALUES (${workspaceId}::uuid, 'faq', ${title}, ${content}, ${status}, ${version})
    RETURNING id
  `;
  return rows[0].id;
}

run('projectKnowledgeSources', () => {
  it('projects active sources under a stable workspace/source/version URI', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Horarios', 'Martes y jueves 21hs.');
    await addSource(workspaceId, 'Archivada', 'No debería proyectarse.', 'archived');

    const result = await projectKnowledgeSources({ workspace_id: workspaceId }, { sql: db!, embed: fakeEmbed });
    expect(result).toEqual({ projected: 1, skipped: 0 });

    const docs = await db!<Array<{ uri: string; version: number; title: string }>>`
      SELECT uri, version, title FROM knowledge_documents
      WHERE uri = ${knowledgeSourceUri(workspaceId, sourceId)}
    `;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ version: 1, title: 'Horarios' });

    const chunks = await db!<Array<{ content: string }>>`
      SELECT c.content FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE d.uri = ${knowledgeSourceUri(workspaceId, sourceId)}
    `;
    expect(chunks).toEqual([{ content: 'Martes y jueves 21hs.' }]);
  });

  it('is idempotent per (uri, version) and picks up new source versions', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Precios', 'Precio original.');

    await projectKnowledgeSources({ workspace_id: workspaceId }, { sql: db!, embed: fakeEmbed });
    const rerun = await projectKnowledgeSources({ workspace_id: workspaceId }, { sql: db!, embed: fakeEmbed });
    expect(rerun).toEqual({ projected: 0, skipped: 1 });

    await db!`
      UPDATE knowledge_sources SET content = 'Precio actualizado.', version = 2
      WHERE id = ${sourceId}::uuid
    `;
    const afterBump = await projectKnowledgeSources({ workspace_id: workspaceId }, { sql: db!, embed: fakeEmbed });
    expect(afterBump).toEqual({ projected: 1, skipped: 0 });

    const versions = await db!<Array<{ version: number }>>`
      SELECT version FROM knowledge_documents
      WHERE uri = ${knowledgeSourceUri(workspaceId, sourceId)}
      ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  it('does not project sources from another workspace', async () => {
    const workspaceId = await workspaceFixture();
    const otherWorkspaceId = await workspaceFixture();
    await addSource(otherWorkspaceId, 'Ajena', 'Contenido de otro workspace.');

    const result = await projectKnowledgeSources({ workspace_id: workspaceId }, { sql: db!, embed: fakeEmbed });
    expect(result).toEqual({ projected: 0, skipped: 0 });
  });
});
