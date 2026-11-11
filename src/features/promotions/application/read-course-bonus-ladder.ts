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
 *   a quote literally present in the batch;
 * - price_presented: a delivered agent message sent before the current turn states the
 *   paid course's fixed amount next to a currency marker (USD/US$/$/dólares); a fact
 *   about Emma's own text, never an interpretation of customer text.
 */
export interface BonusMotiveEvidenceV1 extends CourseBonusLadderV1 {
  readonly purchase_decline_recorded: boolean;
  readonly price_presented: boolean;
}

export async function readCourseBonusLadderV1(input: {
  workspace_id?: string; workspace_slug?: string; contact_id: string;
  conversation_id: string; source_turn_id?: string; selected_offering_code: string | null;
}, db: DbClient): Promise<BonusMotiveEvidenceV1 | null> {
  const [row] = await db<Array<{ workspace_id: string; workspace_slug: string; source_turn_id: string; customer_messages: string[] }>>`
    SELECT w.id workspace_id,w.slug workspace_slug,current.id source_turn_id,
      ARRAY(SELECT fragment.content FROM agent_intervention_inbound_v1(current.id) fragment
        ORDER BY fragment.occurred_at, fragment.conversation_seq) customer_messages
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
  const [current] = await db<Array<{ candidates: Array<{type:string;key:string;value:string;source_quote:string}> | null; retention_used: boolean; asked: boolean; price_presented: boolean;
    carried: Array<{ code: string; display_name: string }> | null; prior_objection: boolean }>>`
    WITH root AS (SELECT sale_family_root_v1(${row.workspace_id}::uuid,${input.contact_id}::uuid,${input.conversation_id}::uuid) AS id),
    family AS (SELECT id FROM root WHERE id IS NOT NULL
      UNION SELECT l.source_conversation_id FROM conversation_history_recovery_links l JOIN root ON l.canonical_conversation_id=root.id
        WHERE l.workspace_id=${row.workspace_id}::uuid AND l.contact_id=${input.contact_id}::uuid)
    SELECT
      -- Owner 2026-11-10: a price objection recorded on an earlier, answered turn
      -- (outside the current intervention) makes the current one the second.
      EXISTS(SELECT 1 FROM agent_decisions d JOIN messages src ON src.id=d.turn_id
        WHERE src.conversation_id IN (SELECT id FROM family) AND src.contact_id=${input.contact_id}::uuid
          AND src.direction='inbound' AND d.decision_kind='reply'
          AND src.id NOT IN (SELECT current_turn.id FROM agent_intervention_inbound_v1(${row.source_turn_id}::uuid) current_turn)
          AND jsonb_typeof(d.memory_candidates)='array'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.memory_candidates) candidate
            WHERE candidate->>'type'='objection' AND candidate->>'key'='price_objection')) prior_objection,
      -- Owner 2026-11-10: gifts delivered for another main course of this
      -- conversation carry over to the current one (live or switch-cancelled packages).
      (SELECT jsonb_agg(DISTINCT jsonb_build_object('code',gift.offering_code_snapshot,'display_name',gift.offering_display_name_snapshot))
        FROM promotion_offers o JOIN offerings paid ON paid.id=o.paid_offering_id
        JOIN promotion_offer_bonus_offerings gift ON gift.offer_id=o.id AND gift.delivered_at IS NOT NULL
        WHERE o.conversation_id IN (SELECT id FROM family) AND o.contact_id=${input.contact_id}::uuid
          AND o.package_mode='direct' AND paid.code IS DISTINCT FROM ${input.selected_offering_code}
          AND gift.offering_code_snapshot IS DISTINCT FROM ${input.selected_offering_code}
          AND (o.status IN ('offered','accepted','attached')
            OR (o.status='cancelled' AND o.cancel_reason='CUSTOMER_CHANGED_COURSE'))) carried,
      EXISTS(SELECT 1 FROM offerings paid JOIN workspaces pw ON pw.id=paid.workspace_id AND pw.slug=${row.workspace_slug}
        JOIN messages prior ON prior.conversation_id IN (SELECT id FROM family) AND prior.contact_id=${input.contact_id}::uuid
          AND prior.direction='outbound'
          AND prior.created_at < (SELECT created_at FROM messages WHERE id=${row.source_turn_id}::uuid)
          AND (NOT EXISTS (SELECT 1 FROM outbound_deliveries known WHERE known.message_id=prior.id)
            OR EXISTS (SELECT 1 FROM outbound_deliveries sent WHERE sent.message_id=prior.id
              AND (sent.provider_message_id IS NOT NULL OR sent.state IN ('submitted','delivered'))))
        WHERE paid.code=${input.selected_offering_code} AND paid.price_type='fixed' AND paid.price_amount IS NOT NULL
          AND prior.content ~* ('(usd|us\\$|\\$)\\s*' || replace(trim_scale(paid.price_amount)::text, '.', '\\.') || '([^0-9.,]|[.,]([^0-9]|$)|$)'
            || '|(^|[^0-9.,])' || replace(trim_scale(paid.price_amount)::text, '.', '\\.') || '\\s*(usd|d(o|ó)lares)')) price_presented,
      (SELECT d.memory_candidates FROM agent_decisions d
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply' LIMIT 1) candidates,
      EXISTS(SELECT 1 FROM promotion_offers o JOIN promotion_offer_bonus_offerings b ON b.offer_id=o.id
        JOIN agent_decisions d ON d.turn_id=b.source_turn_id AND d.decision_kind='reply'
        WHERE o.conversation_id IN (SELECT id FROM family) AND o.contact_id=${input.contact_id}::uuid
          AND o.package_mode='direct' AND b.source_turn_id<>${row.source_turn_id}::uuid
          AND jsonb_typeof(d.memory_candidates)='array'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.memory_candidates) candidate
            WHERE candidate->>'type'='objection' AND candidate->>'key'=${PURCHASE_DECLINE_MEMORY_KEY})) retention_used,
      COALESCE((SELECT jsonb_typeof(last.memory_candidates)='array' AND EXISTS(
          SELECT 1 FROM jsonb_array_elements(last.memory_candidates) candidate
          WHERE candidate->>'key'=${PRICE_QUESTION_ASKED_MEMORY_KEY})
        FROM agent_decisions last JOIN messages source ON source.id=last.turn_id
        WHERE last.decision_kind='reply' AND source.conversation_id IN (SELECT id FROM family)
          AND source.contact_id=${input.contact_id}::uuid AND source.direction='inbound'
          AND source.id<>${row.source_turn_id}::uuid
          AND message_occurrence_v1(source.metadata,source.created_at) < (SELECT message_occurrence_v1(metadata,created_at)
            FROM messages WHERE id=${row.source_turn_id}::uuid)
        ORDER BY message_occurrence_v1(source.metadata,source.created_at) DESC, last.created_at DESC LIMIT 1),false) asked
  `;
  const decline = current?.candidates?.some(candidate => candidate.type === 'objection'
    && candidate.key === PURCHASE_DECLINE_MEMORY_KEY && declineQuoteInBatchV1(candidate.source_quote, row.customer_messages)) === true;
  return { retention_used: current?.retention_used === true,
    previous_turn_asked_price_question: current?.asked === true, purchase_decline_recorded: decline,
    price_presented: current?.price_presented === true,
    prior_price_objection_recorded: current?.prior_objection === true,
    ...(current?.carried?.length ? { carried_over_bonus_offerings: current.carried } : {}) };
}
