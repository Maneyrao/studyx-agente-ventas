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
  reconcileDeliveredPaymentProjections,
  recordDeliveryReport,
  DeliveryReportConflictError,
} from '@/lib/services/decision.service';
import { leadProjectionKey } from '@/lib/services/projection.service';
import { reconcileOrchestration } from '@/features/orchestration/application/reconcile-orchestration';
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
      ) VALUES
        (
          ${paymentWorkspaceId}::uuid, 'course_fence', 'Curso Fencing', 'course', 'active',
          'Offering canónico del test', 'fixed', 360, 'USD'
        ),
        (
          ${paymentWorkspaceId}::uuid, 'decoracion_interiores', 'Decoración de Interiores',
          'course', 'active', 'Offering canónico para g35_02', 'fixed', 360, 'USD'
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
      authorized_offering_code: 'course_fence',
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

  async function commitPaymentTurn(
    turnId: string,
    offeringSku: 'course_fence' | 'decoracion_interiores',
    planCode: 'monthly_12' | 'monthly_6',
    promptVersion: string,
  ) {
    return commitAgentDecision({
      turn_id: turnId,
      trace_id: randomUUID(),
      authorized_offering_code: offeringSku,
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: `Confirmado: ${planCode}.`,
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: planCode,
          offering_sku: offeringSku,
        },
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'PLAN_CHOSEN',
        confidence: 0.95,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: promptVersion },
    });
  }

  async function submitPayment(
    committed: Awaited<ReturnType<typeof commitAgentDecision>>,
    providerPrefix: string,
  ) {
    const deliveries = await sql<Array<{ attempt_count: number }>>`
      SELECT attempt_count FROM outbound_deliveries
      WHERE message_id = ${committed.outbound!.id}::uuid
    `;
    await recordDeliveryReport({
      outbound_id: committed.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `${providerPrefix}-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: deliveries[0].attempt_count,
    });
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

  it('projects Decoración/6 cuotas once across confirmation, delivery replay and a later repeated turn', async () => {
    const firstEnvelope = envelope('Confirmo 6 cuotas para Decoración de Interiores.');
    const firstContext = await processInboundMessage(firstEnvelope);
    const paymentInput = (turnId: string) => ({
      turn_id: turnId,
      trace_id: randomUUID(),
      authorized_offering_code: 'decoracion_interiores',
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: 'Perfecto, te paso el link del plan de 6 cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_6' as const,
          offering_sku: 'decoracion_interiores',
        },
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'PLAN_CHOSEN',
        confidence: 0.95,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-g35-02' },
    });
    const first = await commitAgentDecision(paymentInput(firstContext.turn_id));
    const deliveryRows = await sql<Array<{ attempt_count: number }>>`
      SELECT attempt_count FROM outbound_deliveries WHERE message_id = ${first.outbound!.id}::uuid
    `;
    const delivery = {
      outbound_id: first.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress' as const,
      botpress_message_id: `bp-g35-02-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: deliveryRows[0].attempt_count,
    };
    expect((await recordDeliveryReport(delivery)).status).toBe('recorded');
    expect((await recordDeliveryReport({ ...delivery, trace_id: randomUUID(), replayed: true })).status)
      .toBe('duplicate');
    await sql`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${firstContext.batch.id}::uuid
    `;

    const repeatedContext = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Confirmo nuevamente las 6 cuotas.',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const repeated = await commitAgentDecision(paymentInput(repeatedContext.turn_id));

    expect(first.outbound?.content).toContain('https://buy.stripe.com/test_6m_fence');
    expect(repeated.outbound?.content).toMatch(/revisá el mensaje anterior/i);
    expect(repeated.outbound?.content).not.toContain('https://buy.stripe.com/test_6m_fence');

    const counts = await sql<Array<{
      payment_actions: number;
      link_messages: number;
      sheet_rows: number;
      sheet_plan: string;
      sheet_course: string;
    }>>`
      SELECT
        count(DISTINCT ad.id) FILTER (
          WHERE ad.business_action ->> 'type' = 'send_payment_link'
        )::integer AS payment_actions,
        count(DISTINCT outbound.id) FILTER (
          WHERE outbound.content LIKE '%https://buy.stripe.com/test_6m_fence%'
        )::integer AS link_messages,
        count(DISTINCT spr.id)::integer AS sheet_rows,
        max(spr.payload ->> 'plan') AS sheet_plan,
        max(spr.payload ->> 'curso_interes') AS sheet_course
      FROM messages AS inbound
      LEFT JOIN agent_decisions AS ad ON ad.turn_id = inbound.id
      LEFT JOIN messages AS outbound ON outbound.id = ad.outbound_message_id
      LEFT JOIN sheet_projection_rows AS spr
        ON spr.projection_key = ${leadProjectionKey(paymentWorkspaceId, firstContext.contact.id)}
      WHERE inbound.conversation_id = ${firstContext.conversation_id}::uuid
        AND inbound.direction = 'inbound'
    `;
    expect(counts[0]).toEqual({
      payment_actions: 1,
      link_messages: 1,
      sheet_rows: 1,
      sheet_plan: 'monthly_6',
      sheet_course: 'Decoración de Interiores',
    });
  });

  it('serializes two concurrent new-turn confirmations into one payment action, link and projection', async () => {
    const firstEnvelope = envelope('Confirmo 6 cuotas para Decoración de Interiores.');
    const firstContext = await processInboundMessage(firstEnvelope);
    await sql`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${firstContext.batch.id}::uuid
    `;
    const secondContext = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        ...firstEnvelope.message,
        text: 'También confirmo las 6 cuotas.',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const input = (turnId: string) => ({
      turn_id: turnId,
      trace_id: randomUUID(),
      authorized_offering_code: 'decoracion_interiores',
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: 'Perfecto, te paso el link del plan de 6 cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_6' as const,
          offering_sku: 'decoracion_interiores',
        },
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'PLAN_CHOSEN',
        confidence: 0.95,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v-concurrent' },
    });

    const raceSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const raceFunction = `test_payment_race_${raceSuffix}`;
    const raceTrigger = `test_payment_race_t_${raceSuffix}`;
    await sql.unsafe(`
      CREATE FUNCTION public.${raceFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.prompt_version = 'v-concurrent' THEN
          PERFORM pg_sleep(0.15);
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER ${raceTrigger}
      BEFORE INSERT ON agent_decisions
      FOR EACH ROW EXECUTE FUNCTION public.${raceFunction}();
    `);
    let committed: Awaited<ReturnType<typeof commitAgentDecision>>[];
    try {
      committed = await Promise.all([
        commitAgentDecision(input(firstContext.turn_id)),
        commitAgentDecision(input(secondContext.turn_id)),
      ]);
    } finally {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS ${raceTrigger} ON agent_decisions;
        DROP FUNCTION IF EXISTS public.${raceFunction}();
      `);
    }
    const linkResult = committed.find((result) => result.outbound?.content.includes('test_6m_fence'))!;
    const ackResult = committed.find((result) => !result.outbound?.content.includes('test_6m_fence'))!;
    expect(linkResult).toBeDefined();
    expect(ackResult.outbound?.content).toMatch(/revisá el mensaje anterior/i);

    const deliveryRows = await sql<Array<{ attempt_count: number }>>`
      SELECT attempt_count FROM outbound_deliveries WHERE message_id = ${linkResult.outbound!.id}::uuid
    `;
    await recordDeliveryReport({
      outbound_id: linkResult.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-concurrent-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: deliveryRows[0].attempt_count,
    });

    const counts = await sql<Array<{ actions: number; links: number; rows: number }>>`
      SELECT
        count(DISTINCT ad.id) FILTER (
          WHERE ad.business_action ->> 'type' = 'send_payment_link'
        )::integer AS actions,
        count(DISTINCT outbound.id) FILTER (
          WHERE outbound.content LIKE '%https://buy.stripe.com/test_6m_fence%'
        )::integer AS links,
        count(DISTINCT spr.id)::integer AS rows
      FROM messages AS inbound
      LEFT JOIN agent_decisions AS ad ON ad.turn_id = inbound.id
      LEFT JOIN messages AS outbound ON outbound.id = ad.outbound_message_id
      LEFT JOIN sheet_projection_rows AS spr
        ON spr.projection_key = ${leadProjectionKey(paymentWorkspaceId, firstContext.contact.id)}
      WHERE inbound.conversation_id = ${firstContext.conversation_id}::uuid
        AND inbound.direction = 'inbound'
    `;
    expect(counts[0]).toEqual({ actions: 1, links: 1, rows: 1 });
  });

  it('keeps physical delivery evidence when projection crashes, then the automatic reconciler converges without resend', async () => {
    const turn = await seedPaymentTurn('Quiero pagar en 12 cuotas, crash atómico');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const functionName = `test_fail_sheet_projection_${suffix}`;
    const triggerName = `test_fail_sheet_projection_trigger_${suffix}`;
    const projectionKey = leadProjectionKey(paymentWorkspaceId, turn.contact_id);
    await sql.unsafe(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.projection_key = '${projectionKey}' THEN
          RAISE EXCEPTION 'INJECTED_PAYMENT_PROJECTION_FAILURE';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT OR UPDATE ON sheet_projection_rows
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
    `);
    const report = {
      outbound_id: turn.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress' as const,
      botpress_message_id: `bp-crash-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: turn.attempt,
    };

    try {
      expect((await recordDeliveryReport(report)).status).toBe('recorded');
      // The local cluster retains jobs from previous runs. Age only this test
      // job so the bounded pending index must acquire it in the first page.
      await sql`
        UPDATE payment_projection_jobs
        SET delivered_at = '2000-01-01T00:00:00Z'::timestamptz
        WHERE outbound_message_id = ${turn.outbound!.id}::uuid
      `;
      const afterFailure = await sql<Array<{ state: string; reports: number; rows: number }>>`
        SELECT
          od.state,
          count(DISTINCT dr.id)::integer AS reports,
          count(DISTINCT spr.id)::integer AS rows
        FROM outbound_deliveries AS od
        LEFT JOIN delivery_reports AS dr ON dr.delivery_id = od.id
        LEFT JOIN sheet_projection_rows AS spr ON spr.projection_key = ${projectionKey}
        WHERE od.message_id = ${turn.outbound!.id}::uuid
        GROUP BY od.state
      `;
      expect(afterFailure[0]).toEqual({ state: 'submitted', reports: 1, rows: 0 });
    } finally {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS ${triggerName} ON sheet_projection_rows;
        DROP FUNCTION IF EXISTS public.${functionName}();
      `);
    }

    const reconcileDeps = {
      store,
      reconcilePaymentProjections: reconcileDeliveredPaymentProjections,
    };
    const firstSweep = await reconcileOrchestration(
      { trace_id: randomUUID(), grace_seconds: 60 },
      reconcileDeps,
    );
    const targetAfterFirst = await sql<Array<{
      id: string;
      payload_hash: string;
      updated_at: string;
    }>>`
      SELECT id, payload_hash, updated_at::text
      FROM sheet_projection_rows
      WHERE projection_key = ${projectionKey}
    `;
    const secondSweep = await reconcileOrchestration(
      { trace_id: randomUUID(), grace_seconds: 60 },
      reconcileDeps,
    );
    const targetAfterSecond = await sql<Array<{
      id: string;
      payload_hash: string;
      updated_at: string;
    }>>`
      SELECT id, payload_hash, updated_at::text
      FROM sheet_projection_rows
      WHERE projection_key = ${projectionKey}
    `;
    expect(firstSweep.payment_projections.repaired).toBeGreaterThanOrEqual(1);
    expect(secondSweep.payment_projections.failed).toBe(0);
    expect(targetAfterSecond).toEqual(targetAfterFirst);
    expect(await projectionRows(turn.contact_id)).toHaveLength(1);

    const durable = await sql<Array<{
      state: string;
      provider_message_id: string | null;
      reports: number;
      outbounds: number;
      rows: number;
    }>>`
      SELECT
        od.state,
        od.provider_message_id,
        count(DISTINCT dr.id)::integer AS reports,
        count(DISTINCT outbound.id)::integer AS outbounds,
        count(DISTINCT spr.id)::integer AS rows
      FROM outbound_deliveries AS od
      JOIN messages AS outbound ON outbound.id = od.message_id
      LEFT JOIN delivery_reports AS dr ON dr.delivery_id = od.id
      LEFT JOIN sheet_projection_rows AS spr ON spr.projection_key = ${projectionKey}
      WHERE od.message_id = ${turn.outbound!.id}::uuid
      GROUP BY od.state, od.provider_message_id
    `;
    expect(durable[0]).toEqual({
      state: 'submitted',
      provider_message_id: report.botpress_message_id,
      reports: 1,
      outbounds: 1,
      rows: 1,
    });
  });

  it('never projects a foreign workspace payment or its contact PII into the configured tenant', async () => {
    const foreignSlug = `foreign-payment-${randomUUID().slice(0, 8)}`;
    const foreign = await sql<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${foreignSlug}, 'Foreign Payment Workspace')
      RETURNING id
    `;
    await sql`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency
      ) VALUES (
        ${foreign[0].id}::uuid, 'course_fence', 'Foreign Secret Course', 'course',
        'active', 'Must never cross the tenant boundary', 'fixed', 999, 'USD'
      )
    `;

    process.env.BUSINESS_WORKSPACE_SLUG = foreignSlug;
    try {
      const context = await processInboundMessage(envelope('Confirmo 12 cuotas del curso extranjero.'));
      const committed = await commitPaymentTurn(
        context.turn_id,
        'course_fence',
        'monthly_12',
        'v-foreign-workspace',
      );
      await sql`
        INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status)
        VALUES (${foreign[0].id}::uuid, ${context.contact.id}::uuid, 'active')
        ON CONFLICT (workspace_id, contact_id) DO NOTHING
      `;
      await submitPayment(committed, 'bp-foreign');

      await sql`
        UPDATE agent_decisions
        SET created_at = '1990-01-01T00:00:00Z'::timestamptz
        WHERE id = ${committed.decision_id}::uuid
      `;
      process.env.BUSINESS_WORKSPACE_SLUG = PAYMENT_WORKSPACE_SLUG;
      await reconcileDeliveredPaymentProjections({ limit: 100 });

      const leaked = await sql<Array<{ payload: Record<string, unknown> }>>`
        SELECT payload FROM sheet_projection_rows
        WHERE projection_key = ${leadProjectionKey(paymentWorkspaceId, context.contact.id)}
      `;
      expect(leaked).toHaveLength(0);
    } finally {
      process.env.BUSINESS_WORKSPACE_SLUG = PAYMENT_WORKSPACE_SLUG;
    }
  });

  it('keeps only the latest delivered proposal authoritative across repeated sweeps', async () => {
    const firstEnvelope = envelope('Confirmo 12 cuotas para Curso Fencing.');
    const firstContext = await processInboundMessage(firstEnvelope);
    const first = await commitPaymentTurn(
      firstContext.turn_id,
      'course_fence',
      'monthly_12',
      'v-history-a',
    );
    await submitPayment(first, 'bp-history-a');
    await sql`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${firstContext.batch.id}::uuid
    `;

    const secondContext = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        ...firstEnvelope.message,
        text: 'Ahora elijo 6 cuotas para Decoración de Interiores.',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const second = await commitPaymentTurn(
      secondContext.turn_id,
      'decoracion_interiores',
      'monthly_6',
      'v-history-b',
    );
    await submitPayment(second, 'bp-history-b');

    await sql`
      UPDATE agent_decisions
      SET created_at = CASE id
        WHEN ${first.decision_id}::uuid THEN '1991-01-01T00:00:00Z'::timestamptz
        ELSE '1992-01-01T00:00:00Z'::timestamptz
      END
      WHERE id IN (${first.decision_id}::uuid, ${second.decision_id}::uuid)
    `;

    const sweep = async () => {
      await reconcileDeliveredPaymentProjections({ limit: 100 });
      const rows = await sql<Array<{
        id: string;
        payload_hash: string;
        updated_at: string;
        payload: Record<string, unknown>;
      }>>`
        SELECT id, payload_hash, updated_at::text, payload
        FROM sheet_projection_rows
        WHERE projection_key = ${leadProjectionKey(paymentWorkspaceId, firstContext.contact.id)}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({
        plan: 'monthly_6',
        curso_interes: 'Decoración de Interiores',
      });
      return rows[0];
    };

    const afterFirstSweep = await sweep();
    const afterSecondSweep = await sweep();
    expect(afterSecondSweep).toEqual(afterFirstSweep);
  });

  it('has a bounded pending-job index instead of scanning payment JSON history', async () => {
    const indexes = await sql<Array<{ index_name: string | null }>>`
      SELECT to_regclass('public.payment_projection_jobs_pending_idx')::text AS index_name
    `;
    expect(indexes[0].index_name).toBe('payment_projection_jobs_pending_idx');
  });

  it('reports missing Sheets configuration explicitly instead of ambiguous zero counts', async () => {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const tabName = process.env.GOOGLE_SHEETS_TAB_NAME;
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    delete process.env.GOOGLE_SHEETS_TAB_NAME;
    try {
      const result = await reconcileDeliveredPaymentProjections();
      expect(result).toMatchObject({
        status: 'disabled',
        reason: 'SHEETS_NOT_CONFIGURED',
      });
    } finally {
      if (spreadsheetId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
      if (tabName === undefined) delete process.env.GOOGLE_SHEETS_TAB_NAME;
      else process.env.GOOGLE_SHEETS_TAB_NAME = tabName;
    }
  });

  it('distinguishes absent workspace configuration from invalid configuration', async () => {
    const workspaceSlug = process.env.BUSINESS_WORKSPACE_SLUG;
    try {
      delete process.env.BUSINESS_WORKSPACE_SLUG;
      await expect(reconcileDeliveredPaymentProjections()).resolves.toMatchObject({
        status: 'disabled',
        reason: 'WORKSPACE_NOT_CONFIGURED',
      });

      process.env.BUSINESS_WORKSPACE_SLUG = 'INVALID WORKSPACE!';
      await expect(reconcileDeliveredPaymentProjections()).resolves.toMatchObject({
        status: 'error',
        reason: 'WORKSPACE_CONFIG_INVALID',
      });
    } finally {
      if (workspaceSlug === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
      else process.env.BUSINESS_WORKSPACE_SLUG = workspaceSlug;
    }
  });
});
