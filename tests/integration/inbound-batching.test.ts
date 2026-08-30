import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';

/**
 * Durable batching invariants (Fase 2).
 *
 * The whole point is that a customer typing three messages in a row gets one
 * answer. That requires (a) messages inside the window to share one batch,
 * (b) exactly one workflow to own that batch no matter how many race for it,
 * and (c) a batch never to span two contacts or two conversations.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const store = new PostgresOrchestrationStore();

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-batching',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Hola, quiero información',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
    ...overrides,
  };
}

/** A second message from the same customer on the same provider conversation. */
function followUp(first: InboundEnvelope, text: string): InboundEnvelope {
  return {
    ...first,
    external_message_id: `message-${randomUUID()}`,
    trace_id: randomUUID(),
    message: { ...first.message, text, occurred_at: new Date().toISOString() },
  };
}

async function forceDue(batchId: string): Promise<void> {
  await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${batchId}::uuid`;
}

run('durable inbound batching', () => {
  it('collapses messages inside the window into one batch in stable order', async () => {
    const first = envelope();
    const a = await processInboundMessage(first);
    const b = await processInboundMessage(followUp(first, 'sobre el curso de ventas'));
    const c = await processInboundMessage(followUp(first, 'y el precio'));

    expect(b.batch.id).toBe(a.batch.id);
    expect(c.batch.id).toBe(a.batch.id);
    expect(a.batch.joined_existing).toBe(false);
    expect(b.batch.joined_existing).toBe(true);
    expect(c.batch.message_count).toBe(3);

    const members = await store.listBatchMessages(a.batch.id);
    expect(members.map((m) => m.content)).toEqual([
      'Hola, quiero información',
      'sobre el curso de ventas',
      'y el precio',
    ]);
    expect(members.map((m) => m.conversation_seq)).toEqual([1, 2, 3]);
  });

  it('slides due_at forward without ever passing the hard deadline', async () => {
    const first = envelope();
    const a = await processInboundMessage(first);
    const b = await processInboundMessage(followUp(first, 'segundo'));

    expect(Date.parse(b.batch.due_at)).toBeGreaterThanOrEqual(Date.parse(a.batch.due_at));
    expect(Date.parse(b.batch.due_at)).toBeLessThanOrEqual(Date.parse(b.batch.hard_deadline_at));
    expect(b.batch.hard_deadline_at).toBe(a.batch.hard_deadline_at);
  });

  it('opens a new batch once the hard deadline has passed', async () => {
    const first = envelope();
    const a = await processInboundMessage(first);

    await db!`
      UPDATE inbound_batches
      SET due_at = now() - interval '5 seconds', hard_deadline_at = now() - interval '3 seconds'
      WHERE id = ${a.batch.id}::uuid
    `;

    const b = await processInboundMessage(followUp(first, 'mucho después'));
    expect(b.batch.id).not.toBe(a.batch.id);
    expect(b.batch.joined_existing).toBe(false);

    const previous = await db!<Array<{ state: string; last_error_code: string | null }>>`
      SELECT state, last_error_code FROM inbound_batches WHERE id = ${a.batch.id}::uuid
    `;
    // The stale window is closed explicitly, never left dangling.
    expect(previous[0].state).toBe('abandoned');
    expect(previous[0].last_error_code).toBe('WINDOW_EXPIRED_UNCLAIMED');
  });

  it('gives exactly one of five concurrent claimers the ownership token', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    const clients = openIndependentLocalTestDatabases(5);
    try {
      const results = await Promise.all(
        clients.map((client, index) =>
          new PostgresOrchestrationStore(client).claimBatch({
            batch_id: ingested.batch.id,
            claimed_by: `workflow-${index}`,
          })
        )
      );

      const claimed = results.filter((result) => result.outcome === 'claimed');
      const absorbed = results.filter((result) => result.outcome === 'absorbed');

      expect(claimed).toHaveLength(1);
      expect(absorbed).toHaveLength(4);
      expect(claimed[0].claim_token).toEqual(expect.any(String));
      expect(absorbed.every((result) => result.claim_token === null)).toBe(true);

      const tokens = await db!<Array<{ claim_token: string; claim_attempt_count: number }>>`
        SELECT claim_token, claim_attempt_count FROM inbound_batches WHERE id = ${ingested.batch.id}::uuid
      `;
      expect(tokens[0].claim_token).toBe(claimed[0].claim_token);
      expect(tokens[0].claim_attempt_count).toBe(1);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('answers waiting with a bounded retry delay before the window is due', async () => {
    const ingested = await processInboundMessage(envelope());

    const claim = await store.claimBatch({
      batch_id: ingested.batch.id,
      claimed_by: 'too-early',
    });

    expect(claim.outcome).toBe('waiting');
    expect(claim.claim_token).toBeNull();
    expect(claim.retry_after_ms).toBeGreaterThan(0);
    expect(claim.retry_after_ms).toBeLessThanOrEqual(4000);
  });

  it('lets a later claimer steal an expired lease instead of stranding the batch', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);

    const first = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'dead-worker' });
    expect(first.outcome).toBe('claimed');

    await db!`
      UPDATE inbound_batches SET lease_until = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;

    const second = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'recovery' });
    expect(second.outcome).toBe('claimed');
    expect(second.stolen).toBe(true);
    expect(second.claim_token).not.toBe(first.claim_token);
  });

  it('refuses to complete a batch with a stale claim token', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);
    const claim = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'owner' });

    const stale = await store.completeBatch({
      batch_id: ingested.batch.id,
      claim_token: randomUUID(),
    });
    expect(stale.outcome).toBe('stale_claim');

    const owned = await store.completeBatch({
      batch_id: ingested.batch.id,
      claim_token: claim.claim_token!,
    });
    expect(owned.outcome).toBe('completed');

    // Completing twice with the same proof is idempotent, not an error.
    const replay = await store.completeBatch({
      batch_id: ingested.batch.id,
      claim_token: claim.claim_token!,
    });
    expect(replay.outcome).toBe('duplicate');
  });

  it('reports a completed batch as completed, never as claimable', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);
    const claim = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'owner' });
    await store.completeBatch({ batch_id: ingested.batch.id, claim_token: claim.claim_token! });

    const late = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'late' });
    expect(late.outcome).toBe('completed');
    expect(late.claim_token).toBeNull();
  });

  it('keeps a replayed inbound in its original batch without recounting it', async () => {
    const first = envelope();
    const a = await processInboundMessage(first);
    const replay = await processInboundMessage({ ...first, trace_id: randomUUID() });

    expect(replay.status).toBe('duplicate');
    expect(replay.batch.id).toBe(a.batch.id);
    expect(replay.batch.message_count).toBe(1);
    expect(replay.batch.conversation_seq).toBe(a.batch.conversation_seq);
  });

  it('rejects a batch membership that crosses the contact boundary', async () => {
    const one = await processInboundMessage(envelope());
    const other = await processInboundMessage(envelope());
    expect(one.conversation_id).not.toBe(other.conversation_id);

    await expect(db!`
      UPDATE messages SET batch_id = ${other.batch.id}::uuid WHERE id = ${one.turn_id}::uuid
    `).rejects.toMatchObject({ code: '23503' });
  });

  it('allows only one waiting batch per conversation', async () => {
    const ingested = await processInboundMessage(envelope());
    const conversation = await db!<Array<{ conversation_id: string; contact_id: string }>>`
      SELECT conversation_id, contact_id FROM inbound_batches WHERE id = ${ingested.batch.id}::uuid
    `;

    await expect(db!`
      INSERT INTO inbound_batches (
        conversation_id, contact_id, due_at, hard_deadline_at, representative_turn_id
      )
      VALUES (
        ${conversation[0].conversation_id}::uuid,
        ${conversation[0].contact_id}::uuid,
        now() + interval '2 seconds',
        now() + interval '4 seconds',
        ${ingested.turn_id}::uuid
      )
    `).rejects.toMatchObject({ code: '23505' });
  });

  it('surfaces an expired lease to the reconciler and abandons an exhausted one', async () => {
    const ingested = await processInboundMessage(envelope());
    await forceDue(ingested.batch.id);
    await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'owner' });
    await db!`
      UPDATE inbound_batches SET lease_until = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;

    // This suite is intentionally rerunnable against an approved disposable
    // cluster. A prior interrupted run may leave more than 50 stale fixtures,
    // so the assertion must not depend on global table order.
    const reclaimable = await store.expireStaleClaims({ max_claim_attempts: 3, limit: 10_000 });
    const mine = reclaimable.find((row) => row.batch_id === ingested.batch.id);
    expect(mine?.action).toBe('reclaimable');

    await db!`
      UPDATE inbound_batches
      SET claim_attempt_count = 3, lease_until = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;

    const exhausted = await store.expireStaleClaims({ max_claim_attempts: 3, limit: 10_000 });
    expect(exhausted.find((row) => row.batch_id === ingested.batch.id)?.action).toBe('abandoned');

    const final = await db!<Array<{ state: string; last_error_code: string | null }>>`
      SELECT state, last_error_code FROM inbound_batches WHERE id = ${ingested.batch.id}::uuid
    `;
    expect(final[0].state).toBe('abandoned');
    expect(final[0].last_error_code).toBe('CLAIM_LEASE_EXHAUSTED');
  });
});
