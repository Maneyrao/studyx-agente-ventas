import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import {
  PostgresOrchestrationStore,
  orchestrationStore,
} from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  PostgresKnowledgeRetriever,
  PostgresMemoryRetriever,
} from '@/features/orchestration/adapters/postgres-retrievers';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { buildBusinessContextView } from '@/features/orchestration/domain/business-context';
import type { DbClient } from '@/lib/db/types';

/**
 * Fase 3 against a real database: the controlled context is assembled only
 * after the claim, is scoped to the batch's own contact and conversation, and
 * survives an embedding-provider outage.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

/** Deterministic stand-in for the provider; the real one needs a network key. */
function fakeEmbedding(): Promise<number[]> {
  return Promise.resolve(Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)));
}

const deps = {
  store: orchestrationStore,
  embedding: { embed: fakeEmbedding },
  memory: new PostgresMemoryRetriever(sql),
  knowledge: new PostgresKnowledgeRetriever(sql),
  limits: DEFAULT_CONTEXT_LIMITS,
};

function countedDatabase() {
  let statements = 0;
  const counted = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    statements += 1;
    return (db as unknown as (strings: TemplateStringsArray, ...params: unknown[]) => unknown)(
      strings,
      ...params
    );
  }) as unknown as DbClient;
  return {
    db: counted,
    reset() { statements = 0; },
    get statements() { return statements; },
  };
}

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-claim',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Hola',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
    ...overrides,
  };
}

function followUp(first: InboundEnvelope, text: string, type: InboundEnvelope['message']['type'] = 'text') {
  return {
    ...first,
    external_message_id: `message-${randomUUID()}`,
    trace_id: randomUUID(),
    message: { ...first.message, type, text, occurred_at: new Date().toISOString() },
  };
}

async function forceDue(batchId: string): Promise<void> {
  await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${batchId}::uuid`;
}

run('controlled context at claim time', () => {
  it('assembles the batch, structured facts and summary for the owner', async () => {
    const first = envelope();
    const a = await processInboundMessage(first);
    await processInboundMessage(followUp(first, '¿cuánto sale el curso de ventas?'));
    await forceDue(a.batch.id);

    const result = await claimBatch(
      { batch_id: a.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );

    expect(result.outcome).toBe('claimed');
    if (result.outcome !== 'claimed') return;

    expect(result.batch.claim_token).toEqual(expect.any(String));
    expect(result.context.batch_messages.map((m) => m.content)).toEqual([
      'Hola',
      '¿cuánto sale el curso de ventas?',
    ]);
    expect(result.context.recent_turns).toEqual([]);
    expect(result.context.summary.version).toBeGreaterThanOrEqual(0);
    expect(result.policy.may_respond).toBe(true);
    expect(result.contact.id).toEqual(expect.any(String));
    expect(result.existing_result).toBeNull();
  });

  it('never leaks another contact into the context', async () => {
    const mine = await processInboundMessage(envelope());
    const other = await processInboundMessage(
      envelope({
        message: {
          type: 'text',
          text: 'SECRETO_DE_OTRO_CONTACTO',
          occurred_at: new Date().toISOString(),
          reply_to_external_message_id: null,
        },
      })
    );
    expect(other.turn_id).not.toBe(mine.turn_id);

    await forceDue(mine.batch.id);
    const result = await claimBatch(
      { batch_id: mine.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SECRETO_DE_OTRO_CONTACTO');
    expect(result.context.batch_messages.every((m) => m.id !== other.turn_id)).toBe(true);
  });

  it('degrades to structured context when the embedding provider is unavailable', async () => {
    const ingested = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: '¿Cuánto sale el curso?',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    await forceDue(ingested.batch.id);

    const failing = () => Promise.reject(new Error('GEMINI_API_KEY is not set'));
    const result = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      {
        ...deps,
        embedding: { embed: failing },
      }
    );

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.knowledge_base_available).toBe(false);
    // The turn stays answerable from facts the provider cannot affect.
    expect(result.context.batch_messages).toHaveLength(1);
    expect(result.context.recent_turns).toEqual([]);
  });

  it('uses at most five PostgreSQL statements from claim start through the warm model path', async () => {
    const workspaceSlug = `claim-hotpath-${randomUUID().slice(0, 8)}`;
    const workspaceRows = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${workspaceSlug}, 'Hot path fixture')
      RETURNING id
    `;
    const ingested = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: '¿Qué incluye el curso avanzado?',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    await forceDue(ingested.batch.id);

    const counted = countedDatabase();
    const embedding = { embed: vi.fn(fakeEmbedding) };
    const businessStore = new PostgresBusinessContextStore(counted.db);
    counted.reset();

    const result = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-query-count', trace_id: randomUUID() },
      {
        store: new PostgresOrchestrationStore(counted.db),
        embedding,
        memory: new PostgresMemoryRetriever(counted.db),
        knowledge: new PostgresKnowledgeRetriever(counted.db, async () => workspaceRows[0].id),
        business: {
          async load() {
            const raw = await businessStore.loadBusinessContext(workspaceSlug);
            return raw ? buildBusinessContextView(raw) : null;
          },
        },
        limits: DEFAULT_CONTEXT_LIMITS,
      }
    );

    expect(result.outcome).toBe('claimed');
    expect(embedding.embed).toHaveBeenCalledTimes(1);
    expect(counted.statements).toBeLessThanOrEqual(5);
  });

  it('tells a second workflow it was absorbed and gives it no context', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    const owner = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );
    const loser = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-b', trace_id: randomUUID() },
      deps
    );

    expect(owner.outcome).toBe('claimed');
    expect(loser.outcome).toBe('absorbed');
    expect('context' in loser).toBe(false);
  });

  it('reports the batch as unreadable only when every member is unreadable', async () => {
    const first = envelope({
      message: {
        type: 'unsupported',
        text: '[imagen]',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const a = await processInboundMessage(first);
    await forceDue(a.batch.id);

    const unreadable = await claimBatch(
      { batch_id: a.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );
    if (unreadable.outcome !== 'claimed') throw new Error('expected a claim');
    expect(unreadable.policy.reason).toBe('UNSUPPORTED_MESSAGE_TYPE');

    // One readable message in the burst is enough to answer normally.
    const second = envelope();
    const b = await processInboundMessage(second);
    await processInboundMessage(followUp(second, '[sticker]', 'unsupported'));
    await forceDue(b.batch.id);

    const mixed = await claimBatch(
      { batch_id: b.batch.id, claimed_by: 'workflow-b', trace_id: randomUUID() },
      deps
    );
    if (mixed.outcome !== 'claimed') throw new Error('expected a claim');
    expect(mixed.policy.reason).toBeNull();
  });

  it('surfaces an already committed decision instead of inviting a second answer', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    await commitAgentDecision({
      turn_id: ingested.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: 'El curso dura ocho semanas.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'ANSWER_DURATION',
        confidence: 0.9,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v1' },
    });

    const result = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.existing_result?.decision_id).toEqual(expect.any(String));
    expect(result.existing_result?.outbound_id).toEqual(expect.any(String));
  });
});

run('sales_context at claim time', () => {
  it('defaults to advising with no call history in the database', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    const result = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      deps
    );

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.sales_context).toEqual({
      mode: 'advising',
      course_of_interest: null,
      open_call_offer: null,
      accepted_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    });
  });

  // `call_sessions` y Decision v4 ya existen en esta rama integrada, así que
  // los tres hechos de llamada se proyectan desde filas canónicas reales.
  async function seedTurnWithIds(text: string) {
    const context = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text,
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    const rows = await db!<Array<{ contact_id: string; conversation_id: string }>>`
      SELECT contact_id, conversation_id FROM messages WHERE id = ${context.turn_id}::uuid
    `;
    return { ...context, ...rows[0] };
  }

  async function insertCallSession(input: {
    turnId: string;
    contactId: string;
    conversationId: string;
    status: string;
    result?: string | null;
    completedAt?: string | null;
  }): Promise<string> {
    const callId = randomUUID();
    await db!`
      INSERT INTO call_sessions (
        id, source_turn_id, contact_id, conversation_id, provider,
        request_idempotency_key, status, consent_source_message_id,
        context_snapshot, context_hash, prompt_version, requested_at,
        completed_at, result
      ) VALUES (
        ${callId}::uuid, ${input.turnId}::uuid, ${input.contactId}::uuid,
        ${input.conversationId}::uuid, 'telegram_sandbox',
        ${`vitest:${callId}`}, ${input.status}, ${input.turnId}::uuid,
        ${db!.json({ call_id: callId })}, sha256(${callId}::bytea),
        'studyx-agent-a-sales-bridge-v1', now(),
        ${input.completedAt ?? null}, ${input.result ?? null}
      )
    `;
    return callId;
  }

  async function claimSalesContext(batchId: string) {
    await forceDue(batchId);
    const result = await claimBatch(
      { batch_id: batchId, claimed_by: 'workflow-calls', trace_id: randomUUID() },
      deps
    );
    expect(result.outcome).toBe('claimed');
    if (result.outcome !== 'claimed') throw new Error('unclaimed');
    return result.sales_context;
  }

  it('projects a requested call as call_pending and blocks new call actions', async () => {
    const seeded = await seedTurnWithIds('¿Sigue la promo?');
    const callId = await insertCallSession({
      turnId: seeded.turn_id,
      contactId: seeded.contact_id,
      conversationId: seeded.conversation_id,
      status: 'requested',
    });

    const salesContext = await claimSalesContext(seeded.batch.id);
    expect(salesContext.mode).toBe('call_pending');
    expect(salesContext.active_call).toEqual({ call_id: callId, status: 'requested' });
    expect(salesContext.allowed_actions).toEqual([]);
  });

  it('projects an in_progress call as in_call', async () => {
    const seeded = await seedTurnWithIds('Hola?');
    const callId = await insertCallSession({
      turnId: seeded.turn_id,
      contactId: seeded.contact_id,
      conversationId: seeded.conversation_id,
      status: 'in_progress',
    });

    const salesContext = await claimSalesContext(seeded.batch.id);
    expect(salesContext.mode).toBe('in_call');
    expect(salesContext.active_call).toEqual({ call_id: callId, status: 'in_progress' });
  });

  it('projects the newest terminal call as post_call with its structured result', async () => {
    const seeded = await seedTurnWithIds('Gracias por la llamada');
    const callId = await insertCallSession({
      turnId: seeded.turn_id,
      contactId: seeded.contact_id,
      conversationId: seeded.conversation_id,
      status: 'completed',
      result: 'seguimiento_agendado',
      completedAt: new Date().toISOString(),
    });

    const salesContext = await claimSalesContext(seeded.batch.id);
    expect(salesContext.mode).toBe('post_call');
    expect(salesContext.active_call).toBeNull();
    expect(salesContext.last_call_result).toMatchObject({
      call_id: callId,
      result: 'seguimiento_agendado',
    });
  });

  it('enforces the 30-minute decline cooldown across turns from the durable decision log', async () => {
    // A call-specific decline keeps the written channel open. The reply
    // decision becomes the durable marker that suppresses another call offer.
    const first = envelope({ message: {
      type: 'text', text: 'No me llames, prefiero seguir por acá', occurred_at: new Date().toISOString(), reply_to_external_message_id: null,
    } });
    const ingested = await processInboundMessage(first);
    expect(ingested.contact.consent_status).not.toBe('revoked');
    expect(ingested.policy.allowed_response_types).toContain('commercial_reply');
    await forceDue(ingested.batch.id);
    await commitAgentDecision({
      turn_id: ingested.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 3,
        intent: 'commercial_decline',
        kind: 'reply',
        response: 'Perfecto, no te llamo. Cualquier consulta me escribís por acá.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'CALL_DECLINED',
        confidence: 0.95,
        retrieval_used: { kb: false, long_term_memory: false, summary_version: null },
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v1' },
    });

    const second = await processInboundMessage(followUp(first, '¿Y los horarios cuáles son?'));
    const salesContext = await claimSalesContext(second.batch.id);
    // Inside the cooldown a proactive offer is withheld…
    expect(salesContext.allowed_actions).toEqual([]);

    // …but an explicit new direct request still overrides it.
    const third = await processInboundMessage(followUp(first, 'Llamame ahora'));
    const overriding = await claimSalesContext(third.batch.id);
    expect(overriding.allowed_actions).toEqual(['request_call_now']);
  });
});
