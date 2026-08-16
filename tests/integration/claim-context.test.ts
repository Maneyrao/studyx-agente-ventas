import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  PostgresKnowledgeRetriever,
  PostgresMemoryRetriever,
} from '@/features/orchestration/adapters/postgres-retrievers';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';

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
  memory: new PostgresMemoryRetriever(sql, fakeEmbedding),
  knowledge: new PostgresKnowledgeRetriever(sql, fakeEmbedding),
  limits: DEFAULT_CONTEXT_LIMITS,
};

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
    expect(result.context.recent_turns.length).toBeGreaterThanOrEqual(2);
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
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    const failing = () => Promise.reject(new Error('GEMINI_API_KEY is not set'));
    const result = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'workflow-a', trace_id: randomUUID() },
      {
        ...deps,
        memory: new PostgresMemoryRetriever(sql, failing),
        knowledge: new PostgresKnowledgeRetriever(sql, failing),
      }
    );

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.knowledge_base_available).toBe(false);
    // The turn stays answerable from facts the provider cannot affect.
    expect(result.context.batch_messages).toHaveLength(1);
    expect(result.context.recent_turns.length).toBeGreaterThan(0);
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
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    });
  });

  // NEEDS_CONTEXT (see task-2 report): `active_call` / `last_call_result`
  // cannot be exercised against a real database from this branch.
  // `call_sessions` is owned by the sibling call-infrastructure plan and
  // does not exist here — this worktree owns only Agent A's conversational
  // layer, and per the task's revised scope, no migration or test-only DDL
  // for `call_sessions` may be created to fake it. The adapter hardcodes
  // both facts to null (see `loadClaimedCallFacts`); `in_call`,
  // `call_pending` and `post_call` therefore stay unreachable here and are
  // covered only at the unit level (mocked store, see
  // `tests/unit/orchestration/claim-batch.test.ts`) until the sibling
  // plan's call ledger merges.
  //
  // NEEDS_CONTEXT (see task-2 report): `open_call_offer` is similarly
  // unreachable against the real schema. `agent_decisions.response_type`'s
  // CHECK constraint does not yet allow `'call_offer'` (Decision v4, owned
  // by the sibling `005-agent-a-b-communication` plan) — no producer in
  // this codebase can write such a row today, so a fixture row for this
  // scenario cannot be inserted without either a migration (out of scope
  // here) or a runtime ALTER of the constraint (rejected as equivalent to
  // one). `awaiting_call_consent` is covered only at the unit level in the
  // meantime, the same way as the call facts above.
});
