import { readSalesFlowFlagsV1 } from './sales-flow-markers';
import { priceObservationQuoteInBatchV1 } from '@/shared/conversation/deterministic-sales-rules';
import { loadConversationSessionConfig } from '@/lib/config';
import { effectiveConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { reconcileTerminalCallStateV1, customerResumesCommercialFlowAfterCallV1, type CallLifecycleFactsV1 } from '@/features/conversation/domain/call-lifecycle-reconciliation';
import { classifyBatchSalesSignal } from '@/features/orchestration/domain/sales-signal';
import type { DbClient } from '@/lib/db/types';
import { CALL_START_TIMEOUT_SECONDS } from '@/features/calls/domain/call-timeouts';
import { readNegotiationFactsV1 } from '@/features/conversation/application/read-negotiation-facts';
import { confirmsPriceProbeV1, isBonusCheckoutStateV1, literalDeclineV1, priceExpressionHintV1, promoRequestV1 } from '@/shared/conversation/deterministic-sales-rules';
import { deriveCourseBonusLadderV1, mayOfferCallV1, type CourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';

/** Caller owns the state lock when authorizing an effect. Claims/proposals are never inputs. */
export async function readCourseBonusLadderV1(input: {
  workspace_id?: string; workspace_slug?: string; contact_id: string;
  conversation_id: string; source_turn_id?: string; selected_offering_code: string | null;
}, db: DbClient): Promise<CourseBonusLadderV1 | null> {
  const [row] = await db<Array<{
    workspace_slug: string; source_turn_id: string; stage: string; call_preference: string;
    call_offer_status: CourseBonusLadderV1['call_invitation_status']; call_offer_count: number;
    payment_reported: boolean; blocked: boolean; may_respond: boolean; active_call: string | null;
    prior_invitation: boolean; prior_invitation_count: number; customer_messages: string[]; last_call_result: CallLifecycleFactsV1['last_call_result'];
  }>>`
    SELECT w.slug workspace_slug,current.id source_turn_id,s.stage,s.call_preference,s.call_offer_status,
      s.call_offer_count,(s.payment_reported_at IS NOT NULL) payment_reported,
      ARRAY(SELECT fragment.content FROM messages fragment WHERE fragment.direction='inbound'
        AND fragment.contact_id=c.id AND fragment.conversation_id=v.id
        AND (fragment.id=current.id OR (fragment.batch_id=current.batch_id AND current.batch_id IS NOT NULL))
        ORDER BY fragment.conversation_seq) customer_messages,
      (SELECT jsonb_build_object('call_id',call.id,'result',call.result,'ended_at',coalesce(call.completed_at,call.updated_at))
        FROM call_sessions call WHERE call.contact_id=c.id AND call.conversation_id=v.id
          AND call.status IN ('completed','failed','no_answer','timed_out','cancelled')
        ORDER BY coalesce(call.completed_at,call.updated_at) DESC LIMIT 1) last_call_result,
      (coalesce(c.lifecycle_status IN ('blocked','deleted'),false) OR c.deleted_at IS NOT NULL OR c.status='inactivo') blocked,
      NOT EXISTS(SELECT 1 FROM contact_channel_permissions permission
        WHERE permission.contact_id=c.id AND permission.channel=v.channel AND permission.consent_status='revoked') may_respond,
      (SELECT call.id::text FROM call_sessions call WHERE call.contact_id=c.id AND call.conversation_id=v.id
        AND call.status IN ('requested','dispatching','provider_accepted','dispatch_ambiguous','in_progress')
        AND (call.status<>'provider_accepted' OR call.provider_accepted_at IS NULL
          OR call.provider_accepted_at>now()-make_interval(secs=>${CALL_START_TIMEOUT_SECONDS})) LIMIT 1) active_call,
      EXISTS(SELECT 1 FROM agent_decisions d JOIN messages source ON source.id=d.turn_id
        WHERE source.conversation_id=v.id AND source.contact_id=c.id AND source.direction='inbound'
          AND (message_occurrence_v1(source.metadata,source.created_at),coalesce(source.conversation_seq,0))
          < (message_occurrence_v1(current.metadata,current.created_at),coalesce(current.conversation_seq,0))
          AND (source.conversation_seq IS NULL OR current.conversation_seq IS NULL OR source.conversation_seq<current.conversation_seq) AND d.decision_kind='reply' AND d.response_type='call_offer') prior_invitation,
      (SELECT count(*)::int FROM agent_decisions d JOIN messages source ON source.id=d.turn_id
        WHERE source.conversation_id=v.id AND source.contact_id=c.id AND source.direction='inbound'
          AND (message_occurrence_v1(source.metadata,source.created_at),coalesce(source.conversation_seq,0))
          < (message_occurrence_v1(current.metadata,current.created_at),coalesce(current.conversation_seq,0))
          AND (source.conversation_seq IS NULL OR current.conversation_seq IS NULL OR source.conversation_seq<current.conversation_seq) AND d.decision_kind='reply' AND d.response_type='call_offer') prior_invitation_count
    FROM workspaces w JOIN conversation_sales_context_states_v1 s ON s.workspace_id=w.id
    JOIN contacts c ON c.id=s.contact_id JOIN conversations v ON v.id=s.conversation_id AND v.contact_id=c.id
    JOIN workspace_contacts wc ON wc.workspace_id=w.id AND wc.contact_id=c.id
    JOIN LATERAL(SELECT m.id,m.conversation_seq,m.metadata,m.created_at,m.batch_id FROM messages m WHERE m.conversation_id=v.id AND m.contact_id=c.id
      AND m.direction='inbound' AND (${input.source_turn_id ?? null}::uuid IS NULL OR m.id=${input.source_turn_id ?? null}::uuid)
      ORDER BY m.conversation_seq DESC LIMIT 1) current ON true
    WHERE w.status='active' AND (${input.workspace_id ?? null}::uuid IS NULL OR w.id=${input.workspace_id ?? null}::uuid)
      AND (${input.workspace_slug ?? null}::text IS NULL OR w.slug=${input.workspace_slug ?? null})
      AND v.id=${input.conversation_id}::uuid AND c.id=${input.contact_id}::uuid
  `;
  if (!row) return null;
  const facts = await readNegotiationFactsV1({ ...input, workspace_slug: row.workspace_slug, source_turn_id: row.source_turn_id }, { db });
  const { PostgresConversationStateStoreV1 } = await import('@/features/conversation/adapters/postgres-conversation-state-store');
  const loaded=await new PostgresConversationStateStoreV1(db).load(row.workspace_slug,input.conversation_id,input.contact_id);
  if (!loaded) return null;
  const session=effectiveConversationStateV1(loaded,Date.now(),loadConversationSessionConfig().sessionIdleMs);
  const signal=classifyBatchSalesSignal(row.customer_messages,{pendingCallReply:session.awaiting_reply==='call_or_chat'});
  const state=reconcileTerminalCallStateV1(session,{
    active_call:row.active_call ? {call_id:row.active_call,status:'active'} : null,last_call_result:row.last_call_result,
  },{current_customer_signal:signal.type,current_customer_resumes_commercial_flow:customerResumesCommercialFlowAfterCallV1(row.customer_messages)});
  const count = Math.max(state.call_offer_count, Math.min(2, row.prior_invitation_count));
  const status = state.call_offer_status === 'not_offered' && row.prior_invitation ? 'offered' : state.call_offer_status;
  // Rule A counts this turn's committed model memory too. Before the decision is
  // persisted (context time) nothing matches; at offer time the same transaction
  // already holds it. The quote must be literal customer text of this batch.
  const [current] = await db<Array<{ candidates: Array<{type:string;key:string;source_quote:string}> | null; price_only: boolean }>>`
    SELECT
      (SELECT d.memory_candidates FROM agent_decisions d
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply' LIMIT 1) candidates,
      EXISTS(SELECT 1 FROM agent_decisions d CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(d.negotiation_observations)='array' THEN d.negotiation_observations ELSE '[]'::jsonb END) observation
        WHERE d.turn_id=${row.source_turn_id}::uuid AND d.decision_kind='reply'
          AND observation->>'status'='confirmed'
          AND (observation->>'offering_code') IS NOT DISTINCT FROM ${input.selected_offering_code}) price_only
  `;
  const currentObjection = current?.candidates?.some(candidate => candidate.type === 'objection'
    && candidate.key === 'price_objection' && priceObservationQuoteInBatchV1(candidate.source_quote, row.customer_messages)) === true;
  const currentPriceOnly = current?.price_only === true;
  const priorObjectionIsCurrent = facts?.latest_price_objection_source_turn_ids.includes(row.source_turn_id) === true;
  // Owner rule (2026-11-02, second revision): any promo/discount request, or a
  // confirmation of the "precio es el único inconveniente?" question, enables
  // the offer instantly and counts as a new objection for escalation.
  const previousAgent = await db<Array<{ content: string }>>`
    SELECT prior.content FROM messages prior JOIN messages current ON current.id=${row.source_turn_id}::uuid
    WHERE prior.conversation_id=current.conversation_id AND prior.contact_id=current.contact_id
      AND prior.direction='outbound' AND prior.created_at < current.created_at
    ORDER BY prior.created_at DESC LIMIT 3`;
  const inCheckout = isBonusCheckoutStateV1({ stage: state.stage, awaiting_reply: state.awaiting_reply,
    payment_link_request_pending: false }, row.customer_messages) || state.payment_reported_at !== null || row.payment_reported;
  const [liveOffer] = await db<Array<{ live: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM promotion_offers o WHERE o.conversation_id=${input.conversation_id}::uuid
      AND o.contact_id=${input.contact_id}::uuid AND o.package_mode='direct' AND o.status='offered') live`;
  // Owner 2026-11-03 flow, from persisted markers: after a "no" to the price
  // question a new complaint offers directly; the first literal decline with
  // fewer than 3 gifts and unused retention offers the next gift once.
  const flow = await readSalesFlowFlagsV1(db, input.conversation_id);
  const [gifts] = await db<Array<{ n: number }>>`SELECT count(b.*)::int n FROM promotion_offers o
    JOIN promotion_offer_bonus_offerings b ON b.offer_id=o.id
    WHERE o.conversation_id=${input.conversation_id}::uuid AND o.contact_id=${input.contact_id}::uuid
      AND o.package_mode='direct' AND o.status='offered'`;
  const flowTrigger = !inCheckout && (
    (flow.price_probe === 'no' && row.customer_messages.some(priceExpressionHintV1))
    || (!flow.retention_used && flow.price_probe !== 'asked' && (gifts?.n ?? 0) < 3 && literalDeclineV1(row.customer_messages)));
  const instantTrigger = flowTrigger || !inCheckout && (row.customer_messages.some(promoRequestV1)
    || (liveOffer?.live === true && row.customer_messages.some(priceExpressionHintV1)))
    || !inCheckout && confirmsPriceProbeV1(row.customer_messages, previousAgent.map(message => message.content));
  // The locked scope above is authoritative for this turn. A first-turn promo
  // or a current committed price-only observation is valid even when there is
  // no prior negotiation history to project yet. An invalid scope still exits
  // at `row`, `loaded` or the current decision lookup; history alone never
  // becomes a fresh escalation trigger.
  if (!facts && !instantTrigger && !currentPriceOnly) return null;
  const ladder = deriveCourseBonusLadderV1({
    observed_price_objection_count: (facts?.price_objection_count ?? 0) + (currentObjection && !priorObjectionIsCurrent ? 1 : 0),
    price_only_barrier_confirmed: facts?.price_only_barrier.status === 'confirmed' || currentPriceOnly,
    call_invitation_status: status, call_offer_count: count,
    may_offer_call: mayOfferCallV1({ ...row,stage:state.stage,call_preference:state.call_preference,
      payment_reported:state.payment_reported_at!==null,call_offer_count:count,call_offer_status:status }) });
  return instantTrigger
    ? { ...ladder, eligible: true, missing_steps: [], current_turn_price_objection: true, instant_trigger: true }
    : { ...ladder, current_turn_price_objection: currentObjection || currentPriceOnly };
}
