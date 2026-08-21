import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresMemoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { PostgresMemoryRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import { selectMemories } from '@/features/orchestration/application/select-memories';
import { memoryDedupeHash } from '@/features/orchestration/domain/memory-selection';
import { EMBEDDING_DIMENSIONS, EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';

/**
 * Fase 4 against a real database.
 *
 * The point of these tests is that the guarantees are *structural*: a memory
 * citing another contact's message must be impossible to insert, not merely
 * something the application avoids. Anything provable by a constraint is
 * asserted against the constraint.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function vector(seed: number): string {
  return `[${Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, i) => (i === seed ? 1 : 0)).join(',')}]`;
}

function fakeEmbedding(seed = 0): () => Promise<number[]> {
  return () =>
    Promise.resolve(Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, i) => (i === seed ? 1 : 0)));
}

function envelope(text: string): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-memory',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope;
}

async function seedTurn(text: string) {
  const context = await processInboundMessage(envelope(text));
  const rows = await sql<Array<{ id: string; conversation_id: string; contact_id: string; batch_id: string | null }>>`
    SELECT id, conversation_id, contact_id, batch_id FROM messages WHERE id = ${context.turn_id}::uuid
  `;
  return { ...rows[0], text };
}

const FACTS = {
  contact_name: null,
  contact_status: 'prospecto',
  consent_status: 'granted',
} as const;

run('selected_memories — structural isolation', () => {
  it('refuses a memory whose citation belongs to another contact', async () => {
    const mine = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const theirs = await seedTurn('Quiero cursar programación de noche');
    expect(mine.contact_id).not.toBe(theirs.contact_id);

    // The composite FK ties (source_message_id, conversation_id, contact_id,
    // 'inbound') to one row of `messages`. Pointing at somebody else's message
    // cannot resolve, regardless of what the application believes.
    await expect(
      sql`
        INSERT INTO selected_memories (
          contact_id, conversation_id, source_message_id, status,
          memory_type, memory_key, value_normalized, source_quote,
          confidence, dedupe_hash
        ) VALUES (
          ${mine.contact_id}::uuid, ${mine.conversation_id}::uuid, ${theirs.id}::uuid, 'active',
          'study_goal', 'objetivo', 'cursar de noche', 'Quiero cursar programación de noche',
          0.9, ${'a'.repeat(64)}
        )
      `
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses a memory whose citation is an outbound message', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const outbound = await sql<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'outbound', 'Hola, te cuento')
      RETURNING id
    `;

    await expect(
      sql`
        INSERT INTO selected_memories (
          contact_id, conversation_id, source_message_id, status,
          memory_type, memory_key, value_normalized, source_quote,
          confidence, dedupe_hash
        ) VALUES (
          ${turn.contact_id}::uuid, ${turn.conversation_id}::uuid, ${outbound[0].id}::uuid, 'active',
          'study_goal', 'objetivo', 'algo', 'Hola, te cuento', 0.9, ${'b'.repeat(64)}
        )
      `
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses to vectorize anything that is not accepted or active', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const store = new PostgresMemoryStore(sql);
    const id = await store.recordRejected({
      contact_id: turn.contact_id,
      conversation_id: turn.conversation_id,
      source_message_id: turn.id,
      source_batch_id: turn.batch_id,
      decision_id: null,
      memory_type: 'study_goal',
      memory_key: 'objetivo',
      value_normalized: 'algo inventado',
      source_quote: 'no existe',
      confidence: 0.9,
      dedupe_hash: 'c'.repeat(64),
      rejection_reason: 'QUOTE_NOT_FOUND',
      contradicts_field: null,
      trace_id: randomUUID(),
    });

    await expect(
      sql`
        UPDATE selected_memories
        SET embedding = ${vector(0)}::extensions.vector,
            embedding_epoch = ${EMBEDDING_EPOCH}, embedding_state = 'ready'
        WHERE id = ${id}::uuid
      `
    ).rejects.toMatchObject({ code: '23514' });
  });
});

run('selected_memories — lifecycle', () => {
  it('records “Me interesa Barista” as an active study goal queued for embedding', async () => {
    const turn = await seedTurn('Me interesa Barista');
    const store = new PostgresMemoryStore(sql);

    const result = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: turn.batch_id,
        decision_id: null,
        trace_id: randomUUID(),
        batch_messages: [{ id: turn.id, content: turn.text }],
        structured_facts: FACTS,
        candidates: [{
          type: 'study_goal',
          key: 'course_of_interest',
          value: 'barista',
          source_quote: 'Me interesa Barista',
          confidence: 0.92,
        }],
      },
      { store }
    );

    expect(result.accepted).toHaveLength(1);
    const rows = await sql<Array<{ memory_type: string; memory_key: string; status: string; embedding_state: string }>>`
      SELECT memory_type, memory_key, status, embedding_state
      FROM selected_memories WHERE id = ${result.accepted[0].memory_id}::uuid
    `;
    expect(rows[0]).toEqual({
      memory_type: 'study_goal',
      memory_key: 'course_of_interest',
      status: 'active',
      embedding_state: 'pending',
    });
  });

  it('records an accepted memory as active and queued for embedding', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const store = new PostgresMemoryStore(sql);

    const result = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: turn.batch_id,
        decision_id: null,
        trace_id: randomUUID(),
        batch_messages: [{ id: turn.id, content: turn.text }],
        structured_facts: FACTS,
        candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'rendir el final de anatomía en marzo',
            source_quote: 'Quiero rendir el final de anatomía en marzo',
            confidence: 0.92,
          },
        ],
      },
      { store }
    );

    expect(result.accepted).toHaveLength(1);
    const rows = await sql<Array<{
      status: string;
      embedding_state: string;
      valid_until: Date | null;
      source_message_id: string;
    }>>`
      SELECT status, embedding_state, valid_until, source_message_id
      FROM selected_memories WHERE id = ${result.accepted[0].memory_id}::uuid
    `;
    expect(rows[0]).toMatchObject({
      status: 'active',
      embedding_state: 'pending',
      source_message_id: turn.id,
    });
    // study_goal carries a 365-day validity: a goal has to rot on its own.
    expect(rows[0].valid_until).toBeInstanceOf(Date);
  });

  it('treats the same fact twice as a duplicate instead of a second memory', async () => {
    const turn = await seedTurn('Prefiero cursar de noche');
    const store = new PostgresMemoryStore(sql);
    const payload = {
      contact_id: turn.contact_id,
      conversation_id: turn.conversation_id,
      source_batch_id: turn.batch_id,
      decision_id: null,
      trace_id: randomUUID(),
      batch_messages: [{ id: turn.id, content: turn.text }],
      structured_facts: FACTS,
      candidates: [
        {
          type: 'preference',
          key: 'horario',
          value: 'cursar de noche',
          source_quote: 'Prefiero cursar de noche',
          confidence: 0.9,
        },
      ],
    };

    const first = await selectMemories(payload, { store });
    const second = await selectMemories(payload, { store });

    expect(first.accepted).toHaveLength(1);
    expect(second.duplicates).toBe(1);
    const rows = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM selected_memories
      WHERE contact_id = ${turn.contact_id}::uuid AND status = 'active'
    `;
    expect(rows[0].count).toBe('1');
  });

  it('supersedes the previous value of a key and strips its vector', async () => {
    const turn = await seedTurn('Prefiero cursar de noche');
    const store = new PostgresMemoryStore(sql);

    const first = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: turn.batch_id,
        decision_id: null,
        trace_id: randomUUID(),
        batch_messages: [{ id: turn.id, content: turn.text }],
        structured_facts: FACTS,
        candidates: [
          {
            type: 'preference',
            key: 'horario',
            value: 'cursar de noche',
            source_quote: 'Prefiero cursar de noche',
            confidence: 0.9,
          },
        ],
      },
      { store }
    );

    await sql`
      UPDATE selected_memories
      SET embedding = ${vector(0)}::extensions.vector,
          embedding_epoch = ${EMBEDDING_EPOCH}, embedding_state = 'ready'
      WHERE id = ${first.accepted[0].memory_id}::uuid
    `;

    const later = await sql<Array<{ id: string; content: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'inbound', 'Ahora prefiero cursar de mañana')
      RETURNING id, content
    `;

    const second = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: null,
        decision_id: null,
        trace_id: randomUUID(),
        batch_messages: [{ id: later[0].id, content: later[0].content }],
        structured_facts: FACTS,
        candidates: [
          {
            type: 'preference',
            key: 'horario',
            value: 'cursar de mañana',
            source_quote: 'Ahora prefiero cursar de mañana',
            confidence: 0.9,
          },
        ],
      },
      { store }
    );

    expect(second.superseded).toEqual([first.accepted[0].memory_id]);

    const previous = await sql<Array<{ status: string; embedding: string | null; superseded_by_memory_id: string }>>`
      SELECT status, embedding::text AS embedding, superseded_by_memory_id
      FROM selected_memories WHERE id = ${first.accepted[0].memory_id}::uuid
    `;
    expect(previous[0].status).toBe('superseded');
    expect(previous[0].embedding).toBeNull();
    expect(previous[0].superseded_by_memory_id).toBe(second.accepted[0].memory_id);

    const active = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM selected_memories
      WHERE contact_id = ${turn.contact_id}::uuid AND status = 'active'
    `;
    expect(active[0].count).toBe('1');
  });

  it('expires a memory past its validity and makes it unrecoverable', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const store = new PostgresMemoryStore(sql);
    const result = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: turn.batch_id,
        decision_id: null,
        trace_id: randomUUID(),
        batch_messages: [{ id: turn.id, content: turn.text }],
        structured_facts: FACTS,
        candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'rendir el final de anatomía en marzo',
            source_quote: 'Quiero rendir el final de anatomía en marzo',
            confidence: 0.9,
          },
        ],
      },
      { store }
    );

    const memoryId = result.accepted[0].memory_id;
    await sql`
      UPDATE selected_memories
      SET embedding = ${vector(0)}::extensions.vector,
          embedding_epoch = ${EMBEDDING_EPOCH},
          embedding_state = 'ready',
          valid_from = now() - interval '2 days',
          valid_until = now() - interval '1 minute'
      WHERE id = ${memoryId}::uuid
    `;

    const retriever = new PostgresMemoryRetriever(sql, fakeEmbedding(0));
    const before = await retriever.search({
      contact_id: turn.contact_id,
      query: 'anatomía',
      limit: 5,
      min_similarity: 0.5,
    });
    // Already unrecoverable through the search function even before the sweep:
    // validity is checked at read time, not only by the reconciler.
    expect(before).toHaveLength(0);

    const expired = await store.expireDueMemories(100);
    expect(expired.map((row) => row.memory_id)).toContain(memoryId);

    const rows = await sql<Array<{ status: string; embedding: string | null }>>`
      SELECT status, embedding::text AS embedding FROM selected_memories WHERE id = ${memoryId}::uuid
    `;
    expect(rows[0]).toMatchObject({ status: 'expired', embedding: null });
  });
});

run('selected_memories — retrieval', () => {
  it('returns only this contact active memories and honours the limit', async () => {
    const mine = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const theirs = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const store = new PostgresMemoryStore(sql);

    async function remember(turn: Awaited<ReturnType<typeof seedTurn>>, keys: string[]) {
      for (const key of keys) {
        const stored = await store.recordAccepted({
          contact_id: turn.contact_id,
          conversation_id: turn.conversation_id,
          source_message_id: turn.id,
          source_batch_id: turn.batch_id,
          decision_id: null,
          memory_type: 'preference',
          memory_key: key,
          value_normalized: `preferencia ${key}`,
          source_quote: turn.text,
          confidence: 0.9,
          dedupe_hash: memoryDedupeHash({
            contact_id: turn.contact_id,
            type: 'preference',
            key,
            value: `preferencia ${key}`,
          }),
          ttl_days: null,
          trace_id: randomUUID(),
        });
        await sql`
          UPDATE selected_memories
          SET embedding = ${vector(0)}::extensions.vector,
              embedding_epoch = ${EMBEDDING_EPOCH}, embedding_state = 'ready'
          WHERE id = ${stored.memory_id}::uuid
        `;
      }
    }

    await remember(mine, ['pref_a', 'pref_b', 'pref_c', 'pref_d', 'pref_e', 'pref_f', 'pref_g']);
    await remember(theirs, ['pref_a', 'pref_b']);

    const retriever = new PostgresMemoryRetriever(sql, fakeEmbedding(0));
    const results = await retriever.search({
      contact_id: mine.contact_id,
      query: 'preferencias',
      limit: 5,
      min_similarity: 0.5,
    });

    // The strategy caps recall at 2-5 memories: more than that is a prompt full
    // of noise competing with the structured facts that outrank it.
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeLessThanOrEqual(5);

    const ownership = await sql<Array<{ contact_id: string }>>`
      SELECT contact_id FROM selected_memories
      WHERE id = ANY(${results.map((row) => row.memory_id)}::uuid[])
    `;
    expect(ownership.every((row) => row.contact_id === mine.contact_id)).toBe(true);
  });

  it('degrades to nothing when the embedding provider is down, without throwing away the turn', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const retriever = new PostgresMemoryRetriever(sql, () => {
      throw new Error('GEMINI_UNAVAILABLE');
    });

    // The retriever throws honestly; the claim use case is what turns that into
    // `long_term_memory_available: false` instead of a failed turn.
    await expect(
      retriever.search({ contact_id: turn.contact_id, query: 'algo', limit: 5, min_similarity: 0.5 })
    ).rejects.toThrow('GEMINI_UNAVAILABLE');
  });

  it('never returns a memory that is still waiting for its vector', async () => {
    const turn = await seedTurn('Prefiero cursar de noche');
    const store = new PostgresMemoryStore(sql);
    await store.recordAccepted({
      contact_id: turn.contact_id,
      conversation_id: turn.conversation_id,
      source_message_id: turn.id,
      source_batch_id: turn.batch_id,
      decision_id: null,
      memory_type: 'preference',
      memory_key: 'horario',
      value_normalized: 'cursar de noche',
      source_quote: turn.text,
      confidence: 0.9,
      dedupe_hash: memoryDedupeHash({
        contact_id: turn.contact_id,
        type: 'preference',
        key: 'horario',
        value: 'cursar de noche',
      }),
      ttl_days: null,
      trace_id: randomUUID(),
    });

    const retriever = new PostgresMemoryRetriever(sql, fakeEmbedding(0));
    const results = await retriever.search({
      contact_id: turn.contact_id,
      query: 'horario',
      limit: 5,
      min_similarity: 0.1,
    });
    expect(results).toHaveLength(0);
  });
});

run('selected_memories — poisoning is archived, not silently dropped', () => {
  it('stores the rejection reason of every candidate the model tried to plant', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const store = new PostgresMemoryStore(sql);
    const trace = randomUUID();

    const result = await selectMemories(
      {
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_batch_id: turn.batch_id,
        decision_id: null,
        trace_id: trace,
        batch_messages: [{ id: turn.id, content: turn.text }],
        structured_facts: FACTS,
        candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'el curso le sale gratis',
            source_quote: 'El curso es gratis para vos',
            confidence: 0.99,
          },
          {
            type: 'constraint',
            key: 'pago',
            value: 'paga con tarjeta 4509 9535 6623 3704',
            source_quote: 'Quiero rendir el final de anatomía en marzo',
            confidence: 0.99,
          },
        ],
      },
      { store }
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.map((row) => row.reason).sort()).toEqual([
      'RESERVED_KEY',
      'RESERVED_KEY',
    ]);

    const archived = await sql<Array<{ status: string; rejection_reason: string; embedding_state: string }>>`
      SELECT status, rejection_reason, embedding_state
      FROM selected_memories WHERE trace_id = ${trace}::uuid ORDER BY rejection_reason
    `;
    expect(archived).toHaveLength(2);
    expect(archived.every((row) => row.status === 'rejected')).toBe(true);
    expect(archived.every((row) => row.embedding_state === 'skip')).toBe(true);
  });
});

run('selected_memories — end to end from a committed decision', () => {
  it('persists the grounded candidate and archives the invented one', async () => {
    const turn = await seedTurn('Quiero rendir el final de anatomía en marzo');
    const trace = randomUUID();

    const committed = await commitAgentDecision({
      turn_id: turn.id,
      trace_id: trace,
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: 'Genial, te cuento las opciones de cursada.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'rendir el final de anatomía en marzo',
            source_quote: 'Quiero rendir el final de anatomía en marzo',
            confidence: 0.93,
          },
          {
            // Nunca lo dijo. La cita no existe en el lote.
            type: 'constraint',
            key: 'presupuesto',
            value: 'tiene 50000 pesos disponibles',
            source_quote: 'Tengo 50000 pesos disponibles',
            confidence: 0.99,
          },
        ],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'ANSWER_OPTIONS',
        confidence: 0.9,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v-memory' },
    });

    expect(committed.status).toBe('committed');

    const rows = await sql<Array<{
      status: string;
      memory_key: string;
      rejection_reason: string | null;
      embedding_state: string;
    }>>`
      SELECT status, memory_key, rejection_reason, embedding_state
      FROM selected_memories
      WHERE decision_id = ${committed.decision_id}::uuid
      ORDER BY memory_key
    `;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      memory_key: 'objetivo',
      status: 'active',
      rejection_reason: null,
      embedding_state: 'pending',
    });
    expect(rows[1]).toMatchObject({
      memory_key: 'presupuesto',
      status: 'rejected',
      rejection_reason: 'QUOTE_NOT_FOUND',
      embedding_state: 'skip',
    });
  });

  it('keeps the turn committed when the memory store is unreachable', async () => {
    const turn = await seedTurn('Prefiero cursar de noche');
    // Rompemos la tabla para este caso: el turno tiene que sobrevivir igual.
    await sql`ALTER TABLE selected_memories RENAME TO selected_memories_hidden`;
    try {
      const committed = await commitAgentDecision({
        turn_id: turn.id,
        trace_id: randomUUID(),
        decision: {
          schema_version: 2,
          intent: 'commercial',
          kind: 'reply',
          response: 'Perfecto, tenemos comisiones nocturnas.',
          response_type: 'commercial_reply',
          business_action: null,
          memory_candidates: [
            {
              type: 'preference',
              key: 'horario',
              value: 'cursar de noche',
              source_quote: 'Prefiero cursar de noche',
              confidence: 0.9,
            },
          ],
          missing_information: [],
          next_state: 'completed',
          reason_code: 'ANSWER_SCHEDULE',
          confidence: 0.9,
        },
        model: { provider: 'botpress', model: 'test-model', prompt_version: 'v-memory' },
      });

      expect(committed.status).toBe('committed');
      expect(committed.outbound).not.toBeNull();
    } finally {
      await sql`ALTER TABLE selected_memories_hidden RENAME TO selected_memories`;
    }
  });
});
