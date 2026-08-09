import { inspectLocalTestDatabaseUrl } from '../helpers/db';

process.env.TZ = 'UTC';
// Service modules construct a lazy postgres client at import time. Keep imports
// compilable when the disposable database is unavailable; skipped suites never
// open this fallback connection.
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const database = inspectLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL);
if (!database.allowed) {
  console.warn(`[integration skipped] ${database.reason}`);
}
