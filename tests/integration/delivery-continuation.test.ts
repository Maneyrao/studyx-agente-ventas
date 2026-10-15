import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, recordDeliveryReport } from '@/lib/services/decision.service';
import { authorizeDeliveryContinuation } from '@/lib/services/delivery-continuation.service';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
afterAll(async () => { await sql.end(); });

async function fixture() {
  const id = randomUUID(), trace = randomUUID();
  const envelope: InboundEnvelope = { schema_version: 1, source: 'botpress', channel: 'emulator',
    integration_id: 'continuation-test', external_message_id: id, external_conversation_id: id,
    external_user_id: id, phone_e164: `+999${Date.now().toString().slice(-10)}`,
    trace_id: randomUUID(), message: { type: 'text', text: 'Quiero información',
      occurred_at: new Date().toISOString(), reply_to_external_message_id: null } };
  const ingested = await processInboundMessage(envelope);
  const decision = await commitAgentDecision({ turn_id: ingested.turn_id, trace_id: trace, supports_send_fencing: true,
    decision: { schema_version: 3, intent: 'commercial', kind: 'reply', response: 'Te cuento cómo funciona.',
      response_type: 'commercial_reply', business_action: null, memory_candidates: [], missing_information: [],
      next_state: 'completed', reason_code: 'INFORMATION', confidence: 0.9, retrieval_used: null },
    model: { provider: 'botpress', model: 'fixture', prompt_version: 'continuation-test' } });
  return { envelope, trace, outbound: decision.outbound!.id, attempt: decision.outbound!.delivery_attempt };
}

run('continuation of a never executed send step', () => {
  it('includes only physically submitted responses in subsequent conversation history', async () => {
    const f = await fixture();
    const current = await processInboundMessage({ ...f.envelope, external_message_id: randomUUID(), trace_id: randomUUID(),
      message: { ...f.envelope.message, text: 'Otra pregunta', occurred_at: new Date().toISOString() } });
    const store = new PostgresOrchestrationStore();
    const history = () => store.loadClaimedBatchContext({ batch_id: current.batch.id, recent_turns_limit: 20 });
    const before = await history();
    expect(before?.facts.recent_turns.filter(turn => turn.direction === 'outbound')).toHaveLength(0);
    expect(before?.logical_recent_turns?.filter(turn => turn.direction === 'outbound')).toHaveLength(0);
    await recordDeliveryReport({ outbound_id: f.outbound, trace_id: f.trace, delivery_attempt: f.attempt,
      status: 'submitted_to_botpress', botpress_message_id: randomUUID(), error_code: null, replayed: false });
    const after = await history();
    expect(after?.facts.recent_turns.filter(turn => turn.direction === 'outbound').map(turn => turn.content))
      .toEqual(['Te cuento cómo funciona.']);
    expect(after?.logical_recent_turns?.filter(turn => turn.direction === 'outbound').map(turn => turn.content))
      .toEqual(['Te cuento cómo funciona.']);
  });
  it('renews only the original owner and attempt after its lease expired', async () => {
    const f = await fixture();
    await sql`UPDATE outbound_deliveries SET lease_until = now() - interval '1 minute' WHERE message_id = ${f.outbound}`;
    expect(await authorizeDeliveryContinuation({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt })).toMatchObject({ outcome: 'authorized' });
    expect((await sql`SELECT attempt_count, lease_until > now() AS live FROM outbound_deliveries
      WHERE message_id = ${f.outbound}`)[0]).toEqual({ attempt_count: f.attempt, live: true });
    // Authorization starts this physical send. A subsequent authorization is
    // ambiguous, even if no provider response has been recorded yet.
    expect((await authorizeDeliveryContinuation({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt })).outcome).toBe('not_owner');
  });

  it('can resume a reserved part after reconciliation erased its expired lease owner', async () => {
    const f = await fixture();
    await sql`SELECT * FROM apply_delivery_reconciliation((SELECT id FROM outbound_deliveries
      WHERE message_id = ${f.outbound}), 'pause_ambiguous', 'LEASE_EXPIRED_WITHOUT_REPORT')`;
    expect((await authorizeDeliveryContinuation({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt })).outcome).toBe('authorized');
  });

  it('refuses another owner, attempt, workspace, and an already submitted part', async () => {
    const f = await fixture();
    for (const input of [
      { trace_id: randomUUID(), delivery_attempt: f.attempt },
      { trace_id: f.trace, delivery_attempt: f.attempt + 1 },
      { trace_id: f.trace, delivery_attempt: f.attempt, workspaceSlug: 'other-workspace' },
    ]) expect((await authorizeDeliveryContinuation({ outbound_id: f.outbound, ...input })).outcome).toBe('not_owner');
    await recordDeliveryReport({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt, status: 'submitted_to_botpress', botpress_message_id: randomUUID(),
      error_code: null, replayed: false });
    expect((await authorizeDeliveryContinuation({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt })).outcome).toBe('not_owner');
  });

  it('cancels the unsent remainder when a newer customer turn superseded it', async () => {
    const f = await fixture();
    await processInboundMessage({ ...f.envelope, external_message_id: randomUUID(), trace_id: randomUUID(),
      message: { ...f.envelope.message, text: 'Ahora quiero otra cosa', occurred_at: new Date(Date.now() + 100).toISOString() } });
    expect((await authorizeDeliveryContinuation({ outbound_id: f.outbound, trace_id: f.trace,
      delivery_attempt: f.attempt })).outcome).toBe('superseded');
    expect((await sql`SELECT state FROM outbound_deliveries WHERE message_id = ${f.outbound}`)[0]?.state).toBe('cancelled');
  });
});
