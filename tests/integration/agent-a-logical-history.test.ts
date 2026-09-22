import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { registerMessage } from '@/lib/services/message.service';
import {
  PostgresOrchestrationStore,
  orchestrationStore,
} from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-logical-history',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Quiero conocer Marketing Digital.',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
  };
}

run('Agent A logical-history metadata', () => {
  it('reads inbound batches and three outbound parts with their durable causal links and order', async () => {
    const firstEnvelope = envelope();
    const first = await processInboundMessage(firstEnvelope);
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${first.batch.id}::uuid`;
    const firstClaim = await orchestrationStore.claimBatch({
      batch_id: first.batch.id,
      claimed_by: 'logical-history-first',
    });
    expect(firstClaim.outcome).toBe('claimed');
    if (firstClaim.claim_token === null) throw new Error('expected first claim token');
    await orchestrationStore.completeBatch({
      batch_id: first.batch.id,
      claim_token: firstClaim.claim_token,
    });

    const [{ conversation_id: conversationId }] = await db!<Array<{ conversation_id: string }>>`
      SELECT conversation_id FROM messages WHERE id = ${first.turn_id}::uuid
    `;
    if (!conversationId) throw new Error('expected first conversation');

    for (const [partIndex, content] of [
      'Marketing Digital tiene 16 clases.',
      'La modalidad es 100% online.',
      '¿Querés que te cuente los planes?',
    ].entries()) {
      await registerMessage({
        conversation_id: conversationId,
        direction: 'outbound',
        content,
        in_reply_to: first.turn_id,
        part_index: partIndex,
        metadata: { source: 'logical-history-test' },
      }, { db: db!, embedding: 'skip' });
    }

    const followUp = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        ...firstEnvelope.message,
        text: '¿Y ese?',
        occurred_at: new Date(Date.now() + 5_000).toISOString(),
      },
    });
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${followUp.batch.id}::uuid`;
    const followUpClaim = await orchestrationStore.claimBatch({
      batch_id: followUp.batch.id,
      claimed_by: 'logical-history-follow-up',
    });
    expect(followUpClaim.outcome).toBe('claimed');

    const context = await new PostgresOrchestrationStore(db!).loadClaimedBatchContext({
      batch_id: followUp.batch.id,
      recent_turns_limit: 10,
    });

    expect(context?.facts.recent_turns).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        content: 'Quiero conocer Marketing Digital.',
        batch_id: first.batch.id,
        in_reply_to: null,
      }),
      expect.objectContaining({
        direction: 'outbound',
        content: 'Marketing Digital tiene 16 clases.',
        batch_id: null,
        in_reply_to: first.turn_id,
      }),
      expect.objectContaining({
        direction: 'outbound',
        content: 'La modalidad es 100% online.',
        batch_id: null,
        in_reply_to: first.turn_id,
      }),
      expect.objectContaining({
        direction: 'outbound',
        content: '¿Querés que te cuente los planes?',
        batch_id: null,
        in_reply_to: first.turn_id,
      }),
    ]);
  });

  it('projects the latest six complete interventions even when ten physical rows cut the oldest reply', async () => {
    const base = envelope();

    for (let turnIndex = 1; turnIndex <= 3; turnIndex += 1) {
      const inbound = await processInboundMessage({
        ...base,
        external_message_id: `message-${randomUUID()}`,
        trace_id: randomUUID(),
        message: {
          ...base.message,
          text: `Turno histórico ${turnIndex}`,
          occurred_at: new Date(Date.now() + turnIndex * 10_000).toISOString(),
        },
      });
      await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${inbound.batch.id}::uuid`;
      const claimed = await orchestrationStore.claimBatch({
        batch_id: inbound.batch.id,
        claimed_by: `logical-history-${turnIndex}`,
      });
      expect(claimed.outcome).toBe('claimed');
      if (claimed.claim_token === null) throw new Error('expected historical claim token');
      await orchestrationStore.completeBatch({
        batch_id: inbound.batch.id,
        claim_token: claimed.claim_token,
      });

      const [{ conversation_id: conversationId }] = await db!<Array<{ conversation_id: string }>>`
        SELECT conversation_id FROM messages WHERE id = ${inbound.turn_id}::uuid
      `;
      if (!conversationId) throw new Error('expected historical conversation');

      for (let partIndex = 0; partIndex < 3; partIndex += 1) {
        await registerMessage({
          conversation_id: conversationId,
          direction: 'outbound',
          content: `Respuesta ${turnIndex}.${partIndex + 1}`,
          in_reply_to: inbound.turn_id,
          part_index: partIndex,
          metadata: { source: 'logical-history-boundary-test' },
        }, { db: db!, embedding: 'skip' });
      }
    }

    const current = await processInboundMessage({
      ...base,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        ...base.message,
        text: '¿Qué fue lo último que me dijiste?',
        occurred_at: new Date(Date.now() + 40_000).toISOString(),
      },
    });
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${current.batch.id}::uuid`;
    const currentClaim = await orchestrationStore.claimBatch({
      batch_id: current.batch.id,
      claimed_by: 'logical-history-boundary-current',
    });
    expect(currentClaim.outcome).toBe('claimed');

    const context = await new PostgresOrchestrationStore(db!).loadClaimedBatchContext({
      batch_id: current.batch.id,
      recent_turns_limit: 10,
    });
    const logical = (context as unknown as {
      logical_recent_turns?: Array<{ direction: string; content: string }>;
    } | null)?.logical_recent_turns;

    expect(context?.facts.recent_turns).toHaveLength(10);
    expect(logical).toEqual([
      { direction: 'inbound', content: 'Turno histórico 1', created_at: expect.any(String) },
      {
        direction: 'outbound',
        content: 'Respuesta 1.1\nRespuesta 1.2\nRespuesta 1.3',
        created_at: expect.any(String),
      },
      { direction: 'inbound', content: 'Turno histórico 2', created_at: expect.any(String) },
      {
        direction: 'outbound',
        content: 'Respuesta 2.1\nRespuesta 2.2\nRespuesta 2.3',
        created_at: expect.any(String),
      },
      { direction: 'inbound', content: 'Turno histórico 3', created_at: expect.any(String) },
      {
        direction: 'outbound',
        content: 'Respuesta 3.1\nRespuesta 3.2\nRespuesta 3.3',
        created_at: expect.any(String),
      },
    ]);
  });
});
