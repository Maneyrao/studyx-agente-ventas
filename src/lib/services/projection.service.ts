import type postgres from 'postgres';
import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { loadBusinessWorkspaceConfig, loadSheetsProjectionConfig } from '@/lib/config';
import { jsonbParam } from '@/lib/db/json';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { logger } from '@/lib/observability/structured-log';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import { createSandboxLookup } from '@/lib/repositories/sandbox-identity.repository';
import { GoogleSheetsProvider } from '@/lib/providers/sheets/google-sheets-provider';
import type { SheetRowValues, SheetsProvider } from '@/lib/providers/sheets/sheets-provider';
import { runDeadlineQuery, WorkerDeadline, WorkerDeadlineExceeded } from './durable-worker-deadline';
import { leadProjectionKey } from '@/features/payments/domain/payment-report-projection';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
} from '@/features/payments/domain/payment-link';

export { leadProjectionKey };

/**
 * Enqueue/flush primitives for the Google Sheets projection
 * (docs/contracts/agent-a-operational-mvp.md §5).
 *
 * PostgreSQL's `sheet_projection_rows` is the outbox and the source of
 * truth; Sheets is a derived, operator-facing view. `enqueueLeadProjection`
 * upserts one row per `lead:<workspace_id>:<contact_id>` and reserves a
 * stable `row_number` the first time a lead is seen. `flushSheetProjections`
 * is the leased worker (same claim/lease/backoff shape as
 * `knowledge-projection.service.ts`) that performs the single
 * `spreadsheets.values.update` per row; a Google failure leaves the row
 * pending/retryable and never throws into the caller.
 *
 * Timing: first contact and identity enrichment enqueue the stable lead row;
 * later commercial and payment signals merge into it. Google network I/O is
 * always performed by the leased worker, never inside a canonical transaction.
 */

const MAX_ROW_RESERVE_ATTEMPTS = 8;
const MAX_BACKOFF_SECONDS = 3600;
const MAX_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 45;
const DEFAULT_DEADLINE_MS = 45_000;
const MIN_OPERATION_BUDGET_MS = 25;



export interface LeadProjectionInput {
  workspaceId: string;
  contactId: string;
  spreadsheetId: string;
  tabName: string;
  /** Monotonic inbound message sequence; never part of the visible row. */
  sourceOrder?: number;
  /** Stable trusted producer identity; never part of the visible row. */
  sourceKey?: string;
  /** Channel-derived or customer-declared phone shown in the operator row. */
  telefono?: string;
  fechaIngreso?: string;
  horaInicio?: string;
  campana?: string;
  anuncio?: string;
  /**
   * Canonical application names remain compatible with the existing callers.
   * They are persisted as `nombre`, `apellido`, and visible `mail`.
   */
  nombre?: string;
  apellido?: string;
  email?: string;
  /** `cursoInteres` is persisted as visible `tipo_de_curso`. */
  etapaComercial?: string;
  cursoInteres?: string;
  plan?: string;
  /** Charged amount shown to operators; never model-authored. */
  monto?: string;
  /** Only true after a trusted payment provider confirms the charge. */
  pagoVerificado?: boolean;
  estadoPago?: string;
  fechaPago?: string;
  callId?: string;
  ultimaSenal: string;
  traceId: string;
}

export interface EnqueueLeadProjectionResult {
  id: string;
  rowNumber: number;
  changed: boolean;
}

export type EnqueueCompleteLeadProjectionResult = EnqueueLeadProjectionResult | null;

interface ExistingRow {
  id: string;
  row_number: number;
  source_order: string | number;
  source_key: string | null;
  payload: Partial<SheetRowValues> & {
    /** Legacy aliases read only so an existing row converges to the current CRM contract. */
    email?: string;
    curso_interes?: string;
  };
}

function amountLabelForPlan(plan: string | undefined): string {
  if (!isPaymentPlanCode(plan)) return '';
  const presentation = PAYMENT_PLAN_PRESENTATIONS[plan];
  return `${presentation.currency} ${presentation.installment_amount}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function backoffSeconds(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, attemptCount - 1));
}

function hasStableLeadIdentity(values: SheetRowValues): boolean {
  return values.telefono.trim().length > 0;
}

function sourceOrder(input: LeadProjectionInput): number | null {
  if (input.sourceOrder === undefined) return null;
  const value = input.sourceOrder;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_LEAD_PROJECTION_SOURCE_ORDER');
  return value;
}

function sourceKey(input: LeadProjectionInput, inputSourceOrder: number | null): string | null {
  if (input.sourceKey === undefined) return null;
  const value = input.sourceKey.trim();
  if (inputSourceOrder === null || value.length === 0 || value.length > 256) {
    throw new Error('INVALID_LEAD_PROJECTION_SOURCE_KEY');
  }
  return value;
}

/** Agent A occupies the even positions in the shared A/B projection order. */
export function agentALeadProjectionSourceOrder(inboundSourceOrder: number): number {
  if (
    !Number.isSafeInteger(inboundSourceOrder)
    || inboundSourceOrder < 0
    || inboundSourceOrder > Math.floor(Number.MAX_SAFE_INTEGER / 2)
  ) {
    throw new Error('INVALID_LEAD_PROJECTION_SOURCE_ORDER');
  }
  return inboundSourceOrder * 2;
}

/** Agent B is ordered immediately after the Agent A turn that opened its call. */
export function agentBLeadProjectionSourceOrder(callSourceOrder: number): number {
  if (
    !Number.isSafeInteger(callSourceOrder)
    || callSourceOrder < 0
    || callSourceOrder > Math.floor(Number.MAX_SAFE_INTEGER / 2)
  ) {
    throw new Error('INVALID_LEAD_PROJECTION_SOURCE_ORDER');
  }
  return callSourceOrder * 2 + 1;
}

/**
 * Idempotent upsert of the single outbox row for one lead.
 *
 * The persisted payload is deliberately the thirteen visible A:M values only.
 * Optional canonical input values merge with the existing row so a later
 * correction updates the same row without erasing another captured value.
 *
 * `row_number` is reserved once, on first insert, as
 * `MAX(row_number in this spreadsheet+tab) + 1`. A transaction-scoped lock
 * serializes allocators for that target; a savepoint keeps the transaction
 * usable if a mixed-version writer still causes a unique-violation retry.
 */
export async function enqueueLeadProjection(
  input: LeadProjectionInput,
  deps: { sql?: DbClient } = {},
): Promise<EnqueueCompleteLeadProjectionResult> {
  const sql = deps.sql ?? orchestratorSql;
  if ('begin' in sql && typeof sql.begin === 'function') {
    return sql.begin((tx) => enqueueLeadProjectionInTransaction(input, tx));
  }
  return enqueueLeadProjectionInTransaction(input, sql as postgres.TransactionSql);
}

async function enqueueLeadProjectionInTransaction(
  input: LeadProjectionInput,
  sql: postgres.TransactionSql,
): Promise<EnqueueCompleteLeadProjectionResult> {
  const projectionKey = leadProjectionKey(input.workspaceId, input.contactId);
  const inputSourceOrder = sourceOrder(input);
  const inputSourceKey = sourceKey(input, inputSourceOrder);
  const hasOrderingProof = inputSourceOrder !== null;
  const persistedSourceOrder = inputSourceOrder ?? 0;

  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${JSON.stringify([input.spreadsheetId, input.tabName])}, 0)
    )
  `;

  for (let attempt = 0; attempt < MAX_ROW_RESERVE_ATTEMPTS; attempt++) {
    const existingRows = await sql<ExistingRow[]>`
      SELECT id, row_number, source_order, source_key, payload
      FROM sheet_projection_rows
      WHERE projection_key = ${projectionKey}
    `;
    const existing = existingRows[0];

    const values: SheetRowValues = {
      fecha_ingreso: input.fechaIngreso ?? existing?.payload.fecha_ingreso ?? '',
      hora_inicio: input.horaInicio ?? existing?.payload.hora_inicio ?? '',
      nombre: input.nombre ?? existing?.payload.nombre ?? '',
      apellido: input.apellido ?? existing?.payload.apellido ?? '',
      telefono: input.telefono ?? existing?.payload.telefono ?? '',
      mail: input.email ?? existing?.payload.mail ?? existing?.payload.email ?? '',
      campana: input.campana ?? existing?.payload.campana ?? '',
      anuncio: input.anuncio ?? existing?.payload.anuncio ?? '',
      tipo_de_curso: input.cursoInteres
        ?? existing?.payload.tipo_de_curso
        ?? existing?.payload.curso_interes
        ?? '',
      plan: input.plan ?? existing?.payload.plan ?? '',
      monto: nonEmpty(input.monto)
        ?? (input.plan ? amountLabelForPlan(input.plan) : undefined)
        ?? nonEmpty(existing?.payload.monto)
        ?? amountLabelForPlan(existing?.payload.plan),
      pago: input.pagoVerificado === true
        ? 'Sí'
        : existing?.payload.pago ?? 'No',
      fecha_venta: input.fechaPago ?? existing?.payload.fecha_venta ?? '',
    };
    if (!hasStableLeadIdentity(values)) return null;
    const payloadHash = sha256Hex(values);

    if (existing) {
      const existingSourceOrder = Number(existing.source_order);
      if (!Number.isSafeInteger(existingSourceOrder) || existingSourceOrder < 0) {
        throw new Error('INVALID_STORED_LEAD_PROJECTION_SOURCE_ORDER');
      }
      if (
        (hasOrderingProof && existingSourceOrder > persistedSourceOrder)
        || (hasOrderingProof
          && existingSourceOrder === persistedSourceOrder
          && (
            existing.payload && sha256Hex(existing.payload) === payloadHash
            || inputSourceKey === null
            || existing.source_key !== inputSourceKey
          ))
        || (!hasOrderingProof && (
          existingSourceOrder > 0
          || (existing.payload && sha256Hex(existing.payload) === payloadHash)
        ))
      ) {
        return { id: existing.id, rowNumber: existing.row_number, changed: false };
      }
      const updated = await sql<Array<{ id: string; row_number: number }>>`
        UPDATE sheet_projection_rows
        SET payload = ${jsonbParam(sql, values)},
            payload_hash = ${payloadHash},
            source_order = CASE WHEN ${hasOrderingProof}
              THEN ${persistedSourceOrder} ELSE source_order END,
            source_key = CASE WHEN ${hasOrderingProof}
              THEN ${inputSourceKey}::text ELSE source_key END,
            state = 'pending',
            available_at = now(),
            attempt_count = 0,
            lease_until = NULL,
            leased_by = NULL,
            error_code = NULL,
            projected_at = NULL
        WHERE id = ${existing.id}
          AND (
            (${hasOrderingProof} AND (
              source_order < ${persistedSourceOrder}
              OR (
                source_order = ${persistedSourceOrder}
                AND ${inputSourceKey}::text IS NOT NULL
                AND source_key = ${inputSourceKey}::text
              )
            ))
            OR (NOT ${hasOrderingProof} AND source_order = 0)
          )
        RETURNING id, row_number
      `;
      if (updated[0]) return { id: updated[0].id, rowNumber: updated[0].row_number, changed: true };
      return { id: existing.id, rowNumber: existing.row_number, changed: false };
    }

    try {
      const inserted = await sql.savepoint((savepoint) => savepoint<Array<{
        id: string;
        row_number: number;
      }>>`
          INSERT INTO sheet_projection_rows (
            projection_key, workspace_id, projection_type, spreadsheet_id, tab_name,
            row_number, payload, payload_hash, source_order, source_key, state
          )
          SELECT
            ${projectionKey},
            ${input.workspaceId}::uuid,
            'lead',
            ${input.spreadsheetId},
            ${input.tabName},
            COALESCE(MAX(row_number), 1) + 1,
            ${jsonbParam(savepoint, values)},
            ${payloadHash},
            ${persistedSourceOrder},
            ${inputSourceKey},
            'pending'
          FROM sheet_projection_rows
          WHERE spreadsheet_id = ${input.spreadsheetId} AND tab_name = ${input.tabName}
          RETURNING id, row_number
        `);
      return { id: inserted[0].id, rowNumber: inserted[0].row_number, changed: true };
    } catch (error) {
      const pg = getPostgresError(error);
      // Lost a race on projection_key (concurrent first enqueue for the same
      // lead) or on the reserved row_number (concurrent first enqueue for a
      // different lead in the same spreadsheet+tab): re-read and retry.
      if (pg?.code === '23505') continue;
      throw error;
    }
  }
  throw new Error('ENQUEUE_LEAD_PROJECTION_RETRY_EXHAUSTED');
}

export interface InboundLeadProjectionInput {
  contactId: string;
  phone: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  traceId: string;
}

function attributionLabels(metadata: Record<string, unknown> | null | undefined): {
  campana?: string;
  anuncio?: string;
} {
  const attribution = metadata?.attribution;
  if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)) return {};
  const first = (attribution as Record<string, unknown>).first_touch;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return {};
  const touch = first as Record<string, unknown>;
  const value = (...keys: string[]) => keys
    .map((key) => touch[key])
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '');
  return {
    campana: value('campaign_name', 'utm_campaign', 'campaign_id', 'source_id'),
    anuncio: value('ad_name', 'utm_content', 'headline', 'ad_id', 'source_id'),
  };
}

export interface CommittedLeadStateProjectionInput {
  messageId: string;
  traceId: string;
}

export interface VerifiedPaymentProjectionInput {
  paymentId: string;
  traceId: string;
}

/**
 * Creates the operator-facing lead row as soon as the channel phone is known,
 * then enriches that same stable row as identity and commercial facts arrive.
 * PostgreSQL remains authoritative.
 */
export async function upsertInboundLeadProjection(
  input: InboundLeadProjectionInput,
  deps: {
    sql?: DbClient;
    loadSheetsConfig?: typeof loadSheetsProjectionConfig;
    loadWorkspaceConfig?: typeof loadBusinessWorkspaceConfig;
  } = {},
): Promise<'created_or_updated' | 'skipped'> {
  const db = deps.sql ?? orchestratorSql;
  try {
    const sheets = (deps.loadSheetsConfig ?? loadSheetsProjectionConfig)();
    if (!sheets) return 'skipped';
    const workspaceSlug = (deps.loadWorkspaceConfig ?? loadBusinessWorkspaceConfig)().workspaceSlug;
    const workspaceRows = await db<Array<{
      id: string;
      fecha_ingreso: string;
      hora_inicio: string;
      metadata: Record<string, unknown>;
    }>>`
      SELECT workspace.id,
             to_char(COALESCE(membership.created_at, now()) AT TIME ZONE workspace.timezone, 'DD/MM/YYYY') AS fecha_ingreso,
             to_char(COALESCE(membership.created_at, now()) AT TIME ZONE workspace.timezone, 'HH24:MI') AS hora_inicio,
             COALESCE(membership.metadata, '{}'::jsonb) AS metadata
      FROM workspaces AS workspace
      LEFT JOIN workspace_contacts AS membership
        ON membership.workspace_id = workspace.id
       AND membership.contact_id = ${input.contactId}::uuid
      WHERE workspace.slug = ${workspaceSlug} AND workspace.status = 'active'
      LIMIT 1
    `;
    const workspace = workspaceRows[0];
    if (!workspace) return 'skipped';
    const labels = attributionLabels(workspace.metadata);

    const projected = await enqueueLeadProjection(
      {
        workspaceId: workspace.id,
        contactId: input.contactId,
        spreadsheetId: sheets.spreadsheetId,
        tabName: sheets.tabName,
        telefono: input.phone,
        fechaIngreso: workspace.fecha_ingreso,
        horaInicio: workspace.hora_inicio,
        campana: labels.campana,
        anuncio: labels.anuncio,
        nombre: input.nombre,
        apellido: input.apellido,
        email: input.email,
        ultimaSenal: 'inbound_lead_updated',
        traceId: input.traceId,
      },
      { sql: db },
    );
    return projected ? 'created_or_updated' : 'skipped';
  } catch (error) {
    logger.warn({
      event: 'projection.inbound_lead_upsert_failed',
      trace_id: input.traceId,
      contact_id: input.contactId,
      error: String(error),
    });
    return 'skipped';
  }
}

/**
 * Enriches the stable CRM row from commercial state that is already durable.
 * This deliberately runs after the decision transaction commits: the Sheet
 * must never show a course, plan or stage that PostgreSQL later rolled back.
 */
export async function upsertCommittedLeadStateProjection(
  input: CommittedLeadStateProjectionInput,
  deps: {
    sql?: DbClient;
    loadSheetsConfig?: typeof loadSheetsProjectionConfig;
    loadWorkspaceConfig?: typeof loadBusinessWorkspaceConfig;
  } = {},
): Promise<'created_or_updated' | 'skipped'> {
  const db = deps.sql ?? orchestratorSql;
  try {
    const sheets = (deps.loadSheetsConfig ?? loadSheetsProjectionConfig)();
    if (!sheets) return 'skipped';
    const workspaceSlug = (deps.loadWorkspaceConfig ?? loadBusinessWorkspaceConfig)().workspaceSlug;
    const rows = await db<Array<{
      workspace_id: string;
      contact_id: string;
      phone: string;
      declared_phone: string | null;
      name: string | null;
      email: string | null;
      stage: string;
      selected_offering_code: string | null;
      selected_payment_plan: string | null;
      offering_name: string | null;
      offering_names: string | null;
      fecha_ingreso: string;
      hora_inicio: string;
      fecha_venta: string | null;
      membership_metadata: Record<string, unknown>;
      delivery_state: string | null;
      has_deferred_lead_projection: boolean;
    }>>`
      SELECT
        state.workspace_id,
        state.contact_id,
        contact.phone,
        contact.declared_phone,
        contact.name,
        contact.email,
        state.stage,
        state.selected_offering_code,
        state.selected_payment_plan,
        offering.display_name AS offering_name,
        interests.offering_names,
        to_char(COALESCE(membership.created_at, state.created_at) AT TIME ZONE workspace.timezone, 'DD/MM/YYYY') AS fecha_ingreso,
        to_char(COALESCE(membership.created_at, state.created_at) AT TIME ZONE workspace.timezone, 'HH24:MI') AS hora_inicio,
        paid.fecha_venta,
        COALESCE(membership.metadata, '{}'::jsonb) AS membership_metadata,
        delivery.state AS delivery_state,
        (delivery.deferred_lead_projection IS NOT NULL) AS has_deferred_lead_projection
      FROM messages AS message
      JOIN conversation_sales_context_states_v1 AS state
        ON state.conversation_id = message.conversation_id
       AND state.contact_id = message.contact_id
      JOIN workspaces AS workspace
        ON workspace.id = state.workspace_id
       AND workspace.slug = ${workspaceSlug}
       AND workspace.status = 'active'
      JOIN contacts AS contact ON contact.id = state.contact_id
      LEFT JOIN workspace_contacts AS membership
        ON membership.workspace_id = state.workspace_id
       AND membership.contact_id = state.contact_id
      LEFT JOIN offerings AS offering
        ON offering.workspace_id = state.workspace_id
       AND offering.code = state.selected_offering_code
      LEFT JOIN LATERAL (
        SELECT string_agg(item.display_name, ', ' ORDER BY interest.first_seen_at) AS offering_names
        FROM lead_course_interests AS interest
        JOIN offerings AS item
          ON item.workspace_id = interest.workspace_id AND item.code = interest.offering_code
        WHERE interest.workspace_id = state.workspace_id AND interest.contact_id = state.contact_id
      ) AS interests ON true
      LEFT JOIN LATERAL (
        SELECT to_char(MIN(payment.paid_at) AT TIME ZONE workspace.timezone, 'DD/MM/YYYY') AS fecha_venta
        FROM payments AS payment
        WHERE payment.workspace_id = state.workspace_id
          AND payment.contact_id = state.contact_id
          AND payment.status IN ('paid', 'refunded')
      ) AS paid ON true
      LEFT JOIN agent_decisions AS decision
        ON decision.turn_id = CASE
          WHEN message.direction = 'inbound' THEN message.id
          ELSE message.in_reply_to
        END
      LEFT JOIN outbound_deliveries AS delivery
        ON delivery.message_id = decision.outbound_message_id
      WHERE message.id = ${input.messageId}::uuid
        AND contact.deleted_at IS NULL
        AND COALESCE(contact.lifecycle_status, 'active') = 'active'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return 'skipped';
    // Agent Turn V3 owns a richer, delivery-fenced projection payload. Its
    // deferred projection is applied after the provider accepts the outbound;
    // a generic refresh here would immediately overwrite that stronger signal.
    if (row.has_deferred_lead_projection) return 'skipped';
    const identity = row.name ? splitFullName(row.name) : null;
    const delivered = row.delivery_state === 'submitted' || row.delivery_state === 'delivered';
    const projectedStage = row.stage === 'payment_link_sent' && !delivered
      ? 'plan_selected'
      : row.stage;
    const labels = attributionLabels(row.membership_metadata);
    const projected = await enqueueLeadProjection({
      workspaceId: row.workspace_id,
      contactId: row.contact_id,
      spreadsheetId: sheets.spreadsheetId,
      tabName: sheets.tabName,
      telefono: row.declared_phone ?? row.phone,
      fechaIngreso: row.fecha_ingreso,
      horaInicio: row.hora_inicio,
      campana: labels.campana,
      anuncio: labels.anuncio,
      nombre: identity?.nombre,
      apellido: identity?.apellido,
      email: row.email ?? undefined,
      etapaComercial: projectedStage,
      cursoInteres: row.offering_names ?? row.offering_name ?? row.selected_offering_code ?? undefined,
      plan: row.selected_payment_plan ?? undefined,
      fechaPago: row.fecha_venta ?? undefined,
      ultimaSenal: 'commercial_state_updated',
      traceId: input.traceId,
    }, { sql: db });
    return projected ? 'created_or_updated' : 'skipped';
  } catch (error) {
    logger.warn({
      event: 'projection.committed_lead_state_upsert_failed',
      trace_id: input.traceId,
      message_id: input.messageId,
      error: String(error),
    });
    return 'skipped';
  }
}

/**
 * Projects a provider-verified payment onto the lead's existing stable row.
 * This is intentionally separate from conversational ordering: a Stripe
 * confirmation owns only `monto` and `pago` and must not erase newer identity
 * or sales data captured by either agent.
 */
export async function upsertVerifiedPaymentProjection(
  input: VerifiedPaymentProjectionInput,
  deps: {
    sql?: DbClient;
    loadSheetsConfig?: typeof loadSheetsProjectionConfig;
  } = {},
): Promise<'created_or_updated' | 'skipped'> {
  const db = deps.sql ?? orchestratorSql;
  try {
    const sheets = (deps.loadSheetsConfig ?? loadSheetsProjectionConfig)();
    if (!sheets) return 'skipped';
    const rows = await db<Array<{
      workspace_id: string;
      contact_id: string;
      phone: string;
      declared_phone: string | null;
      name: string | null;
      email: string | null;
      offering_name: string;
      plan_code: string | null;
      amount: string;
      currency: string;
      status: string;
      offering_names: string | null;
      fecha_ingreso: string;
      hora_inicio: string;
      fecha_venta: string | null;
      membership_metadata: Record<string, unknown>;
    }>>`
      SELECT
        payment.workspace_id,
        payment.contact_id,
        contact.phone,
        contact.declared_phone,
        contact.name,
        contact.email,
        offering.display_name AS offering_name,
        payment.plan_code,
        payment.amount::text AS amount,
        payment.currency,
        payment.status
        , interests.offering_names
        , to_char(COALESCE(membership.created_at, payment.created_at) AT TIME ZONE workspace.timezone, 'DD/MM/YYYY') AS fecha_ingreso
        , to_char(COALESCE(membership.created_at, payment.created_at) AT TIME ZONE workspace.timezone, 'HH24:MI') AS hora_inicio
        , to_char(first_paid.paid_at AT TIME ZONE workspace.timezone, 'DD/MM/YYYY') AS fecha_venta
        , COALESCE(membership.metadata, '{}'::jsonb) AS membership_metadata
      FROM payments AS payment
      JOIN contacts AS contact ON contact.id = payment.contact_id
      JOIN offerings AS offering ON offering.id = payment.offering_id
      JOIN workspaces AS workspace ON workspace.id = payment.workspace_id
      LEFT JOIN workspace_contacts AS membership
        ON membership.workspace_id = payment.workspace_id AND membership.contact_id = payment.contact_id
      LEFT JOIN LATERAL (
        SELECT string_agg(item.display_name, ', ' ORDER BY interest.first_seen_at) AS offering_names
        FROM lead_course_interests AS interest
        JOIN offerings AS item
          ON item.workspace_id = interest.workspace_id AND item.code = interest.offering_code
        WHERE interest.workspace_id = payment.workspace_id AND interest.contact_id = payment.contact_id
      ) AS interests ON true
      LEFT JOIN LATERAL (
        SELECT MIN(other.paid_at) AS paid_at
        FROM payments AS other
        WHERE other.workspace_id = payment.workspace_id
          AND other.contact_id = payment.contact_id
          AND other.status IN ('paid', 'refunded')
      ) AS first_paid ON true
      WHERE payment.id = ${input.paymentId}::uuid
      LIMIT 1
    `;
    const payment = rows[0];
    if (!payment || payment.status !== 'paid') return 'skipped';
    const identity = payment.name ? splitFullName(payment.name) : null;
    const labels = attributionLabels(payment.membership_metadata);
    const projectionKey = leadProjectionKey(payment.workspace_id, payment.contact_id);

    const applyVerifiedPayment = async (tx: postgres.TransactionSql) => {
      const existingRows = await tx<ExistingRow[]>`
        SELECT id, row_number, source_order, source_key, payload
        FROM sheet_projection_rows
        WHERE projection_key = ${projectionKey}
        FOR UPDATE
      `;
      const existing = existingRows[0];
      const monto = `${payment.currency.toUpperCase()} ${Number(payment.amount).toFixed(2)}`;
      if (!existing) {
        await enqueueLeadProjectionInTransaction({
          workspaceId: payment.workspace_id,
          contactId: payment.contact_id,
          spreadsheetId: sheets.spreadsheetId,
          tabName: sheets.tabName,
          telefono: payment.declared_phone ?? payment.phone,
          fechaIngreso: payment.fecha_ingreso,
          horaInicio: payment.hora_inicio,
          campana: labels.campana,
          anuncio: labels.anuncio,
          nombre: identity?.nombre,
          apellido: identity?.apellido,
          email: payment.email ?? undefined,
          cursoInteres: payment.offering_names ?? payment.offering_name,
          plan: payment.plan_code ?? 'Prueba Stripe',
          monto,
          pagoVerificado: true,
          fechaPago: payment.fecha_venta ?? undefined,
          ultimaSenal: 'stripe_payment_verified',
          traceId: input.traceId,
        }, tx);
        return;
      }

      const values: SheetRowValues = {
        fecha_ingreso: existing.payload.fecha_ingreso ?? payment.fecha_ingreso,
        hora_inicio: existing.payload.hora_inicio ?? payment.hora_inicio,
        nombre: existing.payload.nombre ?? identity?.nombre ?? '',
        apellido: existing.payload.apellido ?? identity?.apellido ?? '',
        telefono: existing.payload.telefono ?? payment.declared_phone ?? payment.phone,
        mail: existing.payload.mail ?? existing.payload.email ?? payment.email ?? '',
        campana: existing.payload.campana ?? labels.campana ?? '',
        anuncio: existing.payload.anuncio ?? labels.anuncio ?? '',
        tipo_de_curso: payment.offering_names
          ?? existing.payload.tipo_de_curso
          ?? existing.payload.curso_interes
          ?? payment.offering_name,
        plan: existing.payload.plan ?? payment.plan_code ?? 'Prueba Stripe',
        monto,
        pago: 'Sí',
        fecha_venta: payment.fecha_venta ?? existing.payload.fecha_venta ?? '',
      };
      await tx`
        UPDATE sheet_projection_rows
        SET payload = ${jsonbParam(tx, values)},
            payload_hash = ${sha256Hex(values)},
            state = 'pending',
            available_at = now(),
            attempt_count = 0,
            lease_until = NULL,
            leased_by = NULL,
            error_code = NULL,
            projected_at = NULL
        WHERE id = ${existing.id}
      `;
    };
    if ('begin' in db && typeof db.begin === 'function') {
      await db.begin((tx) => applyVerifiedPayment(tx));
    } else {
      await applyVerifiedPayment(db as postgres.TransactionSql);
    }
    return 'created_or_updated';
  } catch (error) {
    logger.warn({
      event: 'projection.verified_payment_upsert_failed',
      trace_id: input.traceId,
      payment_id: input.paymentId,
      error: String(error).slice(0, 500),
    });
    return 'skipped';
  }
}

export interface FlushSheetProjectionsInput {
  worker_id: string;
  limit?: number;
  lease_seconds?: number;
  deadline_ms?: number;
}

export interface FlushSheetProjectionsResult {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  lease_lost?: number;
  deadline_reached?: boolean;
}

interface ClaimedRow {
  id: string;
  workspace_id: string;
  projection_key: string;
  spreadsheet_id: string;
  tab_name: string;
  row_number: number;
  payload: SheetRowValues;
  attempt_count: number;
  max_attempts: number;
}

function contactIdFromLeadProjectionKey(projectionKey: string): string {
  const [, workspaceId, contactId] = projectionKey.split(':');
  return workspaceId && contactId ? contactId : '';
}

export interface FlushSheetProjectionsDeps {
  sql?: DbClient;
  provider?: SheetsProvider;
}

/** Requeues rows from any older Sheet layout in place; identity and row_number stay unchanged. */
async function requeueLegacyLeadRows(sql: DbClient, limit: number): Promise<number> {
  const legacy = await sql<Array<{
    id: string;
    payload: ExistingRow['payload'];
    hora_inicio: string;
  }>>`
    SELECT projection.id,
           projection.payload,
           COALESCE(
             to_char(membership.created_at AT TIME ZONE workspace.timezone, 'HH24:MI'),
             ''
           ) AS hora_inicio
    FROM sheet_projection_rows AS projection
    LEFT JOIN workspace_contacts AS membership
      ON membership.workspace_id = split_part(projection.projection_key, ':', 2)::uuid
     AND membership.contact_id = split_part(projection.projection_key, ':', 3)::uuid
    LEFT JOIN workspaces AS workspace ON workspace.id = membership.workspace_id
    WHERE projection.projection_type = 'lead'
      AND projection.state <> 'leased'
      AND (
        NOT (projection.payload ? 'fecha_ingreso')
        OR NOT (projection.payload ? 'hora_inicio')
        OR NOT (projection.payload ? 'campana')
        OR NOT (projection.payload ? 'anuncio')
        OR NOT (projection.payload ? 'monto')
        OR NOT (projection.payload ? 'pago')
        OR NOT (projection.payload ? 'fecha_venta')
      )
    ORDER BY projection.row_number
    LIMIT ${limit}
  `;
  let requeued = 0;
  for (const row of legacy) {
    const values: SheetRowValues = {
      fecha_ingreso: row.payload.fecha_ingreso ?? '',
      hora_inicio: row.payload.hora_inicio ?? row.hora_inicio,
      nombre: row.payload.nombre ?? '',
      apellido: row.payload.apellido ?? '',
      telefono: row.payload.telefono ?? '',
      mail: row.payload.mail ?? row.payload.email ?? '',
      campana: row.payload.campana ?? '',
      anuncio: row.payload.anuncio ?? '',
      tipo_de_curso: row.payload.tipo_de_curso ?? row.payload.curso_interes ?? '',
      plan: row.payload.plan ?? '',
      monto: nonEmpty(row.payload.monto) ?? amountLabelForPlan(row.payload.plan),
      pago: row.payload.pago ?? 'No',
      fecha_venta: row.payload.fecha_venta ?? '',
    };
    const updated = await sql<Array<{ id: string }>>`
      UPDATE sheet_projection_rows
      SET payload = ${jsonbParam(sql, values)},
          payload_hash = ${sha256Hex(values)},
          state = 'pending',
          available_at = now(),
          attempt_count = 0,
          lease_until = NULL,
          leased_by = NULL,
          error_code = NULL,
          projected_at = NULL
      WHERE id = ${row.id}
        AND state <> 'leased'
      RETURNING id
    `;
    requeued += updated.length;
  }
  return requeued;
}

/**
 * Leased worker that drains `sheet_projection_rows` (claim_sheet_projection_rows,
 * SKIP LOCKED) and performs the single `values.update` write per row. A
 * Google/network failure marks the row `failed_retryable` (or `dead_letter`
 * once `max_attempts` is exhausted) with exponential backoff — it never
 * throws out of this function, so a flaky provider can never take down the
 * caller or leave a row stuck `leased` past its lease.
 */
export async function flushSheetProjections(
  input: FlushSheetProjectionsInput,
  deps: FlushSheetProjectionsDeps = {},
): Promise<FlushSheetProjectionsResult> {
  const sql = deps.sql ?? orchestratorSql;
  const provider = deps.provider ?? new GoogleSheetsProvider({
    findSandboxProvider: createSandboxLookup(sql).findSandboxProvider,
  });
  const limit = Math.min(Math.max(input.limit ?? MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const leaseSeconds = Math.min(Math.max(input.lease_seconds ?? DEFAULT_LEASE_SECONDS, 20), 300);
  const deadline = new WorkerDeadline(input.deadline_ms ?? DEFAULT_DEADLINE_MS);

  // Upgrade legacy rows lazily through the existing durable worker. No Sheet
  // append, new row or database migration is needed, so deployments remain
  // reversible and existing leads retain their exact row identity.
  await requeueLegacyLeadRows(sql, limit);

  let claimed = 0;
  let completed = 0;
  let failed = 0;
  const skipped = 0;
  let leaseLost = 0;
  let deadlineReached = false;

  while (claimed < limit) {
    if (deadline.remainingMs() < MIN_OPERATION_BUDGET_MS) {
      deadlineReached = true;
      break;
    }

    let rows: ClaimedRow[];
    try {
      rows = await runDeadlineQuery(deadline, 'claim-sheet-projection', () => sql<ClaimedRow[]>`
        SELECT id, workspace_id, projection_key, spreadsheet_id, tab_name, row_number, payload, attempt_count, max_attempts
        FROM claim_sheet_projection_rows(${input.worker_id}, 1, ${leaseSeconds})
      `);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      throw error;
    }
    const row = rows[0];
    if (!row) break;
    claimed += 1;

    try {
      // Network call strictly outside any transaction.
      await deadline.run('sheets-update-row', () => provider.updateRow({
        spreadsheetId: row.spreadsheet_id,
        tabName: row.tab_name,
        rowNumber: row.row_number,
        contactId: contactIdFromLeadProjectionKey(row.projection_key),
        values: row.payload,
      }));

      const completedRows = await runDeadlineQuery(deadline, 'complete-sheet-projection', () => sql<Array<{ id: string }>>`
        UPDATE sheet_projection_rows
        SET state = 'projected', projected_at = now(), lease_until = NULL, leased_by = NULL, error_code = NULL
        WHERE id = ${row.id} AND state = 'leased' AND leased_by = ${input.worker_id} AND lease_until > now()
        RETURNING id
      `);
      if (completedRows.length === 1) completed += 1;
      else leaseLost += 1;
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      const terminal = row.attempt_count >= row.max_attempts;
      let failedRows: Array<{ id: string }>;
      try {
        failedRows = await runDeadlineQuery(deadline, 'fail-sheet-projection', () => sql<Array<{ id: string }>>`
          UPDATE sheet_projection_rows
          SET
            state = ${terminal ? 'dead_letter' : 'failed_retryable'},
            available_at = now() + make_interval(secs => ${backoffSeconds(row.attempt_count)}),
            lease_until = NULL,
            leased_by = NULL,
            error_code = ${terminal ? 'MAX_ATTEMPTS_EXHAUSTED' : 'PROJECTION_FAILED'}
          WHERE id = ${row.id} AND state = 'leased' AND leased_by = ${input.worker_id} AND lease_until > now()
          RETURNING id
        `);
      } catch (failureError) {
        if (failureError instanceof WorkerDeadlineExceeded) {
          deadlineReached = true;
          break;
        }
        throw failureError;
      }
      if (failedRows.length === 1) failed += 1;
      else leaseLost += 1;
      logger.error({
        event: 'sheet_projection.row_failed',
        row_id: row.id,
        workspace_id: row.workspace_id,
        attempt_count: row.attempt_count,
        terminal,
        error: String(error).slice(0, 500),
      });
    }
  }

  logger.info({
    event: 'sheet_projection.worker_completed',
    worker_id: input.worker_id,
    claimed,
    completed,
    failed,
    skipped,
  });

  return {
    claimed,
    completed,
    failed,
    skipped,
    lease_lost: leaseLost,
    deadline_reached: deadlineReached,
  };
}
