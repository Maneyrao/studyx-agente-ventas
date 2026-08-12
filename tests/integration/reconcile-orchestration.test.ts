import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import {
  commitAgentDecision,
  recordDeliveryReport,
  DecisionConflictError,
} from '@/lib/services/decision.service';
import { reconcileOrchestration } from '@/features/orchestration/application/reconcile-orchestration';
import { PostgresReconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
import { sql } from '@/lib/db/orchestrator';

/**
 * Fase 7 against a real database, with real concurrency.
 *
 * The interesting cases here are the ones a single-threaded test cannot
 * produce: two connections committing the same turn at the same instant, and a
 * delivery abandoned mid-flight. Everything asserts the same invariant from a
 * different angle — a message with a confirmed Botpress id is never created
 * again, and an outcome nobody can prove is paused rather than guessed.
 */

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
    integration_id: 'vitest-reconcile',
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

function decision(response = 'Te cuento las opciones de cursada.') {
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

/** A committed turn with a live outbound delivery, ready to be broken. */
async function seedDeliveredTurn(response?: string) {
  const context = await processInboundMessage(envelope('¿Qué cursos tienen?'));
  const committed = await commitAgentDecision({
    turn_id: context.turn_id,
    trace_id: randomUUID(),
    decision: decision(response),
    model: { provider: 'botpress', model: 'test-model', prompt_version: 'v-reconcile' },
  });
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM outbound_deliveries WHERE message_id = ${committed.outbound!.id}::uuid
  `;
  return { ...committed, delivery_id: rows[0].id };
}

/**
 * Push the row past the sweep's grace window without waiting in real time.
 *
 * `outbound_deliveries_set_updated_at` stamps `updated_at = now()` on every
 * UPDATE, which is correct in production and makes the row impossible to age
 * from a test. `SET LOCAL session_replication_role = 'replica'` suppresses user
 * triggers for this transaction only — scoped to one pinned connection, so a
 * concurrent test file is unaffected.
 */
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

async function sweep() {
  return reconcileOrchestration({ trace_id: randomUUID(), grace_seconds: 60 }, { store });
}

async function deliveryRow(deliveryId: string) {
  const rows = await sql<Array<{
    state: string;
    reconciliation_state: string | null;
    reconciliation_reason: string | null;
    provider_message_id: string | null;
  }>>`
    SELECT state, reconciliation_state, reconciliation_reason, provider_message_id
    FROM outbound_deliveries WHERE id = ${deliveryId}::uuid
  `;
  return rows[0];
}

run('concurrent decisions on the same turn', () => {
  it('gives two identical concurrent commits the same decision id', async () => {
    const context = await processInboundMessage(envelope('¿Cuánto dura el curso?'));
    const trace = randomUUID();
    const payload = {
      turn_id: context.turn_id,
      trace_id: trace,
      decision: decision(),
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-reconcile' },
    };

    const [left, right] = await Promise.all([
      commitAgentDecision(payload),
      commitAgentDecision(payload),
    ]);

    expect(left.decision_id).toBe(right.decision_id);
    expect(left.outbound!.id).toBe(right.outbound!.id);
    // Exactly one of them did the work; the other replayed the same answer.
    expect([left.status, right.status].sort()).toEqual(['committed', 'duplicate']);

    const outbounds = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM messages
      WHERE in_reply_to = ${context.turn_id}::uuid AND direction = 'outbound'
    `;
    expect(outbounds[0].count).toBe('1');
  });

  it('refuses a second, different decision for the same turn', async () => {
    const context = await processInboundMessage(envelope('¿Tienen cursos de noche?'));
    const base = {
      turn_id: context.turn_id,
      trace_id: randomUUID(),
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-reconcile' },
    };

    const outcomes = await Promise.allSettled([
      commitAgentDecision({ ...base, decision: decision('Sí, tenemos comisiones nocturnas.') }),
      commitAgentDecision({ ...base, decision: decision('No, sólo dictamos de mañana.') }),
    ]);

    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DecisionConflictError);

    const outbounds = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM messages
      WHERE in_reply_to = ${context.turn_id}::uuid AND direction = 'outbound'
    `;
    expect(outbounds[0].count).toBe('1');
  });
});

run('reconciling outbound deliveries', () => {
  it('pauses a lease that expired without a report, and never resends it', async () => {
    const turn = await seedDeliveredTurn();
    await ageDelivery(turn.delivery_id);

    const result = await sweep();
    expect(result.deliveries.by_action.pause_ambiguous).toBeGreaterThanOrEqual(1);

    const row = await deliveryRow(turn.delivery_id);
    expect(row).toMatchObject({
      reconciliation_state: 'ambiguous_paused',
      reconciliation_reason: 'LEASE_EXPIRED_WITHOUT_REPORT',
    });
    // Crucially NOT back to pending: a paused delivery is not resendable.
    expect(row.state).not.toBe('pending');
  });

  it('keeps a paused delivery paused across repeated sweeps', async () => {
    const turn = await seedDeliveredTurn();
    await ageDelivery(turn.delivery_id);
    await sweep();
    const first = await deliveryRow(turn.delivery_id);

    await ageDelivery(turn.delivery_id);
    await sweep();
    const second = await deliveryRow(turn.delivery_id);

    expect(second.reconciliation_state).toBe('ambiguous_paused');
    expect(second.state).toBe(first.state);
  });

  it('authorizes a resend only when the failure was reported before any send', async () => {
    const turn = await seedDeliveredTurn();
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
    });
    await ageDelivery(turn.delivery_id);

    const result = await sweep();
    expect(result.deliveries.by_action.authorize_resend).toBeGreaterThanOrEqual(1);

    const row = await deliveryRow(turn.delivery_id);
    // `failed_retryable` ya es el estado desde el que un worker puede tomarla:
    // autorizar el reenvío suelta el lease muerto, no mueve la máquina de estados.
    expect(row).toMatchObject({
      state: 'failed_retryable',
      reconciliation_state: 'resend_authorized',
      reconciliation_reason: 'REPORTED_FAILED_BEFORE_SEND',
    });
    const timing = await sql<Array<{ lease_until: Date | null }>>`
      SELECT lease_until FROM outbound_deliveries WHERE id = ${turn.delivery_id}::uuid
    `;
    expect(timing[0].lease_until).toBeNull();
  });

  it('never resends once Botpress confirmed a message id', async () => {
    const turn = await seedDeliveredTurn();
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${randomUUID()}`,
      replayed: false,
      error_code: null,
    });
    await ageDelivery(turn.delivery_id);

    await sweep();

    const row = await deliveryRow(turn.delivery_id);
    expect(row.state).toBe('submitted');
    expect(row.reconciliation_state).not.toBe('resend_authorized');
    expect(row.provider_message_id).not.toBeNull();
  });

  it('abandons instead of resending when the attempt budget is gone', async () => {
    const turn = await seedDeliveredTurn();
    // El presupuesto se agota ANTES del reporte: desde la fase 7b un reporte
    // pertenece al intento vigente cuando se escribió, y uno del intento 1 no
    // dice nada sobre el último. Reportar primero y después mover el contador
    // dejaría al último intento sin evidencia, que es un pausado, no un abandono.
    await sql`
      UPDATE outbound_deliveries
      SET attempt_count = max_attempts
      WHERE id = ${turn.delivery_id}::uuid
    `;
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
    });
    await ageDelivery(turn.delivery_id);

    await sweep();

    const row = await deliveryRow(turn.delivery_id);
    expect(row).toMatchObject({
      state: 'dead_letter',
      reconciliation_state: 'abandoned',
      reconciliation_reason: 'MAX_ATTEMPTS_EXHAUSTED',
    });
  });

  it('leaves a live lease alone', async () => {
    const turn = await seedDeliveredTurn();
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = 'replica'`;
      await tx`
        UPDATE outbound_deliveries
        SET updated_at = now() - interval '10 minutes',
            lease_until = now() + interval '5 minutes'
        WHERE id = ${turn.delivery_id}::uuid
      `;
    });

    await sweep();

    const row = await deliveryRow(turn.delivery_id);
    expect(row.reconciliation_state).toBeNull();
  });
});

run('two reconcilers racing', () => {
  it('produces one verdict per delivery, not two', async () => {
    const turn = await seedDeliveredTurn();
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
    });
    await ageDelivery(turn.delivery_id);

    const [left, right] = openIndependentLocalTestDatabases(2);
    try {
      await Promise.all([
        reconcileOrchestration(
          { trace_id: randomUUID(), grace_seconds: 60 },
          { store: new PostgresReconciliationStore(left) }
        ),
        reconcileOrchestration(
          { trace_id: randomUUID(), grace_seconds: 60 },
          { store: new PostgresReconciliationStore(right) }
        ),
      ]);
    } finally {
      await Promise.all([left.end(), right.end()]);
    }

    const row = await deliveryRow(turn.delivery_id);
    expect(row.reconciliation_state).toBe('resend_authorized');

    // The verdict is applied under a row lock, so concurrent sweeps converge
    // instead of stacking repairs on top of each other.
    const counts = await sql<Array<{ reconciliation_count: number }>>`
      SELECT reconciliation_count FROM outbound_deliveries WHERE id = ${turn.delivery_id}::uuid
    `;
    expect(counts[0].reconciliation_count).toBeLessThanOrEqual(2);

    const outbounds = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM messages
      WHERE id = ${turn.outbound!.id}::uuid
    `;
    expect(outbounds[0].count).toBe('1');
  });
});

run('stuck batch claims', () => {
  it('abandons a claim whose lease ran out past its attempt budget', async () => {
    const context = await processInboundMessage(envelope('Hola, consulta rápida'));
    const batchId = context.batch.id;

    await sql`
      UPDATE inbound_batches
      SET state = 'claimed',
          claim_token = gen_random_uuid(),
          claimed_by = 'botpress:dead-worker',
          claimed_at = now() - interval '10 minutes',
          lease_until = now() - interval '5 minutes',
          claim_attempt_count = 5
      WHERE id = ${batchId}::uuid
    `;

    const result = await sweep();
    expect(result.claims.examined).toBeGreaterThanOrEqual(1);

    const rows = await sql<Array<{ state: string }>>`
      SELECT state FROM inbound_batches WHERE id = ${batchId}::uuid
    `;
    // Never back to `waiting`: that would collide with the partial unique index
    // if the conversation already opened another window.
    expect(rows[0].state).toBe('abandoned');
  });
});

run('the sweep is idempotent', () => {
  it('reports no new work on a second immediate run', async () => {
    const turn = await seedDeliveredTurn();
    await ageDelivery(turn.delivery_id);

    await sweep();
    const second = await sweep();

    expect(second.deliveries.failed).toBe(0);
    const row = await deliveryRow(turn.delivery_id);
    expect(row.reconciliation_state).toBe('ambiguous_paused');
  });
});
