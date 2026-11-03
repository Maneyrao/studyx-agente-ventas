import { declineQuoteInBatchV1, priceObservationQuoteInBatchV1, PURCHASE_DECLINE_MEMORY_KEY } from '@/shared/conversation/deterministic-sales-rules';
import type { DbClient } from '@/lib/db/types';
import { readNegotiationFactsV1 } from '@/features/conversation/application/read-negotiation-facts';
import { deriveCourseBonusLadderV1, type CourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';

/**
 * Bonus permission evidence (AGENTS.md "Venta interpretada por el modelo").
 * Caller owns the state lock when authorizing an effect. Claims/proposals are
 * never inputs; only persisted model memories and this batch's literal quotes.
 *
 * - price evidence: a persisted objection/price_objection or constraint/
 *   price_only_barrier memory in the conversation, or this turn's memory whose
 *   source_quote is literally present in the batch;
 * - retention: this turn's model-declared purchase decline (objection/
 *   purchase_decline, quoted from the batch), usable once per conversation.
 *   "Used" is read from the persisted offer rows: a bonus whose source turn
 *   carries that decline memory.
 */
export async function readCourseBonusLadderV1(input: {
  workspace_id?: string; workspace_slug?: string; contact_id: string;
  conversation_id: string; source_turn_id?: string; selected_offering_code: string | null;
}, db: DbClient): Promise<CourseBonusLadderV1 | null> {
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
  const facts = await readNegotiationFactsV1({ ...input, workspace_slug: row.workspace_slug, source_turn_id: row.source_turn_id }, { db });
  // This turn's committed model memory: before the decision is persisted
  // (context time) nothing matches; at offer time the same transaction already
  // holds it. Quotes must be literal customer text of this batch.
  const [current] = await db<Array<{ candidates: Array<{type:string;key:string;value:string;source_quote:string}> | null; price_only: boolean; retention_used: boolean }>>`
    SELECT
      (SELECT d.memory_candidates FROM agent_decisions d
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply' LIMIT 1) candidates,
      EXISTS(SELECT 1 FROM agent_decisions d CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(d.negotiation_observations)='array' THEN d.negotiation_observations ELSE '[]'::jsonb END) observation
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply'
          AND observation->>'status'='confirmed'
          AND (observation->>'offering_code') IS NOT DISTINCT FROM ${input.selected_offering_code}) price_only,
      EXISTS(SELECT 1 FROM promotion_offers o JOIN promotion_offer_bonus_offerings b ON b.offer_id=o.id
        JOIN agent_decisions d ON d.turn_id=b.source_turn_id AND d.decision_kind='reply'
        WHERE o.conversation_id=${input.conversation_id}::uuid AND o.contact_id=${input.contact_id}::uuid
          AND o.package_mode='direct' AND b.source_turn_id<>${row.source_turn_id}::uuid
          AND jsonb_typeof(d.memory_candidates)='array'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.memory_candidates) candidate
            WHERE candidate->>'type'='objection' AND candidate->>'key'=${PURCHASE_DECLINE_MEMORY_KEY})) retention_used
  `;
  const currentPrice = current?.candidates?.some(candidate => (candidate.type === 'objection' && candidate.key === 'price_objection'
    || candidate.type === 'constraint' && candidate.key === 'price_only_barrier' && candidate.value === 'confirmed')
    && priceObservationQuoteInBatchV1(candidate.source_quote, row.customer_messages)) === true;
  const currentDecline = current?.candidates?.some(candidate => candidate.type === 'objection'
    && candidate.key === PURCHASE_DECLINE_MEMORY_KEY && declineQuoteInBatchV1(candidate.source_quote, row.customer_messages)) === true;
  return deriveCourseBonusLadderV1({
    price_evidence: (facts?.price_objection_count ?? 0) > 0 || facts?.price_only_barrier.status === 'confirmed'
      || currentPrice || current?.price_only === true,
    retention_decline: currentDecline, retention_used: current?.retention_used === true,
  });
}
