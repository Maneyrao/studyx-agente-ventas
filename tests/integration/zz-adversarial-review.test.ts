import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, recordDeliveryReport } from '@/lib/services/decision.service';
import { reconcileOrchestration } from '@/features/orchestration/application/reconcile-orchestration';
import { PostgresReconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const store = new PostgresReconciliationStore(sql);

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(text: string): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-adversarial',
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

function decision(response = 'Te cuento las opciones.') {
  return {
    schema_version: 3 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response,
    response_type: 'commercial_reply' as const,
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed' as const,
    reason_code: 'ANSWER_OPTIONS',
    confidence: 0.9,
    retrieval_used: null,
  };
}

async function seedDeliveredTurn() {
  const context = await processInboundMessage(envelope('¿Qué cursos tienen?'));
  const committed = await commitAgentDecision({
    turn_id: context.turn_id,
    trace_id: randomUUID(),
    decision: decision(),
    model: { provider: 'botpress', model: 'test-model', prompt_version: 'v-adv' },
  });
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM outbound_deliveries WHERE message_id = ${committed.outbound!.id}::uuid
  `;
  return { ...committed, delivery_id: rows[0].id };
}

async function ageDelivery(deliveryId: string) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = 'replica'`;
    await tx`
      UPDATE outbound_deliveries
      SET updated_at = now() - interval '10 minutes',
          lease_until = CASE WHEN lease_until IS NULL THEN NULL ELSE now() - interval '5 minutes' END
      WHERE id = ${deliveryId}::uuid
    `;
  });
}

async function deliveryRow(deliveryId: string) {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT state, reconciliation_state, reconciliation_reason, provider_message_id,
           lease_until, next_attempt_at, attempt_count
    FROM outbound_deliveries WHERE id = ${deliveryId}::uuid
  `;
  return rows[0];
}

run('FINDING A — apply_delivery_reconciliation does not honour ambiguous_paused', () => {
  it('lets a late authorize_resend overwrite a paused delivery', async () => {
    const turn = await seedDeliveredTurn();
    await ageDelivery(turn.delivery_id);

    // Sweep 1 pauses it: lease expired, nothing reported. Terminal by design.
    await reconcileOrchestration({ trace_id: randomUUID(), grace_seconds: 60 }, { store });
    const paused = await deliveryRow(turn.delivery_id);
    expect(paused.reconciliation_state).toBe('ambiguous_paused');

    // Sweep 2 read its row list BEFORE sweep 1 committed the pause, so its
    // verdict was computed from reconciliation_state = null. It now applies.
    // This is exactly what two overlapping cron invocations produce.
    const applied = await store.applyDeliveryVerdict({
      delivery_id: turn.delivery_id,
      action: 'authorize_resend',
      reason: 'NEVER_LEASED',
    });

    const after = await deliveryRow(turn.delivery_id);
    expect(applied.applied).toBe(false);
    expect(after.reconciliation_state).toBe('ambiguous_paused'); // EXPECTED to hold
  });
});

run('FINDING B — a stale failed report from attempt N-1 authorizes a resend', () => {
  it('resends after a later attempt that may have physically sent', async () => {
    const turn = await seedDeliveredTurn();

    // Attempt 1: Botpress raised before creating a message. Affirmative
    // evidence of no send. Delivery goes to failed_retryable.
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
    });

    // Attempt 2: a worker leases it again and dies right after createMessage.
    // No report exists for this attempt. The latest report is still attempt 1's
    // `failed`.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = 'replica'`;
      await tx`
        UPDATE outbound_deliveries
        SET state = 'leased',
            leased_by = 'worker-2',
            lease_until = now() - interval '5 minutes',
            attempt_count = attempt_count + 1,
            updated_at = now() - interval '10 minutes'
        WHERE id = ${turn.delivery_id}::uuid
      `;
    });

    const before = await deliveryRow(turn.delivery_id);
    const result = await reconcileOrchestration(
      { trace_id: randomUUID(), grace_seconds: 60 },
      { store }
    );
    const after = await deliveryRow(turn.delivery_id);

    // The lease expired without a report for THIS attempt: unknowable.
    expect(result.deliveries.by_action.authorize_resend ?? 0).toBe(0);
    expect(after.state).toBe(before.state);
    expect(after.reconciliation_state).toBe('ambiguous_paused'); // EXPECTED to hold
  });
});
