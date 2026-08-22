import { randomUUID } from 'node:crypto';
import {
  drainDurableQueue,
  resolveLocalQueueDatabaseUrl,
} from './lib/durable-queue-cli';

/**
 * Manual runner for the Google Sheets projection worker
 * (docs/contracts/agent-a-operational-mvp.md §5, §9). Mirrors the safety
 * guards of `run-knowledge-projection.ts`:
 *   - the connection string is NEVER read from DATABASE_URL — that value is
 *     the production Supabase pooler in this repo (see
 *     .claude/rules/database.md) — only from TEST_DATABASE_URL, and only
 *     when it targets a disposable local port (resolveLocalQueueDatabaseUrl
 *     rejects any remote host outright, so there is no "--allow-remote" path
 *     for this worker at all);
 *   - it refuses to start without Google Sheets credentials configured.
 */
function requireSheetsCredentials(env: Record<string, string | undefined> = process.env): void {
  const hasServiceAccount = Boolean(
    env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim() && env.GOOGLE_SHEETS_PRIVATE_KEY?.trim(),
  );
  const hasApplicationDefaultCredentials = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  if (!hasServiceAccount && !hasApplicationDefaultCredentials) {
    throw new Error(
      'Google Sheets credentials are required: set GOOGLE_APPLICATION_CREDENTIALS (local ADC) ' +
      'or GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY (Vercel).',
    );
  }
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || !env.GOOGLE_SHEETS_TAB_NAME?.trim()) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_TAB_NAME are required.');
  }
}

async function main() {
  requireSheetsCredentials();
  process.env.DATABASE_URL = resolveLocalQueueDatabaseUrl();
  const { flushSheetProjections } = await import('../src/lib/services/projection.service');
  const workerId = `sheet-projection-cli:${randomUUID()}`;
  const totals = await drainDurableQueue(
    (id) => flushSheetProjections({ worker_id: id, limit: 5, deadline_ms: 45_000 }),
    workerId,
  );
  console.log(JSON.stringify(totals));
  if (totals.failed > 0 || (totals.lease_lost ?? 0) > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
