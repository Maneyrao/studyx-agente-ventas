import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { BusinessContextStore } from '../ports/business-context-store';
import type {
  RawBusinessContext,
  RawOfferingRow,
  RawQualificationFieldRow,
  RawWorkspaceRow,
} from '../domain/business-context';

/**
 * Canonical reads for one workspace. Every query is scoped by the workspace
 * id resolved from the configured slug; there is no code path that returns
 * another workspace's rows.
 */
export class PostgresBusinessContextStore implements BusinessContextStore {
  constructor(private readonly db: DbClient = sql) {}

  async loadBusinessContext(workspaceSlug: string): Promise<RawBusinessContext | null> {
    const workspaces = await this.db<RawWorkspaceRow[]>`
      SELECT id, slug, display_name, environment, default_locale, timezone, metadata
      FROM workspaces
      WHERE slug = ${workspaceSlug} AND status = 'active'
    `;
    if (workspaces.length === 0) return null;
    const workspace = workspaces[0];

    const [offerings, qualification_fields] = await Promise.all([
      this.db<RawOfferingRow[]>`
        SELECT code, display_name, offering_type, description, value_proposition,
               price_type, price_amount::text AS price_amount, currency,
               billing_interval, delivery, guardrails, audience
        FROM offerings
        WHERE workspace_id = ${workspace.id}::uuid AND status = 'active'
        ORDER BY code
      `,
      this.db<RawQualificationFieldRow[]>`
        SELECT code, prompt, response_type, options, is_required, position
        FROM qualification_fields
        WHERE workspace_id = ${workspace.id}::uuid AND status = 'active'
        ORDER BY position
      `,
    ]);

    return { workspace, offerings, qualification_fields };
  }
}

export const businessContextStore = new PostgresBusinessContextStore();
