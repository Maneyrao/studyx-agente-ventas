import { google } from 'googleapis';
import {
  assertRealSideEffectAllowed,
  isSandboxSheetWriteAllowlisted,
  type SandboxLookup,
} from '@/lib/services/sandbox.service';
import {
  SHEET_COLUMN_LABELS,
  SHEET_COLUMN_ORDER,
  type SheetsProvider,
  type UpdateRowParams,
} from './sheets-provider';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * Local: Application Default Credentials via `GOOGLE_APPLICATION_CREDENTIALS`
 * (absolute path to a service-account JSON), read by google-auth-library
 * itself. Vercel: no filesystem for that JSON, so the two fields are injected
 * as separate encrypted env vars instead (docs/contracts/agent-a-operational-mvp.md §9).
 */
function buildAuth() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return new google.auth.JWT({
      email: clientEmail,
      // `\n` survives env var transport as the two-character escape and must
      // be restored before the PEM key is usable.
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: [SHEETS_SCOPE],
    });
  }
  return new google.auth.GoogleAuth({ scopes: [SHEETS_SCOPE] });
}

function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const LAST_COLUMN = columnLetter(SHEET_COLUMN_ORDER.length - 1);

function quotedTabName(tabName: string): string {
  return `'${tabName.replaceAll("'", "''")}'`;
}

export interface GoogleSheetsProviderDeps {
  findSandboxProvider: SandboxLookup['findSandboxProvider'];
}

/**
 * Real `SheetsProvider`. Every write goes through the sandbox lock first —
 * `.claude/rules/database.md` forbids any real-world side effect (including a
 * production spreadsheet write) against a contact with a row in
 * `sandbox_identities` — then a single `spreadsheets.values.update` over the
 * row_number PostgreSQL already reserved. Never `append`.
 */
export class GoogleSheetsProvider implements SheetsProvider {
  private readonly findSandboxProvider: GoogleSheetsProviderDeps['findSandboxProvider'];
  private client: ReturnType<typeof google.sheets> | null = null;
  private readonly preparedTabs = new Set<string>();

  constructor(deps: GoogleSheetsProviderDeps) {
    this.findSandboxProvider = deps.findSandboxProvider;
  }

  async updateRow(params: UpdateRowParams): Promise<void> {
    if (!isSandboxSheetWriteAllowlisted(params.contactId)) {
      await assertRealSideEffectAllowed(
        { findSandboxProvider: this.findSandboxProvider },
        { contactId: params.contactId, effect: 'google_sheets.update_row' },
      );
    }

    if (!this.client) {
      this.client = google.sheets({ version: 'v4', auth: buildAuth() as never });
    }

    const preparedKey = `${params.spreadsheetId}:${params.tabName}`;
    if (!this.preparedTabs.has(preparedKey)) {
      const spreadsheet = await this.client.spreadsheets.get({
        spreadsheetId: params.spreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const sheet = spreadsheet.data.sheets?.find((candidate) => candidate.properties?.title === params.tabName);
      const sheetId = sheet?.properties?.sheetId;
      if (sheetId === undefined || sheetId === null) throw new Error('SHEETS_TAB_NOT_FOUND');

      await this.client.spreadsheets.values.update({
        spreadsheetId: params.spreadsheetId,
        range: `${quotedTabName(params.tabName)}!A1:${LAST_COLUMN}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [SHEET_COLUMN_ORDER.map((column) => SHEET_COLUMN_LABELS[column])],
        },
      });
      await this.client.spreadsheets.batchUpdate({
        spreadsheetId: params.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SHEET_COLUMN_ORDER.length },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.12, green: 0.29, blue: 0.47 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    horizontalAlignment: 'CENTER',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: SHEET_COLUMN_ORDER.length },
              },
            },
          ],
        },
      });
      this.preparedTabs.add(preparedKey);
    }

    const row = SHEET_COLUMN_ORDER.map((column) => params.values[column] ?? '');
    await this.client.spreadsheets.values.update({
      spreadsheetId: params.spreadsheetId,
      range: `${quotedTabName(params.tabName)}!A${params.rowNumber}:${LAST_COLUMN}${params.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  }
}
