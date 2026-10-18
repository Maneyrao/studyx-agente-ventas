import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// A warm Vercel instance shares this pool across concurrent requests. Keep
// its size configurable and give DB work a bounded lifetime;
// increasing connections without measuring contention can hide a lock defect.
// Connects as orchestrator_role via Supavisor (transaction mode, port 6543).
// This role has INSERT, UPDATE, SELECT on business tables but NO access to audit_log.
// prepare: false — named prepared statements are not guaranteed to survive
// transaction-mode pooling (Supabase's documented requirement for this port).
const poolMax = Number.parseInt(process.env.DB_POOL_MAX ?? '1', 10) || 1;
export function createOrchestratorSql(databaseUrl: string, max = poolMax) {
  return postgres(databaseUrl, {
    max,
    prepare: false,
    connect_timeout: 5,
    // Query/lock deadlines belong to orchestrator_role (migration), because
    // session settings are not portable through Supavisor transaction pooling.
    connection: { application_name: 'studyx-orchestrator' },
  });
}

const sql = createOrchestratorSql(process.env.DATABASE_URL);

export { sql };
