import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EMBEDDING_EPOCH, EmbeddingProviderError } from '@/lib/embeddings/gemini';
import { runMessageEmbeddingWorker } from '@/lib/services/message-embedding-worker.service';
import { runSelectedMemoryEmbeddingWorker } from '@/lib/services/selected-memory-embedding-worker.service';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const embedding = Array.from({ length: 768 }, () => 0.001);

afterAll(async () => db?.end());

async function sourceFixture(content: string) {
  const phone = `+54916${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
  `;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', ${content})
    RETURNING id
  `;
  return { contactId: contacts[0].id, conversationId: conversations[0].id, messageId: messages[0].id };
}

run('epoch-aware durable embedding workers', () => {
  beforeEach(async () => {
    await db!`
      UPDATE embedding_jobs
      SET status = 'skipped', completed_at = now(), lease_until = NULL, leased_by = NULL
      WHERE status IN ('pending', 'leased', 'failed_retryable')
    `;
    await db!`
      UPDATE selected_memories
      SET embedding_state = 'skip', lease_until = NULL, leased_by = NULL
      WHERE embedding_state IN ('pending', 'leased', 'failed_retryable')
    `;
  });

  it('materializes one message once across two workers and a second drain is empty', async () => {
    const fixture = await sourceFixture('Quiero conocer el programa.');
    await db!`
      INSERT INTO message_embeddings (message_id, contact_id, status)
      VALUES (${fixture.messageId}::uuid, ${fixture.contactId}::uuid, 'pending')
    `;
    let embedCalls = 0;
    const embed = async () => {
      embedCalls += 1;
      return embedding;
    };
    const [dbA, dbB] = openIndependentLocalTestDatabases(2);
    try {
      const results = await Promise.all([
        runMessageEmbeddingWorker({ worker_id: 'message-a', limit: 1 }, { sql: dbA, embed }),
        runMessageEmbeddingWorker({ worker_id: 'message-b', limit: 1 }, { sql: dbB, embed }),
      ]);
      expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
      expect(embedCalls).toBe(1);

      const replay = await runMessageEmbeddingWorker({ worker_id: 'message-replay', limit: 1 }, { sql: dbA, embed });
      expect(replay).toMatchObject({ claimed: 0, completed: 0 });
    } finally {
      await Promise.all([dbA.end(), dbB.end()]);
    }

    const rows = await db!<Array<{ status: string; embedding_epoch: string; job_status: string }>>`
      SELECT me.status, me.embedding_epoch, ej.status AS job_status
      FROM message_embeddings me
      JOIN embedding_jobs ej ON ej.message_id = me.message_id
      WHERE me.message_id = ${fixture.messageId}::uuid
    `;
    expect(rows[0]).toEqual({ status: 'indexed', embedding_epoch: EMBEDDING_EPOCH, job_status: 'completed' });
  });

  it('materializes one selected memory once across two workers and a second drain is empty', async () => {
    const fixture = await sourceFixture('Necesito una modalidad flexible.');
    const memories = await db!<Array<{ id: string }>>`
      INSERT INTO selected_memories (
        contact_id, conversation_id, source_message_id, status, memory_type,
        memory_key, value_normalized, source_quote, confidence, dedupe_hash, embedding_state
      ) VALUES (
        ${fixture.contactId}::uuid, ${fixture.conversationId}::uuid, ${fixture.messageId}::uuid,
        'active', 'constraint', ${`schedule_${randomUUID().replaceAll('-', '')}`},
        'Necesito una modalidad flexible.', 'Necesito una modalidad flexible.', 1,
        ${randomUUID().replaceAll('-', '').padEnd(64, '1')}, 'pending'
      ) RETURNING id
    `;
    let embedCalls = 0;
    const embed = async () => {
      embedCalls += 1;
      return embedding;
    };
    const [dbA, dbB] = openIndependentLocalTestDatabases(2);
    try {
      const results = await Promise.all([
        runSelectedMemoryEmbeddingWorker({ worker_id: 'memory-a', limit: 1 }, { sql: dbA, embed }),
        runSelectedMemoryEmbeddingWorker({ worker_id: 'memory-b', limit: 1 }, { sql: dbB, embed }),
      ]);
      expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
      expect(embedCalls).toBe(1);

      const replay = await runSelectedMemoryEmbeddingWorker({ worker_id: 'memory-replay', limit: 1 }, { sql: dbA, embed });
      expect(replay).toMatchObject({ claimed: 0, completed: 0 });
    } finally {
      await Promise.all([dbA.end(), dbB.end()]);
    }

    const rows = await db!<Array<{ embedding_state: string; embedding_epoch: string; leased_by: string | null }>>`
      SELECT embedding_state, embedding_epoch, leased_by
      FROM selected_memories WHERE id = ${memories[0].id}::uuid
    `;
    expect(rows[0]).toEqual({ embedding_state: 'ready', embedding_epoch: EMBEDDING_EPOCH, leased_by: null });
  });

  it('dead-letters terminal selected-memory configuration errors on the first attempt', async () => {
    const fixture = await sourceFixture('Prefiero clases por la noche.');
    const memories = await db!<Array<{ id: string }>>`
      INSERT INTO selected_memories (
        contact_id, conversation_id, source_message_id, status, memory_type,
        memory_key, value_normalized, source_quote, confidence, dedupe_hash, embedding_state
      ) VALUES (
        ${fixture.contactId}::uuid, ${fixture.conversationId}::uuid, ${fixture.messageId}::uuid,
        'active', 'preference', ${`time_${randomUUID().replaceAll('-', '')}`},
        'Prefiero clases por la noche.', 'Prefiero clases por la noche.', 1,
        ${randomUUID().replaceAll('-', '').padEnd(64, '2')}, 'pending'
      ) RETURNING id
    `;
    const fail = async (): Promise<number[]> => {
      throw new EmbeddingProviderError('GEMINI_EMBED_API_KEY_MISSING', 'terminal_configuration');
    };

    const result = await runSelectedMemoryEmbeddingWorker(
      { worker_id: 'memory-terminal', limit: 1 },
      { sql: db!, embed: fail },
    );
    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1 });

    const rows = await db!<Array<{ embedding_state: string; embedding_attempts: number }>>`
      SELECT embedding_state, embedding_attempts FROM selected_memories WHERE id = ${memories[0].id}::uuid
    `;
    expect(rows[0]).toEqual({ embedding_state: 'dead_letter', embedding_attempts: 1 });
  });

  it('does not materialize after a selected-memory lease is reclaimed by another worker', async () => {
    const fixture = await sourceFixture('Necesito cursar los sábados.');
    const memories = await db!<Array<{ id: string }>>`
      INSERT INTO selected_memories (
        contact_id, conversation_id, source_message_id, status, memory_type,
        memory_key, value_normalized, source_quote, confidence, dedupe_hash, embedding_state
      ) VALUES (
        ${fixture.contactId}::uuid, ${fixture.conversationId}::uuid, ${fixture.messageId}::uuid,
        'active', 'constraint', ${`weekend_${randomUUID().replaceAll('-', '')}`},
        'Necesito cursar los sábados.', 'Necesito cursar los sábados.', 1,
        ${randomUUID().replaceAll('-', '').padEnd(64, '3')}, 'pending'
      ) RETURNING id
    `;

    let releaseEmbedding!: () => void;
    let embeddingStarted!: () => void;
    const started = new Promise<void>((resolve) => { embeddingStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseEmbedding = resolve; });
    const oldWorker = runSelectedMemoryEmbeddingWorker(
      { worker_id: 'old-owner', limit: 1 },
      {
        sql: db!,
        embed: async () => {
          embeddingStarted();
          await release;
          return embedding;
        },
      },
    );
    await started;
    await db!`
      UPDATE selected_memories SET lease_until = now() - interval '1 second'
      WHERE id = ${memories[0].id}::uuid
    `;
    const reclaimed = await db!<Array<{ memory_id: string }>>`
      SELECT memory_id FROM claim_memory_embeddings('new-owner', 1, 60)
    `;
    expect(reclaimed.map((row) => row.memory_id)).toContain(memories[0].id);
    releaseEmbedding();

    expect(await oldWorker).toMatchObject({ completed: 0, lease_lost: 1 });
    const rows = await db!<Array<{
      embedding_state: string;
      leased_by: string;
      embedding: string | null;
    }>>`
      SELECT embedding_state, leased_by, embedding::text AS embedding
      FROM selected_memories WHERE id = ${memories[0].id}::uuid
    `;
    expect(rows[0]).toEqual({ embedding_state: 'leased', leased_by: 'new-owner', embedding: null });
  });

  it('aborts an in-flight provider at the hard wall and does not continue to completion SQL', async () => {
    const fixture = await sourceFixture('Necesito una respuesta rápida.');
    const memories = await db!<Array<{ id: string }>>`
      INSERT INTO selected_memories (
        contact_id, conversation_id, source_message_id, status, memory_type,
        memory_key, value_normalized, source_quote, confidence, dedupe_hash, embedding_state
      ) VALUES (
        ${fixture.contactId}::uuid, ${fixture.conversationId}::uuid, ${fixture.messageId}::uuid,
        'active', 'constraint', ${`deadline_${randomUUID().replaceAll('-', '')}`},
        'Necesito una respuesta rápida.', 'Necesito una respuesta rápida.', 1,
        ${randomUUID().replaceAll('-', '').padEnd(64, '4')}, 'pending'
      ) RETURNING id
    `;
    let providerCalled = false;
    let providerAborted = false;
    const slowEmbed = async (
      _input: { title: string; text: string; kind: string },
      options?: { signal?: AbortSignal },
    ): Promise<number[]> => {
      providerCalled = true;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(embedding), 2_000);
        options?.signal?.addEventListener('abort', () => {
          providerAborted = true;
          clearTimeout(timer);
          reject(new Error('ABORTED_BY_WORKER_DEADLINE'));
        }, { once: true });
      });
    };

    const startedAt = Date.now();
    const result = await runSelectedMemoryEmbeddingWorker(
      { worker_id: 'hard-wall', limit: 1, deadline_ms: 100 },
      { sql: db!, embed: slowEmbed },
    );

    expect(providerCalled).toBe(true);
    expect(providerAborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result).toMatchObject({ completed: 0, deadline_reached: true });
    const rows = await db!<Array<{ embedding: string | null }>>`
      SELECT embedding::text AS embedding FROM selected_memories WHERE id = ${memories[0].id}::uuid
    `;
    expect(rows[0].embedding).toBeNull();
  });
});
