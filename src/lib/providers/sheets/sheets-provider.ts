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

/** The complete-lead operator view. This is the entire visible Sheet row. */
export const SHEET_COLUMN_ORDER = [
  'fecha_ingreso',
  'nombre',
  'apellido',
  'telefono',
  'mail',
  'campana',
  'anuncio',
  'tipo_de_curso',
  'plan',
  'monto',
  'pago',
  'fecha_venta',
] as const;

export const SHEET_COLUMN_LABELS: Readonly<Record<SheetColumn, string>> = {
  fecha_ingreso: 'Fecha de ingreso',
  nombre: 'Nombre',
  apellido: 'Apellido',
  telefono: 'Teléfono',
  mail: 'Mail',
  campana: 'Campaña',
  anuncio: 'Anuncio',
  tipo_de_curso: 'Curso(s)',
  plan: 'Plan de pago',
  monto: 'Monto',
  pago: 'Pago',
  fecha_venta: 'Fecha de venta',
};

export type SheetColumn = (typeof SHEET_COLUMN_ORDER)[number];

export type SheetRowValues = Record<SheetColumn, string>;

export interface UpdateRowParams {
  spreadsheetId: string;
  tabName: string;
  rowNumber: number;
  /** Used only for the sandbox real-side-effect check; never written to a cell. */
  contactId: string;
  values: SheetRowValues;
}

export interface SheetsProvider {
  updateRow(params: UpdateRowParams): Promise<void>;
}
