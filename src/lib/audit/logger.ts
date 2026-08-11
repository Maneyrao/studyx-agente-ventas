import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import type { DbClient } from '@/lib/db/types';

interface AuditParams {
  action: string;
  entity_type: string;
  entity_id: string;
  payload?: Record<string, unknown> | null;
  event_key?: string | null;
  correlation_id?: string | null;
  causation_id?: string | null;
  source_event_id?: string | null;
}

// The SECURITY DEFINER function keeps INSERT privileges away from the caller.
// Passing the transaction handle is mandatory for atomic business mutations.
export async function auditLog(params: AuditParams, db: DbClient = sql): Promise<void> {
  const {
    action,
    entity_type,
    entity_id,
    payload = null,
    event_key = null,
    correlation_id = null,
    causation_id = null,
    source_event_id = null,
  } = params;
  await db`SELECT append_audit_event_atomic(
    ${'orchestrator'},
    ${action},
    ${entity_type},
    ${entity_id}::uuid,
    ${jsonbParam(db, payload)},
    ${event_key},
    ${correlation_id}::uuid,
    ${causation_id}::uuid,
    ${source_event_id}::uuid
  )`;
}
