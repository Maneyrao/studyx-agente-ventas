import { declineQuoteInBatchV1, PURCHASE_DECLINE_MEMORY_KEY } from '@/shared/conversation/deterministic-sales-rules';
import type { DbClient } from '@/lib/db/types';
import type { CourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';

/** Structured memory the model records on the turn where it asks the price question. */
export const PRICE_QUESTION_ASKED_MEMORY_KEY = 'price_question_asked';

/**
 * Persisted facts for the bonus motive check (AGENTS.md "Bonificación por
 * motivo actual"). Caller owns the state lock when authorizing an effect.
 * A persisted price objection no longer authorizes anything.
 *
 * - retention: "used" is read from the persisted offer rows: a bonus whose
 *   source turn carries the purchase_decline memory;
 * - previous_turn_asked_price_question: the latest earlier reply decision of the
 *   conversation recorded the structured price_question_asked memory;
 * - purchase_decline_recorded: this turn's committed memory has the decline with
 *   a quote literally present in the batch.
 */
export interface BonusMotiveEvidenceV1 extends CourseBonusLadderV1 {
  readonly purchase_decline_recorded: boolean;
}

export async function readCourseBonusLadderV1(input: {
  workspace_id?: string; workspace_slug?: string; contact_id: string;
  conversation_id: string; source_turn_id?: string; selected_offering_code: string | null;
}, db: DbClient): Promise<BonusMotiveEvidenceV1 | null> {
  const [row] = await db<Array<{ workspace_slug: string; source_turn_id: string; customer_messages: string[] }>>`
    SELECT w.slug workspace_slug,current.id source_turn_id,
      ARRAY(SELECT fragment.content FROM messages fragment WHERE fragment.direction='inbound'
        AND fragment.contact_id=c.id AND fragment.conversation_id=v.id
        AND (fragment.id=current.id OR (fragment.batch_id=current.batch_id AND current.batch_id IS NOT NULL))
        ORDER BY fragment.conversation_seq) customer_messages
    FROM workspaces w JOIN conversation_sales_context_states_v1 s ON s.workspace_id=w.id
    JOIN contacts c ON c.id=s.contact_id JOIN conversations v ON v.id=s.conversation_id AND v.contact_id=c.id
    JOIN workspace_contacts wc ON wc.workspace_id=w.id AND wc.contact_id=c.id
    JOIN LATERAL(SELECT m.id,m.conversation_seq,m.batch_id FROM messages m WHERE m.conversation_id=v.id AND m.contact_id=c.id
      AND m.direction='inbound' AND (${input.source_turn_id ?? null}::uuid IS NULL OR m.id=${input.source_turn_id ?? null}::uuid)
      ORDER BY m.conversation_seq DESC LIMIT 1) current ON true
    WHERE w.status='active' AND (${input.workspace_id ?? null}::uuid IS NULL OR w.id=${input.workspace_id ?? null}::uuid)
      AND (${input.workspace_slug ?? null}::text IS NULL OR w.slug=${input.workspace_slug ?? null})
      AND v.id=${input.conversation_id}::uuid AND c.id=${input.contact_id}::uuid
  `;
  if (!row) return null;
  const [current] = await db<Array<{ candidates: Array<{type:string;key:string;value:string;source_quote:string}> | null; retention_used: boolean; asked: boolean }>>`
    SELECT
      (SELECT d.memory_candidates FROM agent_decisions d
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply' LIMIT 1) candidates,
      EXISTS(SELECT 1 FROM promotion_offers o JOIN promotion_offer_bonus_offerings b ON b.offer_id=o.id
        JOIN agent_decisions d ON d.turn_id=b.source_turn_id AND d.decision_kind='reply'
        WHERE o.conversation_id=${input.conversation_id}::uuid AND o.contact_id=${input.contact_id}::uuid
          AND o.package_mode='direct' AND b.source_turn_id<>${row.source_turn_id}::uuid
          AND jsonb_typeof(d.memory_candidates)='array'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.memory_candidates) candidate
            WHERE candidate->>'type'='objection' AND candidate->>'key'=${PURCHASE_DECLINE_MEMORY_KEY})) retention_used,
      COALESCE((SELECT jsonb_typeof(last.memory_candidates)='array' AND EXISTS(
          SELECT 1 FROM jsonb_array_elements(last.memory_candidates) candidate
          WHERE candidate->>'key'=${PRICE_QUESTION_ASKED_MEMORY_KEY})
        FROM agent_decisions last JOIN messages source ON source.id=last.turn_id
        WHERE last.decision_kind='reply' AND source.conversation_id=${input.conversation_id}::uuid
          AND source.contact_id=${input.contact_id}::uuid AND source.direction='inbound'
          AND source.id<>${row.source_turn_id}::uuid
          AND message_occurrence_v1(source.metadata,source.created_at) < (SELECT message_occurrence_v1(metadata,created_at)
            FROM messages WHERE id=${row.source_turn_id}::uuid)
        ORDER BY message_occurrence_v1(source.metadata,source.created_at) DESC, last.created_at DESC LIMIT 1),false) asked
  `;
  const decline = current?.candidates?.some(candidate => candidate.type === 'objection'
    && candidate.key === PURCHASE_DECLINE_MEMORY_KEY && declineQuoteInBatchV1(candidate.source_quote, row.customer_messages)) === true;
  return { retention_used: current?.retention_used === true,
    previous_turn_asked_price_question: current?.asked === true, purchase_decline_recorded: decline };
}
