import type { DbClient } from '@/lib/db/types';

export type SaleContinuityV1 =
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidate_offering_codes: readonly string[] }
  | { kind: 'single'; offering_code: string; payment_plan: string | null; stage: string;
      source_conversation_id: string; has_unpaid_link: boolean };

interface Input { readonly workspace_id: string; readonly contact_id: string; readonly conversation_id: string }

interface Candidate {
  offering_code: string;
  payment_plan: string | null;
  stage: string;
  source_conversation_id: string;
  paid: boolean;
  has_unpaid_link: boolean;
}

/**
 * Sale continuity across a verified WhatsApp conversation change. Only the
 * immutable proof rows (conversation_history_recovery_links: same workspace,
 * same contact, closed source, open canonical) are read; never a phone number
 * or a "latest" row. A read: nothing is written here.
 *
 * Candidates are the linked sources' open course selections whose sale is not
 * paid or refunded. The canonical conversation's own unpaid links can only
 * make the answer ambiguous, never choose one.
 */
export async function resolveSaleContinuityV1(db: DbClient, input: Input): Promise<SaleContinuityV1> {
  const sources = await db<Candidate[]>`
    SELECT s.selected_offering_code AS offering_code, s.selected_payment_plan AS payment_plan, s.stage,
      s.conversation_id AS source_conversation_id,
      EXISTS (SELECT 1 FROM payments p JOIN offerings o ON o.id=p.offering_id AND o.workspace_id=p.workspace_id
        WHERE p.workspace_id=s.workspace_id AND p.contact_id=s.contact_id AND o.code=s.selected_offering_code
          AND p.status IN ('paid','refunded')
          AND sale_family_root_v1(p.workspace_id,p.contact_id,p.source_conversation_id)=link.canonical_conversation_id) AS paid,
      EXISTS (SELECT 1 FROM payments p JOIN offerings o ON o.id=p.offering_id AND o.workspace_id=p.workspace_id
        WHERE p.workspace_id=s.workspace_id AND p.contact_id=s.contact_id AND o.code=s.selected_offering_code
          AND p.status IN ('reserved','pending')
          AND NOT EXISTS (SELECT 1 FROM payment_intent_supersessions x WHERE x.payment_id=p.id)
          AND sale_family_root_v1(p.workspace_id,p.contact_id,p.source_conversation_id)=link.canonical_conversation_id) AS has_unpaid_link
    FROM conversation_history_recovery_links link
    JOIN conversation_sales_context_states_v1 s ON s.workspace_id=link.workspace_id
      AND s.contact_id=link.contact_id AND s.conversation_id=link.source_conversation_id
    WHERE link.workspace_id=${input.workspace_id}::uuid AND link.contact_id=${input.contact_id}::uuid
      AND link.canonical_conversation_id=${input.conversation_id}::uuid AND link.channel='whatsapp'
      AND s.selected_offering_code IS NOT NULL AND s.stage<>'closed'
    ORDER BY s.updated_at DESC, s.conversation_id`;
  const open = sources.filter(candidate => !candidate.paid);
  if (open.length === 0) return { kind: 'none' };
  const own = await db<Array<{ code: string }>>`
    SELECT DISTINCT o.code FROM payments p JOIN offerings o ON o.id=p.offering_id AND o.workspace_id=p.workspace_id
    WHERE p.workspace_id=${input.workspace_id}::uuid AND p.contact_id=${input.contact_id}::uuid
      AND p.source_conversation_id=${input.conversation_id}::uuid AND p.status IN ('reserved','pending')
      AND NOT EXISTS (SELECT 1 FROM payment_intent_supersessions x WHERE x.payment_id=p.id)`;
  const codes = [...new Set([...open.map(candidate => candidate.offering_code), ...own.map(row => row.code)])].sort();
  if (codes.length > 1) return { kind: 'ambiguous', candidate_offering_codes: codes };
  const chosen = open[0]!;
  const stage = chosen.has_unpaid_link ? 'payment_link_sent'
    : chosen.stage === 'handoff' ? (chosen.payment_plan ? 'plan_selected' : 'course_selected') : chosen.stage;
  return { kind: 'single', offering_code: chosen.offering_code, payment_plan: chosen.payment_plan, stage,
    source_conversation_id: chosen.source_conversation_id, has_unpaid_link: chosen.has_unpaid_link };
}

/**
 * Copies a verified single sale (course, plan, stage) into the canonical
 * conversation's state when that state has no course yet. One guarded
 * statement updates the row and records the version event; a replay or a
 * concurrent writer finds the guard false and changes nothing. Payments,
 * offers and contact data are never touched.
 */
export async function materializeSaleContinuityV1(db: DbClient, input: Input): Promise<SaleContinuityV1> {
  const [state] = await db<Array<{ version: number; selected_offering_code: string | null }>>`
    SELECT version, selected_offering_code FROM conversation_sales_context_states_v1
    WHERE workspace_id=${input.workspace_id}::uuid AND contact_id=${input.contact_id}::uuid
      AND conversation_id=${input.conversation_id}::uuid`;
  if (!state || state.selected_offering_code !== null) return { kind: 'none' };
  const continuity = await resolveSaleContinuityV1(db, input);
  if (continuity.kind !== 'single') return continuity;
  await db`
    WITH updated AS (
      UPDATE conversation_sales_context_states_v1 AS state
      SET selected_offering_code=${continuity.offering_code}, selected_payment_plan=${continuity.payment_plan},
        stage=${continuity.stage}, awaiting_reply='none', payment_link_request=NULL,
        version=state.version+1, updated_at=now()
      WHERE state.workspace_id=${input.workspace_id}::uuid AND state.contact_id=${input.contact_id}::uuid
        AND state.conversation_id=${input.conversation_id}::uuid
        AND state.selected_offering_code IS NULL AND state.version=${state.version}
      RETURNING state.*
    )
    INSERT INTO conversation_sales_context_state_events_v1 (
      workspace_id, conversation_id, contact_id, state_version, source_turn_id,
      selected_offering_code, selected_payment_plan, stage,
      call_preference, call_offer_status, call_offer_count, awaiting_reply,
      payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks, payment_link_request
    )
    SELECT workspace_id, conversation_id, contact_id, version, NULL,
      selected_offering_code, selected_payment_plan, stage,
      call_preference, call_offer_status, call_offer_count, awaiting_reply,
      payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks, payment_link_request
    FROM updated ON CONFLICT DO NOTHING`;
  return continuity;
}
