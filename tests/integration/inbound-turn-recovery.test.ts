import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';
import { PostgresReconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
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
run('durable rejected turn recovery', () => {
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
