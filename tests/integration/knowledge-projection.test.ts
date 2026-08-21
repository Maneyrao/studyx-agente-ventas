import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  knowledgeSourceUri,
  runKnowledgeProjectionWorker,
  type ProjectionWorkerResult,
} from '@/lib/services/knowledge-projection.service';
import { EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const fakeEmbed = async () => Array.from({ length: 768 }, () => 0.001);

/** Runs the worker until the queue has no claimable jobs left. */
async function drain(
  workerId: string,
  deps: { sql: NonNullable<typeof db>; embed: (text: string) => Promise<number[]> }
): Promise<ProjectionWorkerResult> {
  const total: ProjectionWorkerResult = { claimed: 0, completed: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < 50; i++) {
    const result = await runKnowledgeProjectionWorker({ worker_id: workerId, limit: 20 }, deps);
    total.claimed += result.claimed;
    total.completed += result.completed;
    total.failed += result.failed;
    total.skipped += result.skipped;
    if (result.claimed === 0) return total;
  }
  return total;
}

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

async function jobsFor(sourceId: string) {
  return db!<Array<{
    id: string;
    workspace_id: string;
    source_version: number;
    status: string;
    attempt_count: number;
    max_attempts: number;
    available_at: Date;
  }>>`
    SELECT id, workspace_id, source_version, status, attempt_count, max_attempts, available_at
    FROM knowledge_projection_jobs
    WHERE source_id = ${sourceId}::uuid
    ORDER BY source_version
  `;
}

async function docsFor(uri: string) {
  return db!<Array<{ id: string; workspace_id: string | null; version: number; archived_at: Date | null }>>`
    SELECT id, workspace_id, version, archived_at
    FROM knowledge_documents WHERE uri = ${uri} ORDER BY version
  `;
}

async function chunksFor(uri: string) {
  return db!<Array<{ content: string; version: number; embedding_epoch: string | null }>>`
    SELECT c.content, d.version, c.embedding_epoch FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE d.uri = ${uri} ORDER BY d.version, c.chunk_index
  `;
}

async function forceJobsAvailable(sourceId: string) {
  await db!`
    UPDATE knowledge_projection_jobs
    SET available_at = now() - interval '1 second'
    WHERE source_id = ${sourceId}::uuid AND status IN ('pending', 'failed_retryable')
  `;
}

run('knowledge projection jobs', () => {
  beforeAll(async () => {
    // The jobs migration backfills every pre-existing active source; drain
    // that backlog so each test observes only its own fixtures.
    await drain('backlog-drain', { sql: db!, embed: fakeEmbed });
  });

  it('enqueues a durable pending job when an active source is inserted', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Horarios', 'Martes y jueves 21hs.');

    const jobs = await jobsFor(sourceId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      workspace_id: workspaceId,
      source_version: 1,
      status: 'pending',
      attempt_count: 0,
    });
  });

  it('projects an enqueued source into a workspace-scoped document and chunk', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Horarios', 'Martes y jueves 21hs.');

    const result = await drain('test-worker', { sql: db!, embed: fakeEmbed });
    expect(result.completed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const uri = knowledgeSourceUri(workspaceId, sourceId);
    const docs = await docsFor(uri);
    expect(docs).toHaveLength(1);
    expect(docs[0].workspace_id).toBe(workspaceId);
    expect(docs[0].archived_at).toBeNull();

    const chunks = await chunksFor(uri);
    expect(chunks).toEqual([{
      content: 'Martes y jueves 21hs.',
      version: 1,
      embedding_epoch: EMBEDDING_EPOCH,
    }]);

    const jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('completed');
  });

  it('projects a new version and archives the previous document version', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Precios', 'Precio original.');
    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });

    await db!`
      UPDATE knowledge_sources SET content = 'Precio actualizado.', version = 2
      WHERE id = ${sourceId}::uuid
    `;
    const jobs = await jobsFor(sourceId);
    expect(jobs.map((j) => [j.source_version, j.status])).toEqual([
      [1, 'completed'],
      [2, 'pending'],
    ]);

    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });

    const uri = knowledgeSourceUri(workspaceId, sourceId);
    const docs = await docsFor(uri);
    expect(docs).toHaveLength(2);
    expect(docs[0].version).toBe(1);
    expect(docs[0].archived_at).not.toBeNull();
    expect(docs[1].version).toBe(2);
    expect(docs[1].archived_at).toBeNull();
  });

  it('re-projects a content edit that does not bump the version', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'FAQ', 'Respuesta vieja.');
    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });

    await db!`
      UPDATE knowledge_sources SET content = 'Respuesta corregida.'
      WHERE id = ${sourceId}::uuid
    `;
    const jobs = await jobsFor(sourceId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');

    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });
    const chunks = await chunksFor(knowledgeSourceUri(workspaceId, sourceId));
    expect(chunks).toEqual([{
      content: 'Respuesta corregida.',
      version: 1,
      embedding_epoch: EMBEDDING_EPOCH,
    }]);
  });

  it('replaying the worker 10 times never duplicates documents or chunks', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Replay', 'Contenido estable.');

    for (let i = 0; i < 10; i++) {
      await runKnowledgeProjectionWorker({ worker_id: `replay-${i}` }, { sql: db!, embed: fakeEmbed });
    }

    const uri = knowledgeSourceUri(workspaceId, sourceId);
    expect(await docsFor(uri)).toHaveLength(1);
    expect(await chunksFor(uri)).toHaveLength(1);
  });

  it('two concurrent workers claim disjoint jobs and never duplicate output', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Concurrencia', 'Sólo una vez.');

    const dbA = openLocalTestDatabase();
    const dbB = openLocalTestDatabase();
    try {
      await Promise.all([
        runKnowledgeProjectionWorker({ worker_id: 'worker-a' }, { sql: dbA, embed: fakeEmbed }),
        runKnowledgeProjectionWorker({ worker_id: 'worker-b' }, { sql: dbB, embed: fakeEmbed }),
      ]);
    } finally {
      await dbA.end();
      await dbB.end();
    }

    const uri = knowledgeSourceUri(workspaceId, sourceId);
    expect(await docsFor(uri)).toHaveLength(1);
    expect(await chunksFor(uri)).toHaveLength(1);
    const jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('completed');
  });

  it('does not publish a source archived while Gemini is in flight', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Carrera archive', 'No debe publicarse.');
    let releaseEmbedding!: () => void;
    let embeddingStarted!: () => void;
    const started = new Promise<void>((resolve) => { embeddingStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseEmbedding = resolve; });
    const inFlight = runKnowledgeProjectionWorker(
      { worker_id: 'archive-race', limit: 1 },
      {
        sql: db!,
        embed: async () => {
          embeddingStarted();
          await release;
          return fakeEmbed();
        },
      },
    );
    await started;
    await db!`UPDATE knowledge_sources SET status = 'archived' WHERE id = ${sourceId}::uuid`;
    releaseEmbedding();

    const result = await inFlight;
    expect(result).toMatchObject({ completed: 0, skipped: 1 });
    expect(await docsFor(knowledgeSourceUri(workspaceId, sourceId))).toHaveLength(0);
    expect(await chunksFor(knowledgeSourceUri(workspaceId, sourceId))).toHaveLength(0);
    expect((await jobsFor(sourceId))[0].status).toBe('skipped');
  });

  it('projects and searches successfully under the real orchestrator role', async () => {
    const workspaceId = await workspaceFixture();
    await addSource(workspaceId, 'Rol mínimo', 'Visible con privilegios mínimos.');
    const roleDb = openLocalTestDatabase();
    try {
      await roleDb`SET ROLE orchestrator_role`;
      const result = await runKnowledgeProjectionWorker(
        { worker_id: 'role-worker', limit: 1 },
        { sql: roleDb, embed: fakeEmbed },
      );
      expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
      const rows = await roleDb<Array<{ content: string }>>`
        SELECT content FROM search_knowledge_base(
          ${workspaceId}::uuid,
          ${JSON.stringify(await fakeEmbed())}::extensions.vector,
          ${EMBEDDING_EPOCH},
          5,
          0.5
        )
      `;
      expect(rows.map((row) => row.content)).toContain('Visible con privilegios mínimos.');
      await expect(roleDb`DELETE FROM knowledge_chunks`).rejects.toMatchObject({ code: '42501' });
    } finally {
      await roleDb.end();
    }
  });

  it('projects each workspace only from its own sources', async () => {
    const workspaceA = await workspaceFixture();
    const workspaceB = await workspaceFixture();
    const sourceA = await addSource(workspaceA, 'Propio A', 'Contenido A.');
    const sourceB = await addSource(workspaceB, 'Propio B', 'Contenido B.');

    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });

    const docsA = await docsFor(knowledgeSourceUri(workspaceA, sourceA));
    const docsB = await docsFor(knowledgeSourceUri(workspaceB, sourceB));
    expect(docsA[0].workspace_id).toBe(workspaceA);
    expect(docsB[0].workspace_id).toBe(workspaceB);
  });

  it('marks the job retryable with backoff on embedding failure and dead-letters at max attempts', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Fallo', 'Nunca se proyecta.');
    const failingEmbed = async () => {
      throw new Error('embedding provider down');
    };

    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: failingEmbed });
    let jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('failed_retryable');
    expect(jobs[0].attempt_count).toBe(1);
    expect(jobs[0].available_at.getTime()).toBeGreaterThan(Date.now());

    for (let i = 0; i < jobs[0].max_attempts; i++) {
      await forceJobsAvailable(sourceId);
      await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: failingEmbed });
    }

    jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('dead_letter');
    expect(jobs[0].attempt_count).toBe(jobs[0].max_attempts);
    expect(await docsFor(knowledgeSourceUri(workspaceId, sourceId))).toHaveLength(0);
  });

  it('completes a job whose previous worker died after embedding, once the lease expires', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Lease', 'Sobrevive al crash.');

    // A worker claims the job (post-embedding crash: leased, nothing written), then dies.
    const claimed = await db!<Array<{ id: string }>>`
      SELECT id FROM claim_knowledge_projection_jobs('dead-worker', 10, 60)
    `;
    expect(claimed).toHaveLength(1);
    await db!`
      UPDATE knowledge_projection_jobs
      SET lease_until = now() - interval '1 minute'
      WHERE id = ${claimed[0].id}::uuid
    `;

    await runKnowledgeProjectionWorker({ worker_id: 'recovery' }, { sql: db!, embed: fakeEmbed });

    const uri = knowledgeSourceUri(workspaceId, sourceId);
    expect(await docsFor(uri)).toHaveLength(1);
    expect(await chunksFor(uri)).toHaveLength(1);
    const jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('completed');
  });

  it('repairs a document that exists without its chunk instead of skipping it', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Huérfano', 'Contenido reparado.');
    const uri = knowledgeSourceUri(workspaceId, sourceId);

    // Legacy incomplete state: document written, chunk never landed.
    await db!`
      INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
      VALUES (${uri}, 'Huérfano', 'manual', 1, ${workspaceId}::uuid)
    `;
    expect(await chunksFor(uri)).toHaveLength(0);

    await runKnowledgeProjectionWorker({ worker_id: 'repair' }, { sql: db!, embed: fakeEmbed });

    expect(await docsFor(uri)).toHaveLength(1);
    expect(await chunksFor(uri)).toEqual([{
      content: 'Contenido reparado.',
      version: 1,
      embedding_epoch: EMBEDDING_EPOCH,
    }]);
    const jobs = await jobsFor(sourceId);
    expect(jobs[0].status).toBe('completed');
  });

  it('archiving a source removes its documents from search visibility', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Archivable', 'Se va a archivar.');
    await runKnowledgeProjectionWorker({ worker_id: 'w1' }, { sql: db!, embed: fakeEmbed });

    await db!`
      UPDATE knowledge_sources SET status = 'archived' WHERE id = ${sourceId}::uuid
    `;

    const docs = await docsFor(knowledgeSourceUri(workspaceId, sourceId));
    expect(docs).toHaveLength(1);
    expect(docs[0].archived_at).not.toBeNull();
  });

  it('does not enqueue jobs for draft sources', async () => {
    const workspaceId = await workspaceFixture();
    const sourceId = await addSource(workspaceId, 'Borrador', 'Todavía no.', 'draft');
    expect(await jobsFor(sourceId)).toHaveLength(0);
  });
});
