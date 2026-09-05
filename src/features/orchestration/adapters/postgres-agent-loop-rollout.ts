import { AGENT_LOOP_MODES_V3, type RolloutRowV3 } from '../domain/agent-loop-rollout';
import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';

type RolloutDatabaseRow = { readonly contact_id: string | null; readonly mode: unknown };

/** Reads only the configured workspace default and this contact's override. */
export class PostgresAgentLoopRolloutReaderV3 {
  constructor(
    private readonly workspaceSlug: string,
    private readonly db: DbClient = sql,
  ) {}

  async load(contactId: string): Promise<readonly RolloutRowV3[]> {
    const rows = await this.db<RolloutDatabaseRow[]>`
      SELECT rollout.contact_id, rollout.mode
      FROM agent_loop_rollout_v3 AS rollout
      JOIN workspaces AS workspace
        ON workspace.id = rollout.workspace_id
      WHERE workspace.slug = ${this.workspaceSlug}
        AND workspace.status = 'active'
        AND (
          rollout.contact_id IS NULL
          OR rollout.contact_id = ${contactId}::uuid
        )
        AND EXISTS (
          SELECT 1
          FROM workspace_contacts AS membership
          WHERE membership.workspace_id = workspace.id
            AND membership.contact_id = ${contactId}::uuid
        )
    `;

    return rows.flatMap((row) => (
      typeof row.mode === 'string'
      && (AGENT_LOOP_MODES_V3 as readonly string[]).includes(row.mode)
        ? [{ contact_id: row.contact_id, mode: row.mode as RolloutRowV3['mode'] }]
        : []
    ));
  }
}
