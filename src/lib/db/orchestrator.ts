import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// max: 1 is the production default for Vercel serverless — each invocation
// gets its own connection. DB_POOL_MAX exists ONLY so a controlled load test
// can compare pool sizes; production does not set it.
// Connects as orchestrator_role via Supavisor (transaction mode, port 6543).
// This role has INSERT, UPDATE, SELECT on business tables but NO access to audit_log.
// prepare: false — named prepared statements are not guaranteed to survive
// transaction-mode pooling (Supabase's documented requirement for this port).
const poolMax = Number.parseInt(process.env.DB_POOL_MAX ?? '1', 10) || 1;
const sql = postgres(process.env.DATABASE_URL, { max: poolMax, prepare: false });

export { sql };
