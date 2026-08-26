import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { SalesContextState, SalesContextTransition } from '../domain/sales-context';
import type { SalesContextStore } from '../ports/sales-context-store';

interface SalesContextRow extends Omit<SalesContextState, 'updated_at'> {
  updated_at: Date | string;
}

function mapRow(row: SalesContextRow): SalesContextState {
  return {
    ...row,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

/** PostgreSQL upsert gives one atomic version bump per workspace/contact. */
export class PostgresSalesContextStore implements SalesContextStore {
  constructor(private readonly db: DbClient = sql) {}

  async load(workspaceSlug: string, contactId: string): Promise<SalesContextState | null> {
    const rows = await this.db<SalesContextRow[]>`
      SELECT s.workspace_id, s.contact_id, s.conversation_id,
             s.selected_offering_code, s.selected_payment_plan, s.stage,
             s.source_turn_id, s.version, s.updated_at
      FROM sales_context_states AS s
      JOIN workspaces AS w ON w.id = s.workspace_id
      WHERE w.slug = ${workspaceSlug} AND w.status = 'active'
        AND s.contact_id = ${contactId}::uuid
      LIMIT 1
    `;
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async transition(input: SalesContextTransition): Promise<SalesContextState> {
    const rows = await this.db<SalesContextRow[]>`
      WITH workspace AS (
        SELECT id FROM workspaces WHERE slug = ${input.workspace_slug} AND status = 'active' LIMIT 1
      ), checked AS (
        SELECT w.id
        FROM workspace AS w
        WHERE ${input.selected_offering_code}::text IS NULL
           OR EXISTS (
             SELECT 1 FROM offerings AS o
             WHERE o.workspace_id = w.id AND o.status = 'active' AND o.code = ${input.selected_offering_code}
           )
      ), upserted AS (
        INSERT INTO sales_context_states (
          workspace_id, contact_id, conversation_id, selected_offering_code,
          selected_payment_plan, stage, source_turn_id
        )
        SELECT id, ${input.contact_id}::uuid, ${input.conversation_id}::uuid,
               ${input.selected_offering_code}, ${input.selected_payment_plan},
               ${input.stage}, ${input.source_turn_id}::uuid
        FROM checked
        ON CONFLICT (workspace_id, contact_id) DO UPDATE
        SET conversation_id = EXCLUDED.conversation_id,
            selected_offering_code = COALESCE(EXCLUDED.selected_offering_code, sales_context_states.selected_offering_code),
            selected_payment_plan = COALESCE(EXCLUDED.selected_payment_plan, sales_context_states.selected_payment_plan),
            stage = EXCLUDED.stage,
            source_turn_id = EXCLUDED.source_turn_id,
            version = sales_context_states.version + 1,
            updated_at = now()
        RETURNING workspace_id, contact_id, conversation_id, selected_offering_code,
                  selected_payment_plan, stage, source_turn_id, version, updated_at
      ), event AS (
        INSERT INTO sales_context_state_events (
          workspace_id, contact_id, state_version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage
        )
        SELECT workspace_id, contact_id, version, source_turn_id,
               selected_offering_code, selected_payment_plan, stage
        FROM upserted
        ON CONFLICT (workspace_id, contact_id, state_version) DO NOTHING
      )
      SELECT * FROM upserted
    `;
    if (!rows[0]) throw new Error('SALES_CONTEXT_WORKSPACE_OR_OFFERING_NOT_FOUND');
    return mapRow(rows[0]);
  }
}

export const salesContextStore = new PostgresSalesContextStore();
