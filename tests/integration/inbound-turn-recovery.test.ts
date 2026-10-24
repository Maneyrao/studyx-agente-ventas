import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';
import { PostgresReconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
import * as turnRecoveryAdapter from '@/features/orchestration/adapters/postgres-turn-recovery';
import postgres from 'postgres';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const store = new PostgresOrchestrationStore();
afterAll(async () => { await db?.end(); await sql.end(); });
async function fixture() {
  const id = randomUUID();
  const envelope: InboundEnvelope = { schema_version: 1, source: 'botpress', channel: 'emulator',
    integration_id: 'integrity-recovery', external_message_id: id, external_conversation_id: id,
    external_user_id: id, phone_e164: `+54911${Math.floor(10_000_000 + Math.random()*89_999_999)}`,
    trace_id: randomUUID(), message: { type: 'text', text: 'Quiero conocer los planes',
      occurred_at: new Date().toISOString(), reply_to_external_message_id: null } };
  const ingested = await processInboundMessage(envelope);
  await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${ingested.batch.id}`;
  const claimed = await store.claimBatch({ batch_id: ingested.batch.id, claimed_by: 'first' });
  return { envelope, batch: ingested.batch.id, token: claimed.claim_token! };
}
function recover(batch: string, token: string) {
  return db!`SELECT * FROM schedule_inbound_batch_recovery(${batch}::uuid, ${token}::uuid, 'AGENT_A_CONTINUATION_REJECTED', 'studyx')`;
}
async function exhaust(f: Awaited<ReturnType<typeof fixture>>) {
  for (const attempt of [1, 2, 3]) {
    if (attempt > 1) {
      await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${f.batch}`;
      const claimed = await store.claimBatch({ batch_id: f.batch, claimed_by: `retry-${attempt}` });
      expect(claimed.outcome).toBe('claimed');
      f.token = claimed.claim_token!;
    }
    expect((await recover(f.batch, f.token))[0]).toMatchObject({
      outcome: attempt === 3 ? 'exhausted' : 'scheduled',
      attempt,
    });
  }
  const [identity] = await db!`SELECT conversation_id, representative_turn_id
    FROM inbound_batches WHERE id = ${f.batch}::uuid`;
  return {
    batchId: f.batch,
    conversationId: identity.conversation_id as string,
    turnId: identity.representative_turn_id as string,
    traceId: randomUUID(),
    workspaceSlug: 'studyx',
  };
}
run('durable rejected turn recovery', () => {
  it('reopens one exhausted unanswered batch without deleting its recovery history', async () => {
    const f = await fixture();
    const input = await exhaust(f);

    type Repair = (input: {
      batchId: string;
      conversationId: string;
      turnId: string;
      traceId: string;
      workspaceSlug: string;
    }) => Promise<{ outcome: string; replayed: boolean }>;
    const repair = (turnRecoveryAdapter as unknown as {
      repairExhaustedInboundBatch?: Repair;
    }).repairExhaustedInboundBatch;
    expect(repair).toBeTypeOf('function');
    if (!repair) return;

    expect(await repair(input)).toEqual({ outcome: 'reopened', replayed: false });
    expect(await repair(input)).toEqual({ outcome: 'reopened', replayed: true });

    expect((await db!`SELECT state, last_error_code, completed_at IS NULL AS unfinished
      FROM inbound_batches WHERE id = ${f.batch}::uuid`)[0]).toEqual({
      state: 'waiting',
      last_error_code: 'AGENT_A_MANUAL_REPLAY_PENDING',
      unfinished: true,
    });
    expect(await db!`SELECT attempt, outcome FROM inbound_batch_recoveries
      WHERE batch_id = ${f.batch}::uuid ORDER BY attempt`).toEqual([
      { attempt: 1, outcome: 'scheduled' },
      { attempt: 2, outcome: 'scheduled' },
      { attempt: 3, outcome: 'exhausted' },
    ]);
    expect(await db!`SELECT id FROM audit_log
      WHERE event_key = ${`inbound-batch-repair:${f.batch}`}`).toHaveLength(1);
  });

  it('refuses to reopen an exhausted batch after a newer customer message', async () => {
    const f = await fixture();
    const input = await exhaust(f);
    await processInboundMessage({
      ...f.envelope,
      external_message_id: randomUUID(),
      trace_id: randomUUID(),
      message: {
        ...f.envelope.message,
        text: 'Tengo otra consulta nueva',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
      },
    });

    expect(await turnRecoveryAdapter.repairExhaustedInboundBatch({
      ...input,
      traceId: randomUUID(),
    })).toEqual({ outcome: 'superseded', replayed: false });
    expect((await db!`SELECT state FROM inbound_batches WHERE id = ${f.batch}::uuid`)[0].state)
      .toBe('abandoned');
    expect(await db!`SELECT id FROM audit_log
      WHERE event_key = ${`inbound-batch-repair:${f.batch}`}`).toHaveLength(0);
  });

  it('runs first and idempotent repair calls with the production database role', async () => {
    const f = await fixture();
    const input = await exhaust(f);
    const roleDb = postgres(process.env.TEST_DATABASE_URL!, {
      max: 1,
      connection: { options: '-c role=orchestrator_role' },
    });
    try {
      expect(await turnRecoveryAdapter.repairExhaustedInboundBatch(input, roleDb))
        .toEqual({ outcome: 'reopened', replayed: false });
      expect(await turnRecoveryAdapter.repairExhaustedInboundBatch(input, roleDb))
        .toEqual({ outcome: 'reopened', replayed: true });
    } finally {
      await roleDb.end();
    }
  });

  it('rechecks current workspace ownership before returning an idempotent repair', async () => {
    const f = await fixture();
    const input = await exhaust(f);
    expect(await turnRecoveryAdapter.repairExhaustedInboundBatch(input))
      .toEqual({ outcome: 'reopened', replayed: false });
    await db!`UPDATE workspace_contacts SET lifecycle_status = 'inactive'
      WHERE contact_id = (SELECT contact_id FROM inbound_batches WHERE id = ${f.batch}::uuid)`;
    expect(await turnRecoveryAdapter.repairExhaustedInboundBatch(input))
      .toEqual({ outcome: 'not_owner', replayed: false });
  });

  it('serializes concurrent repair calls into one mutation and one audit receipt', async () => {
    const f = await fixture();
    const input = await exhaust(f);
    const left = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
    const right = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
    try {
      const outcomes = await Promise.all([
        turnRecoveryAdapter.repairExhaustedInboundBatch(input, left),
        turnRecoveryAdapter.repairExhaustedInboundBatch(input, right),
      ]);
      expect(outcomes).toEqual(expect.arrayContaining([
        { outcome: 'reopened', replayed: false },
        { outcome: 'reopened', replayed: true },
      ]));
      expect(await db!`SELECT id FROM audit_log
        WHERE event_key = ${`inbound-batch-repair:${f.batch}`}`).toHaveLength(1);
    } finally {
      await Promise.all([left.end(), right.end()]);
    }
  });

  it('closes a failed manual replay without inserting recovery attempt four', async () => {
    const f = await fixture();
    const input = await exhaust(f);
    await turnRecoveryAdapter.repairExhaustedInboundBatch(input);
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${f.batch}`;
    const claim = await store.claimBatch({ batch_id: f.batch, claimed_by: 'manual-replay' });
    expect(claim.outcome).toBe('claimed');
    expect((await recover(f.batch, claim.claim_token!))[0]).toEqual({
      outcome: 'exhausted', attempt: 3, delay_ms: 0,
    });
    expect((await db!`SELECT state, last_error_code, claim_token FROM inbound_batches
      WHERE id = ${f.batch}::uuid`)[0]).toEqual({
      state: 'abandoned',
      last_error_code: 'AGENT_A_MANUAL_REPLAY_FAILED',
      claim_token: null,
    });
    expect(await db!`SELECT attempt FROM inbound_batch_recoveries
      WHERE batch_id = ${f.batch}::uuid ORDER BY attempt`).toEqual([
      { attempt: 1 }, { attempt: 2 }, { attempt: 3 },
    ]);
    expect(await db!`SELECT id FROM audit_log
      WHERE event_key = ${`inbound-batch-manual-replay-failed:${f.batch}`}`).toHaveLength(1);
  });

  it('allows only the backend role to schedule an owned recovery', async () => {
    const f = await fixture();
    const [permissions] = await db!`SELECT
      has_function_privilege('anon', 'schedule_inbound_batch_recovery(uuid,uuid,text,text)', 'EXECUTE') AS anonymous,
      has_function_privilege('authenticated', 'schedule_inbound_batch_recovery(uuid,uuid,text,text)', 'EXECUTE') AS customer`;
    expect(permissions).toEqual({ anonymous: false, customer: false });
    await db!.begin(async tx => {
      await tx`SET LOCAL ROLE orchestrator_role`;
      const [result] = await tx`SELECT * FROM schedule_inbound_batch_recovery(${f.batch}::uuid,
        ${f.token}::uuid, 'FACT_VALUE_MISMATCH', 'studyx')`;
      expect(result).toMatchObject({ outcome: 'scheduled', attempt: 1 });
    });
  });
  it('escalates an expired recovery handoff through the existing reconciler without a decision or send', async () => {
    const f = await fixture();
    await recover(f.batch, f.token);
    const reconciler = new PostgresReconciliationStore(db!);
    expect((await reconciler.expireStaleClaims()).some(row => row.batch_id === f.batch)).toBe(false);
    await db!`UPDATE inbound_batch_recoveries SET created_at = now() - interval '3 minutes' WHERE batch_id = ${f.batch}`;
    expect(await reconciler.expireStaleClaims()).toEqual(expect.arrayContaining([
      expect.objectContaining({ batch_id: f.batch, action: 'abandoned' }),
    ]));
    expect((await reconciler.expireStaleClaims()).some(row => row.batch_id === f.batch)).toBe(false);
    expect((await db!`SELECT human_review_requested_at FROM conversation_sales_context_states_v1
      WHERE conversation_id = (SELECT conversation_id FROM inbound_batches WHERE id = ${f.batch})`)[0]?.human_review_requested_at).toBeTruthy();
    expect(await db!`SELECT id FROM agent_decisions WHERE turn_id IN (SELECT id FROM messages WHERE batch_id = ${f.batch})`).toHaveLength(0);
  });
  it('reopens an owned unanswered batch once and bounds recovery across fresh workflows', async () => {
    const f = await fixture();
    const [first] = await recover(f.batch, f.token);
    expect(first).toMatchObject({ outcome: 'scheduled', attempt: 1, delay_ms: 2000 });
    expect((await recover(f.batch, f.token))[0]).toEqual(first);
    expect((await db!`SELECT state FROM inbound_batches WHERE id = ${f.batch}`)[0].state).toBe('waiting');
    for (const attempt of [2, 3]) {
      await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${f.batch}`;
      const next = await store.claimBatch({ batch_id: f.batch, claimed_by: `retry-${attempt}` });
      expect(next.outcome).toBe('claimed');
      expect((await recover(f.batch, next.claim_token!))[0]).toMatchObject({
        outcome: attempt === 2 ? 'scheduled' : 'exhausted', attempt,
      });
    }
    expect((await db!`SELECT state, last_error_code FROM inbound_batches WHERE id = ${f.batch}`)[0])
      .toEqual({ state: 'abandoned', last_error_code: 'AGENT_A_RECOVERY_EXHAUSTED' });
    expect(await db!`SELECT id FROM agent_decisions WHERE turn_id IN (SELECT id FROM messages WHERE batch_id = ${f.batch})`).toHaveLength(0);
    expect((await db!`SELECT human_review_requested_at FROM conversation_sales_context_states_v1
      WHERE conversation_id = (SELECT conversation_id FROM inbound_batches WHERE id = ${f.batch})`)[0]?.human_review_requested_at).toBeTruthy();
  });
  it('cannot release another workflow claim and yields to a newer customer batch', async () => {
    const f = await fixture();
    expect((await recover(f.batch, randomUUID()))[0].outcome).toBe('not_owner');
    expect((await db!`SELECT * FROM schedule_inbound_batch_recovery(${f.batch}::uuid,
      ${f.token}::uuid, 'AGENT_A_CONTINUATION_REJECTED', 'another-workspace')`)[0].outcome).toBe('not_owner');
    expect((await db!`SELECT state FROM inbound_batches WHERE id = ${f.batch}`)[0].state).toBe('claimed');
    await processInboundMessage({ ...f.envelope, external_message_id: randomUUID(),
      trace_id: randomUUID(), message: { ...f.envelope.message, text: 'Ahora prefiero otra cosa' } });
    expect((await recover(f.batch, f.token))[0].outcome).toBe('superseded');
    expect((await db!`SELECT state FROM inbound_batches WHERE id = ${f.batch}`)[0].state).toBe('abandoned');
  });
});
