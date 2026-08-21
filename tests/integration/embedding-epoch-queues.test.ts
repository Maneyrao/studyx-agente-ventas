import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => db?.end());

function vector(axis = 0): string {
  return `[${Array.from({ length: 768 }, (_, index) => index === axis ? 1 : 0).join(',')}]`;
}

async function selectedMemoryFixture(value: string) {
  const phone = `+54915${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
  `;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', ${value})
    RETURNING id
  `;
  const memories = await db!<Array<{ id: string }>>`
    INSERT INTO selected_memories (
      contact_id, conversation_id, source_message_id, status, memory_type,
      memory_key, value_normalized, source_quote, confidence, dedupe_hash,
      embedding_state
    ) VALUES (
      ${contacts[0].id}::uuid, ${conversations[0].id}::uuid, ${messages[0].id}::uuid,
      'active', 'study_goal', ${`goal_${randomUUID().replaceAll('-', '')}`}, ${value}, ${value},
      1, ${randomUUID().replaceAll('-', '').padEnd(64, '0')}, 'pending'
    ) RETURNING id
  `;
  return {
    contactId: contacts[0].id,
    conversationId: conversations[0].id,
    messageId: messages[0].id,
    memoryId: memories[0].id,
  };
}

run('embedding epochs and durable selected-memory leases', () => {
  it('adds nullable epoch metadata and epoch-aware search overloads without removing legacy signatures', async () => {
    const columns = await db!<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'embedding_epoch'
        AND table_name IN ('message_embeddings', 'selected_memories', 'knowledge_chunks')
      ORDER BY table_name
    `;
    expect(columns).toEqual([
      { table_name: 'knowledge_chunks', is_nullable: 'YES' },
      { table_name: 'message_embeddings', is_nullable: 'YES' },
      { table_name: 'selected_memories', is_nullable: 'YES' },
    ]);

    const functions = await db!<Array<{ function_name: string; arguments: string }>>`
      SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('search_contact_memory', 'search_selected_memories', 'search_knowledge_base')
      ORDER BY p.proname, arguments
    `;
    expect(functions.filter((fn) => fn.arguments.includes('p_embedding_epoch text'))).toHaveLength(3);
    expect(functions.filter((fn) => !fn.arguments.includes('p_embedding_epoch text'))).toHaveLength(3);
  });

  it('requires an epoch whenever a new vector becomes indexed or ready', async () => {
    const fixture = await selectedMemoryFixture('Quiero estudiar marketing.');
    await expect(db!`
      UPDATE selected_memories
      SET embedding = ${vector()}::extensions.vector, embedding_state = 'ready'
      WHERE id = ${fixture.memoryId}::uuid
    `).rejects.toMatchObject({ code: '23514' });

    await expect(db!`
      UPDATE selected_memories
      SET embedding = ${vector()}::extensions.vector,
          embedding_state = 'ready',
          embedding_epoch = 'legacy-provider:768'
      WHERE id = ${fixture.memoryId}::uuid
    `).rejects.toMatchObject({ code: '23514' });

    await expect(db!`
      UPDATE selected_memories
      SET embedding = ${vector()}::extensions.vector,
          embedding_state = 'ready',
          embedding_epoch = ${EMBEDDING_EPOCH}
      WHERE id = ${fixture.memoryId}::uuid
    `).resolves.toBeDefined();

    await expect(db!`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (
        ${fixture.messageId}::uuid, ${fixture.contactId}::uuid,
        ${vector()}::extensions.vector, 'indexed'
      )
    `).rejects.toMatchObject({ code: '23514' });

    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${`epoch-required-${randomUUID()}`}, 'Epoch Required') RETURNING id
    `;
    const docs = await db!<Array<{ id: string }>>`
      INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
      VALUES (${`epoch-required/${randomUUID()}`}, 'Epoch', 'manual', 1, ${workspaces[0].id}::uuid)
      RETURNING id
    `;
    await expect(db!`
      INSERT INTO knowledge_chunks (document_id, chunk_index, content, token_count, embedding)
      VALUES (${docs[0].id}::uuid, 0, 'sin epoch', 2, ${vector()}::extensions.vector)
    `).rejects.toMatchObject({ code: '23514' });
  });

  it('uses transition triggers, not NOT VALID checks that break unrelated legacy updates', async () => {
    const epochChecks = await db!<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'message_embeddings_indexed_epoch_check',
        'selected_memories_ready_epoch_check',
        'knowledge_chunks_epoch_check'
      )
    `;
    expect(epochChecks).toEqual([]);

    const fixture = await selectedMemoryFixture('Memoria de proveedor anterior.');
    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${`legacy-update-${randomUUID()}`}, 'Legacy Update') RETURNING id
    `;
    const docs = await db!<Array<{ id: string }>>`
      INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
      VALUES (${`legacy-update/${randomUUID()}`}, 'Legacy', 'manual', 1, ${workspaces[0].id}::uuid)
      RETURNING id
    `;

    await db!.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        UPDATE selected_memories
        SET embedding = ${vector()}::extensions.vector, embedding_state = 'ready', embedding_epoch = NULL
        WHERE id = ${fixture.memoryId}::uuid
      `;
      await tx`
        INSERT INTO message_embeddings (message_id, contact_id, embedding, embedding_epoch, status)
        VALUES (
          ${fixture.messageId}::uuid, ${fixture.contactId}::uuid,
          ${vector()}::extensions.vector, NULL, 'indexed'
        )
      `;
      await tx`
        INSERT INTO knowledge_chunks (
          document_id, chunk_index, content, token_count, embedding, embedding_epoch
        ) VALUES (${docs[0].id}::uuid, 0, 'legacy', 1, ${vector()}::extensions.vector, NULL)
      `;
      await tx`SET LOCAL session_replication_role = origin`;

      await tx`
        UPDATE selected_memories SET confidence = 0.8 WHERE id = ${fixture.memoryId}::uuid
      `;
      await tx`
        UPDATE message_embeddings SET created_at = created_at WHERE message_id = ${fixture.messageId}::uuid
      `;
      await tx`
        UPDATE knowledge_chunks SET content = 'legacy actualizado' WHERE document_id = ${docs[0].id}::uuid
      `;
    });
  });

  it('provides current-epoch partial HNSW paths for every active vector search', async () => {
    const indexes = await db!<Array<{ tablename: string; indexname: string; indexdef: string }>>`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'message_embeddings_current_epoch_hnsw_idx',
          'selected_memories_current_epoch_hnsw_idx',
          'knowledge_chunks_current_epoch_hnsw_idx'
        )
      ORDER BY indexname
    `;
    expect(indexes).toHaveLength(3);
    for (const index of indexes) {
      expect(index.indexdef).toContain('USING hnsw');
      expect(index.indexdef).toContain(EMBEDDING_EPOCH);
    }
    expect(indexes.find((index) => index.tablename === 'message_embeddings')?.indexdef)
      .toContain("status = 'indexed'::text");
    expect(indexes.find((index) => index.tablename === 'selected_memories')?.indexdef)
      .toContain("embedding_state = 'ready'::text");
  });

  it('terminalizes pending selected memories already at or beyond their max attempts', async () => {
    await db!`
      UPDATE selected_memories
      SET embedding_state = 'skip', lease_until = NULL, leased_by = NULL
      WHERE embedding_state IN ('pending', 'leased', 'failed_retryable')
    `;
    const atMax = await selectedMemoryFixture('Intentos agotados cinco.');
    const beyondFive = await selectedMemoryFixture('Intentos legacy siete.');
    await db!`
      UPDATE selected_memories
      SET embedding_attempts = 5, embedding_max_attempts = 5
      WHERE id = ${atMax.memoryId}::uuid
    `;
    await db!`
      UPDATE selected_memories
      SET embedding_attempts = 7, embedding_max_attempts = 7
      WHERE id = ${beyondFive.memoryId}::uuid
    `;

    const claimed = await db!`
      SELECT memory_id FROM claim_memory_embeddings('attempt-normalizer', 20, 60)
    `;
    expect(claimed).toEqual([]);
    const states = await db!<Array<{ id: string; embedding_state: string; embedding_max_attempts: number }>>`
      SELECT id, embedding_state, embedding_max_attempts
      FROM selected_memories
      WHERE id IN (${atMax.memoryId}::uuid, ${beyondFive.memoryId}::uuid)
      ORDER BY embedding_attempts
    `;
    expect(states).toEqual([
      { id: atMax.memoryId, embedding_state: 'dead_letter', embedding_max_attempts: 5 },
      { id: beyondFive.memoryId, embedding_state: 'dead_letter', embedding_max_attempts: 7 },
    ]);
  });

  it('leases one selected memory to only one of two concurrent workers', async () => {
    await db!`
      UPDATE selected_memories
      SET embedding_state = 'skip', lease_until = NULL, leased_by = NULL
      WHERE embedding_state IN ('pending', 'leased', 'failed_retryable')
    `;
    const fixture = await selectedMemoryFixture('Busco una carrera corta.');
    const clients = openIndependentLocalTestDatabases(2);
    try {
      const claims = (await Promise.all(clients.map((client, index) => client<Array<{
        memory_id: string;
        leased_by: string;
      }>>`
        SELECT memory_id, leased_by
        FROM claim_memory_embeddings(${`memory-worker-${index}`}, 1, 60)
        WHERE memory_id = ${fixture.memoryId}::uuid
      `))).flat();
      expect(claims).toHaveLength(1);
      expect(claims[0].memory_id).toBe(fixture.memoryId);

      const state = await db!<Array<{ embedding_state: string; leased_by: string | null }>>`
        SELECT embedding_state, leased_by FROM selected_memories WHERE id = ${fixture.memoryId}::uuid
      `;
      expect(state[0]).toEqual({ embedding_state: 'leased', leased_by: claims[0].leased_by });
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('excludes vectors from another epoch in all three epoch-aware searches', async () => {
    const fixture = await selectedMemoryFixture('Quiero estudiar diseño.');
    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${`epoch-${randomUUID()}`}, 'Epoch Test') RETURNING id
    `;
    const docs = await db!<Array<{ id: string }>>`
      INSERT INTO knowledge_documents (uri, title, source_type, version, workspace_id)
      VALUES (${`epoch/${randomUUID()}`}, 'Legacy', 'manual', 1, ${workspaces[0].id}::uuid)
      RETURNING id
    `;
    // These rows model materializations which predate the transition trigger.
    // New writes with this epoch are rejected by the invariant test above.
    await db!.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        UPDATE selected_memories
        SET embedding = ${vector(0)}::extensions.vector,
            embedding_epoch = 'legacy-provider:768', embedding_state = 'ready'
        WHERE id = ${fixture.memoryId}::uuid
      `;
      await tx`
        INSERT INTO message_embeddings (message_id, contact_id, embedding, embedding_epoch, status)
        VALUES (
          ${fixture.messageId}::uuid, ${fixture.contactId}::uuid,
          ${vector(0)}::extensions.vector, 'legacy-provider:768', 'indexed'
        )
      `;
      await tx`
        INSERT INTO knowledge_chunks (
          document_id, chunk_index, content, token_count, embedding, embedding_epoch
        ) VALUES (
          ${docs[0].id}::uuid, 0, 'vector viejo', 3,
          ${vector(0)}::extensions.vector, 'legacy-provider:768'
        )
      `;
    });

    const selected = await db!`
      SELECT memory_id FROM search_selected_memories(
        ${fixture.contactId}::uuid, ${vector(0)}::extensions.vector, ${EMBEDDING_EPOCH}, 5, 0.5
      )
    `;
    const messages = await db!`
      SELECT message_id FROM search_contact_memory(
        ${fixture.contactId}::uuid, ${vector(0)}::extensions.vector, ${EMBEDDING_EPOCH}, 5
      )
    `;
    const knowledge = await db!`
      SELECT chunk_id FROM search_knowledge_base(
        ${workspaces[0].id}::uuid, ${vector(0)}::extensions.vector, ${EMBEDDING_EPOCH}, 5, 0.5
      )
    `;
    expect(selected).toEqual([]);
    expect(messages).toEqual([]);
    expect(knowledge).toEqual([]);
  });
});
