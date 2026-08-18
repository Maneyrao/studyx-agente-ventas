import { inspectLocalTestDatabaseUrl } from '../helpers/db';

process.env.TZ = 'UTC';

const database = inspectLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL);

// Overwrite DATABASE_URL unconditionally — never `??=`. Service modules build a
// lazy postgres client from DATABASE_URL at import time, and any test reaching
// for that client instead of `openLocalTestDatabase()` inherits whatever the
// shell had. In this project `.env.local`'s DATABASE_URL is the production
// Supabase pooler, so a developer who exported it would have had integration
// tests writing to real customer data — which is exactly how this repo's
// production-write incident happened on 2026-08-17. Pinning it here makes the
// safe value the only reachable one, no matter how the suite connects.
if (database.allowed) {
  process.env.DATABASE_URL = database.url;
} else {
  // Suites skip in this branch, but imports still have to resolve. Point at an
  // address nothing is listening on rather than leaving a live remote URL in
  // place: a stray connection must fail loudly, not succeed against production.
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  console.warn(`[integration skipped] ${database.reason}`);
}
