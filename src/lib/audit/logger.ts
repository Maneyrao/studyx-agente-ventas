import { auditSql } from '@/lib/db/audit';

interface AuditParams {
  action: string;
  entity_type: string;
  entity_id: string;
  payload?: Record<string, unknown> | null;
}

// Writes to audit_log via the write_audit_log() SECURITY DEFINER function.
// The function runs as audit_writer — the only identity with INSERT on audit_log.
// SELECT is the correct syntax to invoke a RETURNS void SQL function in PostgreSQL.
export async function auditLog(params: AuditParams): Promise<void> {
  const { action, entity_type, entity_id, payload = null } = params;
  await auditSql`SELECT write_audit_log(
    ${'orchestrator'},
    ${action},
    ${entity_type},
    ${entity_id}::uuid,
    ${payload ? JSON.stringify(payload) : null}::jsonb
  )`;
}
