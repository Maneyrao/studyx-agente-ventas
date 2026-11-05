import type { DbClient } from '@/lib/db/types';
import { projectSalesProfileMemoriesV1, type SalesProfileMemoriesV1 } from '@/shared/conversation/sales-profile';

const DECISION_WINDOW = 60;
// Most recent customer messages one reply may cite (bounded evidence).
const EVIDENCE_WINDOW = 12;

/**
 * Latest model-recorded memory per (type, key) of this conversation, read from
 * agent_decisions.memory_candidates of earlier turns. Persisted data only:
 * agent replies and audit_log are never consulted. Null outside the workspace.
 */
export async function readSalesProfileMemoriesV1(input: {
  workspace_slug: string; conversation_id: string; contact_id: string; source_turn_id: string;
}, deps: { db: DbClient }): Promise<SalesProfileMemoriesV1 | null> {
  const rows = await deps.db<Array<{ memory_candidates: Array<Record<string, unknown>>; evidence: string[] }>>`
    SELECT decision.memory_candidates,
      -- Every customer message this reply answered: its own batch plus any
      -- superseded batch since the previous agent message (owner test 6bcc8efa).
      ARRAY(SELECT answered.content FROM (SELECT evidence.content, evidence.created_at, evidence.id FROM messages evidence
        WHERE evidence.contact_id=source.contact_id AND evidence.conversation_id=source.conversation_id
          AND evidence.direction='inbound'
          AND (evidence.id=source.id OR (source.batch_id IS NOT NULL AND evidence.batch_id=source.batch_id)
            OR (evidence.created_at < source.created_at AND NOT EXISTS (
              SELECT 1 FROM messages reply WHERE reply.conversation_id=source.conversation_id
                AND reply.direction='outbound' AND reply.created_at > evidence.created_at
                AND reply.created_at < source.created_at)))
        ORDER BY evidence.created_at DESC, evidence.id DESC LIMIT ${EVIDENCE_WINDOW}) answered
        ORDER BY answered.created_at, answered.id) evidence
    FROM workspaces w
    JOIN workspace_contacts membership ON membership.workspace_id=w.id AND membership.contact_id=${input.contact_id}::uuid
    JOIN messages source ON source.contact_id=membership.contact_id AND source.conversation_id=${input.conversation_id}::uuid
      AND source.direction='inbound' AND source.id<>${input.source_turn_id}::uuid
    JOIN agent_decisions decision ON decision.turn_id=source.id AND decision.decision_kind='reply'
    WHERE w.slug=${input.workspace_slug} AND w.status='active'
      AND jsonb_array_length(decision.memory_candidates)>0
    ORDER BY decision.created_at DESC
    LIMIT ${DECISION_WINDOW}`;
  const [member] = await deps.db<Array<{ ok: boolean }>>`
    SELECT true ok FROM workspaces w JOIN workspace_contacts m ON m.workspace_id=w.id
    WHERE w.slug=${input.workspace_slug} AND w.status='active' AND m.contact_id=${input.contact_id}::uuid`;
  if (!member) return null;
  return projectSalesProfileMemoriesV1(rows.map((row) => ({
    memory_candidates: row.memory_candidates, evidence: row.evidence,
  })));
}
