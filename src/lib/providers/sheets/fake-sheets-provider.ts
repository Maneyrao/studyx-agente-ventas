import type { SheetsProvider, UpdateRowParams } from './sheets-provider';

/** Thrown by FakeSheetsProvider when a simulated timeout is armed. Mirrors the shape of a network timeout without touching any socket. */
export class SimulatedSheetsTimeout extends Error {
  constructor() {
    super('SIMULATED_SHEETS_TIMEOUT');
    this.name = 'SimulatedSheetsTimeout';
  }
}

function rowKey(params: Pick<UpdateRowParams, 'spreadsheetId' | 'tabName' | 'rowNumber'>): string {
  return `${params.spreadsheetId}::${params.tabName}::${params.rowNumber}`;
}

/**
 * In-memory `SheetsProvider` for tests and local smokes. Records every
 * successful write keyed by (spreadsheetId, tabName, rowNumber) — the same
 * identity Google enforces with `values.update` — and can simulate a
 * provider timeout on demand so the worker's retry path can be exercised
 * without a network dependency.
 */
export class FakeSheetsProvider implements SheetsProvider {
  private readonly rows = new Map<string, UpdateRowParams>();
  readonly calls: UpdateRowParams[] = [];
  private timeoutsRemaining = 0;

  /** The next `count` calls to updateRow throw SimulatedSheetsTimeout instead of recording a write. */
  simulateTimeouts(count = 1): void {
    this.timeoutsRemaining = count;
  }

  async updateRow(params: UpdateRowParams): Promise<void> {
    this.calls.push(params);
    if (this.timeoutsRemaining > 0) {
      this.timeoutsRemaining -= 1;
      throw new SimulatedSheetsTimeout();
    }
    this.rows.set(rowKey(params), params);
  }

  rowAt(spreadsheetId: string, tabName: string, rowNumber: number): UpdateRowParams | undefined {
    return this.rows.get(rowKey({ spreadsheetId, tabName, rowNumber }));
  }

  get writtenRowCount(): number {
    return this.rows.size;
  }
}
