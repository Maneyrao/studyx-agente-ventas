import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { BusinessContextStore } from '../ports/business-context-store';
import {
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
  type BusinessContextLimits,
  type RawBusinessContext,
  type RawOfferingRow,
  type RawQualificationFieldRow,
  type RawWorkspaceRow,
} from '../domain/business-context';

interface BusinessSnapshotRow {
  as_of: Date;
  workspace: RawWorkspaceRow;
  offerings: RawOfferingRow[];
  offerings_total: number | string;
  qualification_fields?: RawQualificationFieldRow[];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSnapshot(row: BusinessSnapshotRow, includeQualification: boolean): RawBusinessContext {
  return {
    as_of: iso(row.as_of),
    workspace: row.workspace,
    offerings: row.offerings ?? [],
    offerings_total: Number(row.offerings_total),
    qualification_fields: includeQualification ? row.qualification_fields ?? [] : [],
  };
}

/**
 * Canonical one-statement snapshots for one configured workspace. Correlated
 * bounded subqueries keep the wire payload finite while the total offering
 * count preserves an explicit truncation signal.
 */
export class PostgresBusinessContextStore implements BusinessContextStore {
  constructor(private readonly db: DbClient = sql) {}

  async loadBusinessContext(
    workspaceSlug: string,
    limits: BusinessContextLimits = DEFAULT_BUSINESS_CONTEXT_LIMITS
  ): Promise<RawBusinessContext | null> {
    const rows = await this.db<BusinessSnapshotRow[]>`
      SELECT
        statement_timestamp() AS as_of,
        jsonb_build_object(
          'id', w.id,
          'slug', w.slug,
          'display_name', w.display_name,
          'environment', w.environment,
          'default_locale', w.default_locale,
          'timezone', w.timezone,
          'metadata', w.metadata
        ) AS workspace,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(bounded_offerings) ORDER BY bounded_offerings.code)
          FROM (
            SELECT code, display_name, offering_type, description, value_proposition,
                   price_type, price_amount::text AS price_amount, currency,
                   billing_interval, delivery, guardrails, audience, metadata
            FROM offerings
            WHERE workspace_id = w.id AND status = 'active'
            ORDER BY code
            LIMIT ${limits.maxOfferings}
          ) AS bounded_offerings
        ), '[]'::jsonb) AS offerings,
        (
          SELECT count(*)::int
          FROM offerings
          WHERE workspace_id = w.id AND status = 'active'
        ) AS offerings_total,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(bounded_fields) ORDER BY bounded_fields.position)
          FROM (
            SELECT code, prompt, response_type, options, is_required, position
            FROM qualification_fields
            WHERE workspace_id = w.id AND status = 'active'
            ORDER BY position
            LIMIT ${limits.maxQualificationFields}
          ) AS bounded_fields
        ), '[]'::jsonb) AS qualification_fields
      FROM workspaces AS w
      WHERE w.slug = ${workspaceSlug} AND w.status = 'active'
      LIMIT 1
    `;
    return rows[0] ? mapSnapshot(rows[0], true) : null;
  }

  /**
   * Standalone catalog callers need offerings only. This intentionally uses a
   * separate statement whose SQL never touches qualification_fields.
   */
  async loadBusinessCatalog(
    workspaceSlug: string,
    limits: Pick<BusinessContextLimits, 'maxOfferings'> = DEFAULT_BUSINESS_CONTEXT_LIMITS
  ): Promise<RawBusinessContext | null> {
    const rows = await this.db<BusinessSnapshotRow[]>`
      SELECT
        statement_timestamp() AS as_of,
        jsonb_build_object(
          'id', w.id,
          'slug', w.slug,
          'display_name', w.display_name,
          'environment', w.environment,
          'default_locale', w.default_locale,
          'timezone', w.timezone,
          'metadata', w.metadata
        ) AS workspace,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(bounded_offerings) ORDER BY bounded_offerings.code)
          FROM (
            SELECT code, display_name, offering_type, description, value_proposition,
                   price_type, price_amount::text AS price_amount, currency,
                   billing_interval, delivery, guardrails, audience, metadata
            FROM offerings
            WHERE workspace_id = w.id AND status = 'active'
            ORDER BY code
            LIMIT ${limits.maxOfferings}
          ) AS bounded_offerings
        ), '[]'::jsonb) AS offerings,
        (
          SELECT count(*)::int
          FROM offerings
          WHERE workspace_id = w.id AND status = 'active'
        ) AS offerings_total
      FROM workspaces AS w
      WHERE w.slug = ${workspaceSlug} AND w.status = 'active'
      LIMIT 1
    `;
    return rows[0] ? mapSnapshot(rows[0], false) : null;
  }
}

export const businessContextStore = new PostgresBusinessContextStore();
