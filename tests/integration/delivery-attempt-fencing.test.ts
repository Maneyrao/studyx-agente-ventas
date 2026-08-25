/**
 * Fencing por intento y adherencia del pausado ambiguo.
 *
 * Los dos fallos que cierra este archivo comparten una sola causa: el sistema
 * trataba "lo último que se supo de esta entrega" como si fuera "lo que se sabe
 * del intento actual". No es lo mismo. Un reporte pertenece al intento que lo
 * produjo, y una pausa por ambigüedad pertenece a la persona que la tiene que
 * mirar. Cuando cualquiera de las dos cosas se pierde, el sistema puede mandar
 * el mismo mensaje dos veces, que es el único error de este sistema que no
 * tiene vuelta atrás.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import {
  commitAgentDecision,
  recordDeliveryReport,
  DeliveryReportConflictError,
} from '@/lib/services/decision.service';
import { leadProjectionKey } from '@/lib/services/projection.service';
import { PostgresReconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const store = new PostgresReconciliationStore(sql);

afterAll(async () => {
  await sql.end();
});

function envelope(text: string): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-fencing',
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

async function seedTurn() {
  const context = await processInboundMessage(envelope('¿Cuánto sale el curso?'));
  const committed = await commitAgentDecision({
    turn_id: context.turn_id,
    trace_id: randomUUID(),
    decision: {
      schema_version: 3 as const,
      intent: 'commercial' as const,
      kind: 'reply' as const,
      response: 'Te paso los precios.',
      response_type: 'commercial_reply' as const,
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed' as const,
      reason_code: 'ANSWER_PRICE',
      confidence: 0.9,
      retrieval_used: null,
    },
    model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-fence' },
  });
  const rows = await sql<Array<{ id: string; attempt_count: number }>>`
    SELECT id, attempt_count FROM outbound_deliveries
    WHERE message_id = ${committed.outbound!.id}::uuid
  `;
  return { ...committed, delivery_id: rows[0].id, attempt: rows[0].attempt_count };
}

async function deliveryRow(deliveryId: string) {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT state, reconciliation_state, reconciliation_reason, provider_message_id,
           attempt_count, lease_until, last_error_code
    FROM outbound_deliveries WHERE id = ${deliveryId}::uuid
  `;
  return rows[0];
}

/** Simula que otro worker tomó la entrega para un intento posterior. */
async function leaseNextAttempt(deliveryId: string) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = 'replica'`;
    await tx`
      UPDATE outbound_deliveries
      SET state = 'leased',
          leased_by = 'worker-2',
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
      WHERE id = ${deliveryId}::uuid
    `;
  });
}

async function auditRows(entityId: string, action: string) {
  return sql<Array<{ payload: Record<string, unknown> }>>`
    SELECT payload FROM audit_log
    WHERE entity_id = ${entityId}::uuid AND action = ${action}
  `;
}

async function pause(deliveryId: string) {
  return store.applyDeliveryVerdict({
    delivery_id: deliveryId,
    action: 'pause_ambiguous',
    reason: 'LEASE_EXPIRED_WITHOUT_REPORT',
  });
}

run('ambiguous_paused es adherente en PostgreSQL', () => {
  it('rechaza authorize_resend sobre una entrega pausada', async () => {
    const turn = await seedTurn();
    await pause(turn.delivery_id);

    const applied = await store.applyDeliveryVerdict({
      delivery_id: turn.delivery_id,
      action: 'authorize_resend',
      reason: 'NEVER_LEASED',
    });

    expect(applied.applied).toBe(false);
    expect((await deliveryRow(turn.delivery_id)).reconciliation_state).toBe('ambiguous_paused');
  });

  it('audita la transición rechazada', async () => {
    const turn = await seedTurn();
    await pause(turn.delivery_id);

    await store.applyDeliveryVerdict({
      delivery_id: turn.delivery_id,
      action: 'authorize_resend',
      reason: 'REPORTED_FAILED_BEFORE_SEND',
    });

    const audits = await auditRows(turn.delivery_id, 'delivery.reconciliation.rejected');
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.attempted_action).toBe('authorize_resend');
    expect(audits[0].payload.held_reconciliation_state).toBe('ambiguous_paused');
  });

  it('rechaza abandon sobre una entrega pausada: la mirada humana sigue pendiente', async () => {
    const turn = await seedTurn();
    await pause(turn.delivery_id);

    const applied = await store.applyDeliveryVerdict({
      delivery_id: turn.delivery_id,
      action: 'abandon',
      reason: 'MAX_ATTEMPTS_EXHAUSTED',
    });

    expect(applied.applied).toBe(false);
    expect((await deliveryRow(turn.delivery_id)).state).not.toBe('dead_letter');
  });

  it('acepta mark_sent cuando aparece prueba física del envío', async () => {
    const turn = await seedTurn();
    await pause(turn.delivery_id);
    // `provider_message_id` es único en toda la tabla: un id fijo choca con el
    // de cualquier otra corrida que haya dejado filas en el cluster.
    const proof = `bp-proof-${randomUUID()}`;
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = 'replica'`;
      await tx`
        UPDATE outbound_deliveries SET provider_message_id = ${proof}
        WHERE id = ${turn.delivery_id}::uuid
      `;
    });

    const applied = await store.applyDeliveryVerdict({
      delivery_id: turn.delivery_id,
      action: 'mark_sent',
      reason: 'PROVIDER_MESSAGE_ID_PRESENT',
    });

    expect(applied.applied).toBe(true);
    expect((await deliveryRow(turn.delivery_id)).reconciliation_state).toBe('confirmed_sent');
  });
});

run('el backend le dice a Botpress qué intento le está confiando', () => {
  it('devuelve el intento junto al outbound al commitear', async () => {
    const turn = await seedTurn();
    expect(turn.outbound!.delivery_attempt).toBe(turn.attempt);
  });

  it('devuelve el mismo intento al reproducir el commit', async () => {
    const context = await processInboundMessage(envelope('¿Tienen cuotas?'));
    const payload = {
      turn_id: context.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 3 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: 'Sí, en tres cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'ANSWER_INSTALMENTS',
        confidence: 0.9,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-fence' },
    };

    const first = await commitAgentDecision(payload);
    const replay = await commitAgentDecision(payload);

    expect(replay.status).toBe('duplicate');
    expect(replay.outbound!.delivery_attempt).toBe(first.outbound!.delivery_attempt);
  });
});

run('un reporte pertenece a un intento y sólo a ese intento', () => {
  it('sella el reporte con el intento vigente al escribirlo', async () => {
    const turn = await seedTurn();
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
      delivery_attempt: turn.attempt,
    });

    const rows = await sql<Array<{ delivery_attempt: number }>>`
      SELECT delivery_attempt FROM delivery_reports WHERE delivery_id = ${turn.delivery_id}::uuid
    `;
    expect(rows[0].delivery_attempt).toBe(turn.attempt);
  });

  it('un reporte atrasado no degrada el estado de un intento posterior', async () => {
    const turn = await seedTurn();
    await leaseNextAttempt(turn.delivery_id);
    const before = await deliveryRow(turn.delivery_id);

    // El workflow del intento 1 revive tarde y reporta su propio fracaso. El
    // intento 2 ya está en vuelo y pudo haber creado el mensaje.
    const result = await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
      delivery_attempt: turn.attempt,
    });

    const after = await deliveryRow(turn.delivery_id);
    expect(result.status).toBe('stale_ignored');
    expect(after.state).toBe(before.state);
    expect(after.last_error_code).toBeNull();
  });

  it('audita el reporte atrasado en vez de descartarlo en silencio', async () => {
    const turn = await seedTurn();
    await leaseNextAttempt(turn.delivery_id);

    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
      delivery_attempt: turn.attempt,
    });

    const audits = await auditRows(turn.delivery_id, 'delivery.report.stale_ignored');
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.reported_attempt).toBe(turn.attempt);
    expect(audits[0].payload.current_attempt).toBe(turn.attempt + 1);
  });

  it('conserva el reporte atrasado como evidencia', async () => {
    const turn = await seedTurn();
    await leaseNextAttempt(turn.delivery_id);

    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
      delivery_attempt: turn.attempt,
    });

    const rows = await sql<Array<{ delivery_attempt: number; report_status: string }>>`
      SELECT delivery_attempt, report_status FROM delivery_reports
      WHERE delivery_id = ${turn.delivery_id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].delivery_attempt).toBe(turn.attempt);
  });

  it('rechaza un reporte que dice pertenecer a un intento que todavía no ocurrió', async () => {
    const turn = await seedTurn();

    await expect(
      recordDeliveryReport({
        outbound_id: turn.outbound!.id,
        trace_id: randomUUID(),
        status: 'failed',
        botpress_message_id: null,
        replayed: false,
        error_code: 'STUDYX_NETWORK_ERROR',
        delivery_attempt: turn.attempt + 5,
      })
    ).rejects.toBeInstanceOf(DeliveryReportConflictError);
  });

  it('sigue aplicando un reporte del intento vigente', async () => {
    const turn = await seedTurn();
    const botpressMessageId = `bp-current-${randomUUID()}`;

    const result = await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: botpressMessageId,
      replayed: false,
      error_code: null,
      delivery_attempt: turn.attempt,
    });

    const after = await deliveryRow(turn.delivery_id);
    expect(result.status).toBe('recorded');
    expect(after.state).toBe('submitted');
    expect(after.provider_message_id).toBe(botpressMessageId);
  });
});

/**
 * Fase 4 — Sheets sólo después de la entrega confirmada
 * (docs/contracts/agent-a-operational-mvp.md §5, §7). Un fallo de entrega
 * nunca encola la proyección; una entrega confirmada encola exactamente una,
 * incluso si el reporte se reproduce.
 */
run('la entrega gobierna la proyección payment_link_sent', () => {
  let paymentWorkspaceId: string;
  const PAYMENT_WORKSPACE_SLUG = `test-payment-fence-${randomUUID().slice(0, 8)}`;
  const SPREADSHEET_ID = `test-sheet-${randomUUID()}`;
  const TAB_NAME = 'Leads';
  const savedEnv: Partial<Record<string, string>> = {};

  beforeAll(async () => {
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name) VALUES (${PAYMENT_WORKSPACE_SLUG}, 'Payment Fencing Test')
      RETURNING id
    `;
    paymentWorkspaceId = rows[0].id;
    await sql`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency
      ) VALUES (
        ${paymentWorkspaceId}::uuid, 'course_fence', 'Curso Fencing', 'course', 'active',
        'Offering canónico del test', 'fixed', 360, 'USD'
      )
    `;
    for (const key of [
      'BUSINESS_WORKSPACE_SLUG',
      'PAYMENT_LINK_12M',
      'PAYMENT_LINK_6M',
      'PAYMENT_LINK_CONTADO',
      'GOOGLE_SHEETS_SPREADSHEET_ID',
      'GOOGLE_SHEETS_TAB_NAME',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.BUSINESS_WORKSPACE_SLUG = PAYMENT_WORKSPACE_SLUG;
    process.env.PAYMENT_LINK_12M = 'https://buy.stripe.com/test_12m_fence';
    process.env.PAYMENT_LINK_6M = 'https://buy.stripe.com/test_6m_fence';
    process.env.PAYMENT_LINK_CONTADO = 'https://buy.stripe.com/test_contado_fence';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = SPREADSHEET_ID;
    process.env.GOOGLE_SHEETS_TAB_NAME = TAB_NAME;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function seedPaymentTurn(text: string) {
    const context = await processInboundMessage(envelope(text));
    const committed = await commitAgentDecision({
      turn_id: context.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: 'Perfecto, te paso el link del plan de 12 cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_12' as const,
          offering_sku: 'course_fence',
        },
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'PLAN_CHOSEN',
        confidence: 0.95,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-fence-payment' },
    });
    const rows = await sql<Array<{ id: string; attempt_count: number }>>`
      SELECT id, attempt_count FROM outbound_deliveries
      WHERE message_id = ${committed.outbound!.id}::uuid
    `;
    return {
      ...committed,
      delivery_id: rows[0].id,
      attempt: rows[0].attempt_count,
      contact_id: context.contact.id,
    };
  }

  async function projectionRows(contactId: string) {
    return sql<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM sheet_projection_rows
      WHERE projection_key = ${leadProjectionKey(paymentWorkspaceId, contactId)}
    `;
  }

  it('a failed delivery report never marks the link sent or enqueues a projection', async () => {
    const turn = await seedPaymentTurn('Quiero pagar en 12 cuotas, opción fallida');
    await recordDeliveryReport({
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'STUDYX_NETWORK_ERROR',
      delivery_attempt: turn.attempt,
    });

    expect(await projectionRows(turn.contact_id)).toHaveLength(0);
  });

  it('a confirmed delivery enqueues exactly one payment_link_sent row, even under replay', async () => {
    const turn = await seedPaymentTurn('Quiero pagar en 12 cuotas, opción confirmada');
    const report = {
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress' as const,
      botpress_message_id: `bp-payment-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: turn.attempt,
    };

    const first = await recordDeliveryReport(report);
    expect(first.status).toBe('recorded');
    const replay = await recordDeliveryReport({ ...report, trace_id: randomUUID(), replayed: true });
    expect(replay.status).toBe('duplicate');

    const rows = await projectionRows(turn.contact_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      etapa_comercial: 'proposal',
      estado_pago: 'pendiente',
      plan: 'monthly_12',
      ultima_senal: 'payment_link_sent',
    });
  });
});
