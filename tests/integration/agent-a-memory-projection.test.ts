import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { projectAgentAMemories } from '@/features/memory/application/project-agent-a-memories';
import { PostgresMemoryRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import { EMBEDDING_DIMENSIONS, EMBEDDING_EPOCH } from '@/lib/embeddings/gemini';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

function envelope(text: string): InboundEnvelope {
  const id = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-agent-a-memory-projection',
    external_message_id: `message-${id}`,
    external_conversation_id: `conversation-${id}`,
    external_user_id: `user-${id}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text', text, occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null, audio_reference: null, metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope;
}

async function seed(text: string) {
  const ingested = await processInboundMessage(envelope(text));
  const rows = await db!<Array<{ contact_id: string }>>`
    SELECT contact_id FROM messages WHERE id = ${ingested.turn_id}::uuid
  `;
  return { turnId: ingested.turn_id, contactId: rows[0].contact_id };
}

function embedding(seed = 0): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, index) => index === seed ? 1 : 0);
}

run('Agent A memory projection', () => {
  it('enqueues on commit, projects once across ten sweeps and stays contact-isolated', async () => {
    const owner = await seed('Prefiere seguir por chat');
    const other = await seed('Quiero conocer los cursos');
    const committed = await commitAgentDecision({
      turn_id: owner.turnId,
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'commercial', kind: 'reply', response: 'Perfecto, seguimos por chat.',
        response_type: 'commercial_reply', business_action: null,
        memory_candidates: [{
          type: 'contact_preference', key: 'conversation_channel',
          value: 'prefiere seguir por chat', source_quote: 'Prefiere seguir por chat', confidence: 0.96,
        }],
        missing_information: [], next_state: 'waiting_user', reason_code: 'CONTINUE_CHAT', confidence: 0.97,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'agent-a-brain-v1-test' },
    });

    expect(committed.status).toBe('committed');
    await expect(db!`SELECT id FROM selected_memories WHERE decision_id = ${committed.decision_id}::uuid`)
      .resolves.toHaveLength(0);
    await expect(db!<Array<{ status: string }>>`
      SELECT status FROM agent_a_memory_projection_jobs WHERE decision_id = ${committed.decision_id}::uuid
    `).resolves.toEqual([{ status: 'pending' }]);

    for (let index = 0; index < 10; index += 1) {
      await projectAgentAMemories({ limit: 10 }, { db: db! });
    }

    const memories = await db!<Array<{ id: string; contact_id: string }>>`
      SELECT id, contact_id FROM selected_memories WHERE decision_id = ${committed.decision_id}::uuid
    `;
    expect(memories).toHaveLength(1);
    expect(memories[0].contact_id).toBe(owner.contactId);
    await expect(db!<Array<{ status: string; attempt_count: number }>>`
      SELECT status, attempt_count FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${committed.decision_id}::uuid
    `).resolves.toEqual([{ status: 'completed', attempt_count: 1 }]);

    await db!`
      UPDATE selected_memories
      SET embedding = ${`[${embedding().join(',')}]`}::extensions.vector,
          embedding_epoch = ${EMBEDDING_EPOCH}, embedding_state = 'ready'
      WHERE id = ${memories[0].id}::uuid
    `;
    const retriever = new PostgresMemoryRetriever(db!);
    await expect(retriever.search({
      contact_id: other.contactId, embedding: embedding(), limit: 5, min_similarity: 0.1,
    })).resolves.toHaveLength(0);
  });
});
