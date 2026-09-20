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
    /** Legacy aliases read only so an existing row converges to the six-column contract. */
    email?: string;
    curso_interes?: string;
  };
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
 * The persisted payload is deliberately the six visible A:F values only.
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
      nombre: input.nombre ?? existing?.payload.nombre ?? '',
      apellido: input.apellido ?? existing?.payload.apellido ?? '',
      mail: input.email ?? existing?.payload.mail ?? existing?.payload.email ?? '',
      telefono: input.telefono ?? existing?.payload.telefono ?? '',
      tipo_de_curso: input.cursoInteres
        ?? existing?.payload.tipo_de_curso
        ?? existing?.payload.curso_interes
        ?? '',
      plan: input.plan ?? existing?.payload.plan ?? '',
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

export interface CommittedLeadStateProjectionInput {
  messageId: string;
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
    const workspaceRows = await db<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE slug = ${workspaceSlug} AND status = 'active' LIMIT 1
    `;
    const workspaceId = workspaceRows[0]?.id;
    if (!workspaceId) return 'skipped';

    const projected = await enqueueLeadProjection(
      {
        workspaceId,
        contactId: input.contactId,
        spreadsheetId: sheets.spreadsheetId,
        tabName: sheets.tabName,
        telefono: input.phone,
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
      LEFT JOIN offerings AS offering
        ON offering.workspace_id = state.workspace_id
       AND offering.code = state.selected_offering_code
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
    const projected = await enqueueLeadProjection({
      workspaceId: row.workspace_id,
      contactId: row.contact_id,
      spreadsheetId: sheets.spreadsheetId,
      tabName: sheets.tabName,
      telefono: row.declared_phone ?? row.phone,
      nombre: identity?.nombre,
      apellido: identity?.apellido,
      email: row.email ?? undefined,
      etapaComercial: projectedStage,
      cursoInteres: row.offering_name ?? row.selected_offering_code ?? undefined,
      plan: row.selected_payment_plan ?? undefined,
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
