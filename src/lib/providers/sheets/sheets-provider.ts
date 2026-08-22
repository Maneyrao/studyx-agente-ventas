/**
 * Port for writing the derived, operator-facing Google Sheets projection
 * (docs/contracts/agent-a-operational-mvp.md §5).
 *
 * PostgreSQL's `sheet_projection_rows` is the outbox and the source of truth;
 * a spreadsheet only ever mirrors it. The single write operation this project
 * performs against Sheets is `spreadsheets.values.update` on a row_number
 * that PostgreSQL already reserved — append is never the primary operation,
 * so a replay or an ambiguous timeout can only rewrite the same row (see
 * supabase/migrations/20260817040001_sheet_projection_rows.sql).
 */

export const SHEET_COLUMN_ORDER = [
  'fecha_alta',
  'contact_id',
  'nombre',
  'apellido',
  'email',
  'telefono',
  'etapa_comercial',
  'curso_interes',
  'plan',
  'estado_pago',
  'fecha_pago',
  'estado_alta',
  'call_id',
  'ultima_senal',
  'trace_id',
] as const;

export type SheetColumn = (typeof SHEET_COLUMN_ORDER)[number];

export type SheetRowValues = Record<SheetColumn, string>;

export interface UpdateRowParams {
  spreadsheetId: string;
  tabName: string;
  rowNumber: number;
  /** Used only for the sandbox real-side-effect check; never written to a cell directly beyond the `contact_id` column already present in `values`. */
  contactId: string;
  values: SheetRowValues;
}

export interface SheetsProvider {
  updateRow(params: UpdateRowParams): Promise<void>;
}
