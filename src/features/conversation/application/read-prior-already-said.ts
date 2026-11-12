import type { DbClient } from '@/lib/db/types';

const MAX_MARKERS = 5;
const MAX_CHARS = 200;

/**
 * Model-authored `already_said` markers (agent_decisions.already_said) of the
 * verified conversation family (sale_family_root_v1), newest first, excluding
 * the current turn. Persisted model evidence only; customer-visible text is
 * never scanned.
 */
export async function readPriorAlreadySaidV1(input: {
  workspace_slug: string; conversation_id: string; contact_id: string; source_turn_id: string;
}, deps: { db: DbClient }): Promise<string[]> {
  const rows = await deps.db<Array<{ already_said: string }>>`
    WITH root AS (SELECT sale_family_root_v1(w.id,${input.contact_id}::uuid,${input.conversation_id}::uuid) AS id FROM workspaces w WHERE w.slug=${input.workspace_slug}),
    family AS (SELECT id FROM root WHERE id IS NOT NULL
      UNION SELECT l.source_conversation_id FROM conversation_history_recovery_links l JOIN root ON l.canonical_conversation_id=root.id
        WHERE l.contact_id=${input.contact_id}::uuid)
    SELECT left(btrim(d.already_said), ${MAX_CHARS}) AS already_said
    FROM workspaces w
    JOIN workspace_contacts membership ON membership.workspace_id=w.id AND membership.contact_id=${input.contact_id}::uuid
    JOIN messages source ON source.contact_id=membership.contact_id AND source.direction='inbound'
      AND source.id<>${input.source_turn_id}::uuid
      AND source.conversation_id IN (SELECT id FROM family)
    JOIN agent_decisions d ON d.turn_id=source.id AND d.decision_kind='reply'
    WHERE w.slug=${input.workspace_slug} AND w.status='active' AND btrim(coalesce(d.already_said,''))<>''
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ${MAX_MARKERS}`;
  return rows.map(row => row.already_said);
}
