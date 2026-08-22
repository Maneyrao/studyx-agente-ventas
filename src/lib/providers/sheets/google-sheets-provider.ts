import { google } from 'googleapis';
import { assertRealSideEffectAllowed, type SandboxLookup } from '@/lib/services/sandbox.service';
import { SHEET_COLUMN_ORDER, type SheetsProvider, type UpdateRowParams } from './sheets-provider';

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

  constructor(deps: GoogleSheetsProviderDeps) {
    this.findSandboxProvider = deps.findSandboxProvider;
  }

  async updateRow(params: UpdateRowParams): Promise<void> {
    await assertRealSideEffectAllowed(
      { findSandboxProvider: this.findSandboxProvider },
      { contactId: params.contactId, effect: 'google_sheets.update_row' },
    );

    if (!this.client) {
      this.client = google.sheets({ version: 'v4', auth: buildAuth() as never });
    }

    const row = SHEET_COLUMN_ORDER.map((column) => params.values[column] ?? '');
    await this.client.spreadsheets.values.update({
      spreadsheetId: params.spreadsheetId,
      range: `${params.tabName}!A${params.rowNumber}:${LAST_COLUMN}${params.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  }
}
