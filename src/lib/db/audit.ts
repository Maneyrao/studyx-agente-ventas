import postgres from 'postgres';

if (!process.env.AUDIT_DATABASE_URL) {
  throw new Error('AUDIT_DATABASE_URL is not set');
}

// Connects as audit_writer via Supavisor (transaction mode).
// This role has INSERT + SELECT on audit_log only — no access to business tables.
const auditSql = postgres(process.env.AUDIT_DATABASE_URL, { max: 1 });

export { auditSql };
