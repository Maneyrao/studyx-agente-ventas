import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { logger } from '@/lib/observability/structured-log';
import { createSandboxLookup } from '@/lib/repositories/sandbox-identity.repository';
import { GoogleSheetsProvider } from '@/lib/providers/sheets/google-sheets-provider';
import type { SheetRowValues, SheetsProvider } from '@/lib/providers/sheets/sheets-provider';
import { runDeadlineQuery, WorkerDeadline, WorkerDeadlineExceeded } from './durable-worker-deadline';

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
 * Timing: this module only exposes the primitives. Task 4 (send_payment_link,
 * mark_hot_lead, log_objection) decides WHEN to call `enqueueLeadProjection`
 * — always after channel delivery is confirmed, never inside the canonical
 * transaction.
 */

const DEFAULT_ESTADO_ALTA = 'pendiente_operador';
const MAX_ROW_RESERVE_ATTEMPTS = 8;
const MAX_BACKOFF_SECONDS = 3600;
const MAX_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 45;
const DEFAULT_DEADLINE_MS = 45_000;
const MIN_OPERATION_BUDGET_MS = 25;

export function leadProjectionKey(workspaceId: string, contactId: string): string {
  return `lead:${workspaceId}:${contactId}`;
}

export interface LeadProjectionInput {
  workspaceId: string;
  contactId: string;
  spreadsheetId: string;
  tabName: string;
  telefono: string;
  /**
   * Optional: an event that doesn't carry identity data (e.g. a bare
   * `payment_link_sent` update) omits these, and the merge below must not
   * blank out whatever a previous event already projected for this same
   * contact_id.
   */
  nombre?: string;
  apellido?: string;
  email?: string;
  etapaComercial: string;
  cursoInteres: string;
  plan: string;
  estadoPago: string;
  fechaPago: string;
  callId: string;
  ultimaSenal: string;
  traceId: string;
}

export interface EnqueueLeadProjectionResult {
  id: string;
  rowNumber: number;
  changed: boolean;
}

interface ExistingRow {
  id: string;
  row_number: number;
  payload: Partial<SheetRowValues>;
}

function backoffSeconds(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, attemptCount - 1));
}

/**
 * Idempotent upsert of the single outbox row for one lead.
 *
 * `estado_alta` is only ever defaulted to 'pendiente_operador' the first
 * time a projection_key is seen; every later call preserves whatever value
 * currently sits in the row (in particular a human-set
 * 'hecha_por_operador'), so a new commercial signal can never clobber an
 * operator's manual mark. `fecha_alta` is likewise fixed at first insert.
 *
 * `nombre`/`apellido`/`email` are optional per call: an event that omits one
 * (e.g. a bare `payment_link_sent` update) falls back to whatever value the
 * row already carries, so a partial later event can never blank out an
 * identity a previous event projected for the same `contact_id`.
 *
 * `row_number` is reserved once, on first insert, as
 * `MAX(row_number in this spreadsheet+tab) + 1`; a concurrent first insert
 * for a different lead can race on that reservation, so a unique-violation
 * on the (spreadsheet_id, tab_name, row_number) constraint is treated as a
 * retry signal, not an error.
 */
export async function enqueueLeadProjection(
  input: LeadProjectionInput,
  deps: { sql?: DbClient } = {},
): Promise<EnqueueLeadProjectionResult> {
  const sql = deps.sql ?? orchestratorSql;
  const projectionKey = leadProjectionKey(input.workspaceId, input.contactId);

  for (let attempt = 0; attempt < MAX_ROW_RESERVE_ATTEMPTS; attempt++) {
    const existingRows = await sql<ExistingRow[]>`
      SELECT id, row_number, payload
      FROM sheet_projection_rows
      WHERE projection_key = ${projectionKey}
    `;
    const existing = existingRows[0];

    const values: SheetRowValues = {
      fecha_alta: existing?.payload.fecha_alta ?? new Date().toISOString().slice(0, 10),
      contact_id: input.contactId,
      // Identity fields are optional per event: an event that omits them
      // (e.g. a bare payment update) must not blank out an identity a prior
      // event already projected for this same contact_id.
      nombre: input.nombre ?? existing?.payload.nombre ?? '',
      apellido: input.apellido ?? existing?.payload.apellido ?? '',
      email: input.email ?? existing?.payload.email ?? '',
      telefono: input.telefono,
      etapa_comercial: input.etapaComercial,
      curso_interes: input.cursoInteres,
      plan: input.plan,
      estado_pago: input.estadoPago,
      fecha_pago: input.fechaPago,
      estado_alta: existing?.payload.estado_alta ?? DEFAULT_ESTADO_ALTA,
      call_id: input.callId,
      ultima_senal: input.ultimaSenal,
      trace_id: input.traceId,
    };
    const payloadHash = sha256Hex(values);

    if (existing) {
      if (existing.payload && sha256Hex(existing.payload) === payloadHash) {
        return { id: existing.id, rowNumber: existing.row_number, changed: false };
      }
      const updated = await sql<Array<{ id: string; row_number: number }>>`
        UPDATE sheet_projection_rows
        SET payload = ${jsonbParam(sql, values)},
            payload_hash = ${payloadHash},
            state = 'pending',
            available_at = now()
        WHERE id = ${existing.id}
        RETURNING id, row_number
      `;
      return { id: updated[0].id, rowNumber: updated[0].row_number, changed: true };
    }

    try {
      const inserted = await sql<Array<{ id: string; row_number: number }>>`
        INSERT INTO sheet_projection_rows (
          projection_key, workspace_id, projection_type, spreadsheet_id, tab_name,
          row_number, payload, payload_hash, state
        )
        SELECT
          ${projectionKey},
          ${input.workspaceId}::uuid,
          'lead',
          ${input.spreadsheetId},
          ${input.tabName},
          COALESCE(MAX(row_number), 1) + 1,
          ${jsonbParam(sql, values)},
          ${payloadHash},
          'pending'
        FROM sheet_projection_rows
        WHERE spreadsheet_id = ${input.spreadsheetId} AND tab_name = ${input.tabName}
        RETURNING id, row_number
      `;
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
  spreadsheet_id: string;
  tab_name: string;
  row_number: number;
  payload: SheetRowValues;
  attempt_count: number;
  max_attempts: number;
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
        SELECT id, workspace_id, spreadsheet_id, tab_name, row_number, payload, attempt_count, max_attempts
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
        contactId: row.payload.contact_id ?? '',
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
