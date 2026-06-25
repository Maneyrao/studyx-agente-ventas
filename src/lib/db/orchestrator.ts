import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// max: 1 is required for Vercel serverless — each invocation gets its own connection.
// Connects as orchestrator_role via Supavisor (transaction mode).
// This role has INSERT, UPDATE, SELECT on business tables but NO access to audit_log.
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

export { sql };
