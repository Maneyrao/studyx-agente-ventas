import { readCourseBonusLadderV1 } from './read-course-bonus-ladder';
import { customerBonusRequestThisTurnV1 } from './read-course-bonus-capability';
import { validateBonusMotiveV1, type BonusMotiveV1 } from '@/shared/conversation/bonus-motive';
import { createHash } from 'node:crypto';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { loadCentralCargaBonusConfig } from '@/features/fulfillment/central-carga/config';
import { isCentralCargaBonusEnabledForStoredContact } from '@/features/fulfillment/central-carga/bonus-contact-permission';
import { loadCourseBonusFlowConfig } from './course-bonus-flow-config';
import { authorizedBonusCodesV1, courseCodesNamedInBatchV1, isBonusCheckoutStateV1 } from '@/shared/conversation/deterministic-sales-rules';
import { TERMINAL_CALL_STATUSES } from '@/features/calls/domain/call-state';

export type DirectCourseBonusRejectionV1 = 'bonus_disabled' | 'no_price_objection' | 'invalid_offering'
  | 'same_as_paid_course' | 'duplicate_bonus' | 'bonus_limit_reached' | 'multiple_bonus_in_turn'
  | 'bonus_without_reply' | 'sale_already_closed' | 'stale_offer_version' | 'ladder_step_pending';
interface Identity {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly paid_offering_code: string;
  readonly source_turn_id: string;
  readonly expected_offer_version: number;
  readonly promotion_code?: string | null;
  readonly promotion_cycle_id?: string | null;
}
export interface OfferDirectCourseBonusInputV1 extends Identity {
  readonly bonus_offering_codes: readonly string[];
  /** Motive and declared moves of the authorized proposal; required unless the offer is a literal swap. */
  readonly motive?: BonusMotiveV1;
  readonly declared_moves?: readonly string[];
  readonly outbound: {
    readonly id: string;
    readonly content: string;
    /** Position of this bubble in a multi-part reply (Rule A fixed fallback). */
    readonly part_index?: number;
    readonly provider: string;
    readonly integration_id: string;
    readonly channel: string;
    readonly destination: string;
    readonly idempotency_key: string;
  };
}
export interface AcceptDirectCourseBonusInputV1 extends Identity {
  readonly promotion_code: string;
  readonly promotion_cycle_id: string;
}
interface DurableResult {
  readonly ok: true;
  readonly offer_id: string;
  readonly promotion_code: string;
  readonly promotion_cycle_id: string;
  readonly offer_version: number;
}
type Rejected = { readonly ok: false; readonly reason: DirectCourseBonusRejectionV1; readonly motive_reason?: string };
export type DirectCourseBonusResultV1 = (DurableResult & { readonly outbound_message_id: string }) | Rejected;
export type AcceptDirectCourseBonusResultV1 = DurableResult | Rejected;
export const MAX_BONUS_SWAPS_PER_CONVERSATION_V1 = 3;
class Rejection extends Error {
  constructor(readonly reason: DirectCourseBonusRejectionV1, readonly motive_reason?: string) { super(reason); }
}
function reject(reason: DirectCourseBonusRejectionV1): never { throw new Rejection(reason); }

// These are the database's closed domain errors. Unknown/database availability errors propagate.
const SQL_REJECTIONS: Readonly<Record<string, DirectCourseBonusRejectionV1>> = {
  'Direct bonus version mismatch': 'stale_offer_version',
  'Direct bonus offer required': 'stale_offer_version',
  'Direct bonus cycle is closed': 'sale_already_closed',
  'Direct bonus cycle is closed or sealed': 'sale_already_closed',
  'Promotion offer bonus snapshot is sealed': 'sale_already_closed',
  'Direct bonus course limit reached': 'bonus_limit_reached',
  'Invalid direct bonus course': 'invalid_offering',
  'Duplicate direct bonus course': 'duplicate_bonus',
  'Customer turn already used for a direct bonus': 'multiple_bonus_in_turn',
  'Confirmed prior delivery required': 'bonus_without_reply',
  'Distinct correlated customer turn required': 'bonus_without_reply',
  'Customer turn must be later than confirmed delivery': 'bonus_without_reply',
  'Direct bonus turn/outbound identity mismatch': 'bonus_without_reply',
  'Durable channel delivery row required': 'bonus_without_reply',
};
async function transaction<T>(db: DbClient, work: (tx: DbClient) => Promise<T>): Promise<T> {
  // A caller already committing a turn owns the outer transaction; a rejection rolls back this savepoint.
  return 'begin' in db ? await db.begin(work) as T : await db.savepoint(work) as T;
}
async function authorizedLimit(input: Identity, db: DbClient): Promise<number | null> {
  let config: ReturnType<typeof loadCourseBonusFlowConfig>;
  let bonusConfig: ReturnType<typeof loadCentralCargaBonusConfig>;
  try {
    config = loadCourseBonusFlowConfig();
    bonusConfig = loadCentralCargaBonusConfig();
  } catch { return null; }
  return config.mode === 'direct' && await isCentralCargaBonusEnabledForStoredContact(bonusConfig,
    { contactId: input.contact_id, workspaceId: input.workspace_id }, db)
    ? config.maxBonusCourses : null;
}
async function mayAcceptExistingPackage(input: Identity, db: DbClient): Promise<boolean> {
  let mode: ReturnType<typeof loadCourseBonusFlowConfig>['mode'];
  try {
    // Review stops new promises, not acceptance of an already delivered one.
    mode = loadCourseBonusFlowConfig().mode;
  } catch { return false; }
  return mode === 'review' || await authorizedLimit(input, db) !== null;
}
async function execute<T>(db: DbClient, work: (tx: DbClient) => Promise<T>): Promise<T | Rejected> {
  try { return await transaction(db, work); } catch (error) {
    if (error instanceof Rejection) return { ok: false, reason: error.reason, ...(error.motive_reason ? { motive_reason: error.motive_reason } : {}) };
    if (error instanceof Error && SQL_REJECTIONS[error.message]) {
      return { ok: false, reason: SQL_REJECTIONS[error.message] };
    }
    const postgresError=getPostgresError(error);
    if (postgresError?.code==='23505' && [
      'promotion_offers_pkey', 'promotion_offers_promotion_cycle_id_key',
      'promotion_offers_one_live_rule_uq', 'promotion_offers_one_live_paid_course_uq',
      'messages_pkey', 'messages_in_reply_to_part_unique',
      'outbound_deliveries_provider_idempotency_uq',
    ].includes(postgresError.constraint_name ?? '')) return {ok:false,reason:'stale_offer_version'};
    throw error;
  }
}
interface OfferRow {
  id: string; promotion_id: string; promotion_code: string; promotion_cycle_id: string;
  offer_version: number; status: string; accepted_source_turn_id: string | null;
  expires_at: Date | null;
}
function durable(offer: OfferRow, version = offer.offer_version): DurableResult {
  return { ok: true, offer_id: offer.id, promotion_code: offer.promotion_code,
    promotion_cycle_id: offer.promotion_cycle_id, offer_version: version };
}
async function validateExistingPackage(tx: DbClient, offer: OfferRow): Promise<void> {
  const [snapshot] = await tx<Array<{valid:boolean}>>`SELECT count(*) BETWEEN 1 AND 3
    AND count(*)=${offer.offer_version} AND min(position)=1 AND max(position)=${offer.offer_version}
    AND bool_and(position=offer_version) AS valid
    FROM promotion_offer_bonus_offerings WHERE offer_id=${offer.id}::uuid`;
  if (!snapshot.valid) reject('stale_offer_version');
}
async function lockIdentity(tx: DbClient, input: Identity) {
  const [context] = await tx<Array<{stage: string; awaiting_reply: string; payment_link_request: {status?: string}|null; selected_offering_code: string | null; paid_id: string; paid_status: string; paid_type: string; handoff_call_settled: boolean}>>`
    SELECT s.stage,s.awaiting_reply,s.payment_link_request,s.selected_offering_code,paid.id AS paid_id,paid.status AS paid_status,paid.offering_type AS paid_type,
      COALESCE((SELECT latest.status = ANY(${TERMINAL_CALL_STATUSES as unknown as string[]}::text[]) FROM call_sessions latest
        WHERE latest.conversation_id = s.conversation_id AND latest.contact_id = s.contact_id
        ORDER BY latest.requested_at DESC, latest.id DESC LIMIT 1), false) AS handoff_call_settled
    FROM conversation_sales_context_states_v1 s
    JOIN conversations c ON c.id=s.conversation_id AND c.contact_id=s.contact_id
    JOIN workspace_contacts wc ON wc.workspace_id=s.workspace_id AND wc.contact_id=s.contact_id
    JOIN offerings paid ON paid.workspace_id=s.workspace_id AND paid.code=${input.paid_offering_code}
    WHERE s.workspace_id=${input.workspace_id}::uuid AND s.conversation_id=${input.conversation_id}::uuid
      AND s.contact_id=${input.contact_id}::uuid FOR UPDATE OF s FOR SHARE OF paid
  `;
  if (!context) reject('invalid_offering');
  // Purchase selection determines the course, never the provenance of its
  // commercial evidence. Lock that evidence in both selected/interest paths.
  const [interest]=await tx<Array<{interest_offering_code:string;source_turn_id:string}>>`
      SELECT interest.interest_offering_code,interest.source_turn_id
      FROM conversation_promotion_context_v1 interest
      WHERE interest.workspace_id=${input.workspace_id}::uuid AND interest.conversation_id=${input.conversation_id}::uuid
        AND interest.contact_id=${input.contact_id}::uuid
      FOR SHARE OF interest
  `;
  const [source]=interest ? await tx<Array<{prior:boolean}>>`
      SELECT source.id<>current.id AND
        message_occurrence_v1(source.metadata,source.created_at)<message_occurrence_v1(current.metadata,current.created_at) AS prior
      FROM messages source JOIN messages current ON current.id=${input.source_turn_id}::uuid
      WHERE source.id=${interest.source_turn_id}::uuid AND source.conversation_id=${input.conversation_id}::uuid
        AND source.contact_id=${input.contact_id}::uuid AND source.direction='inbound'
        AND current.conversation_id=source.conversation_id AND current.contact_id=source.contact_id AND current.direction='inbound'
        AND message_occurrence_v1(source.metadata,source.created_at)<=message_occurrence_v1(current.metadata,current.created_at)
      FOR SHARE OF source,current
  ` : [];
  // A question about a gift changes explanatory focus only. Preserve the live
  // package's paid identity without persisting a purchase selection or lending
  // its objection evidence to a different paid course.
  const [packageIdentity]=!context.selected_offering_code && source && interest
    ? await tx<Array<{paid_code:string}>>`
      SELECT paid.code AS paid_code FROM promotion_offers o
      JOIN offerings paid ON paid.id=o.paid_offering_id AND paid.workspace_id=o.workspace_id
      WHERE o.workspace_id=${input.workspace_id}::uuid AND o.conversation_id=${input.conversation_id}::uuid
        AND o.contact_id=${input.contact_id}::uuid AND o.package_mode='direct'
        AND o.status IN ('offered','accepted','attached')
        AND NOT EXISTS(SELECT 1 FROM payment_intent_supersessions superseded WHERE superseded.payment_id=o.payment_id)
        AND EXISTS(SELECT 1 FROM promotion_offer_bonus_offerings gift WHERE gift.offer_id=o.id
          AND gift.offering_code_snapshot=${interest.interest_offering_code})
      ORDER BY o.created_at DESC LIMIT 1 FOR UPDATE OF o
    ` : [];
  // Effective identity only; never persist a purchase selection. Same-turn
  // interest can identify a course, but cannot establish a prior objection.
  // Same fallback as the capability (owner 2026-11-03): the live direct package's paid course.
  const resolved=context.selected_offering_code ?? packageIdentity?.paid_code ?? (source ? interest.interest_offering_code : null);
  const [livePackage]=resolved ? [] : await tx<Array<{paid_code:string}>>`
    SELECT paid.code AS paid_code FROM promotion_offers o
    JOIN offerings paid ON paid.id=o.paid_offering_id AND paid.workspace_id=o.workspace_id
    WHERE o.workspace_id=${input.workspace_id}::uuid AND o.conversation_id=${input.conversation_id}::uuid
      AND o.contact_id=${input.contact_id}::uuid AND o.package_mode='direct' AND o.status='offered'
    ORDER BY o.created_at DESC LIMIT 1 FOR UPDATE OF o`;
  return {...context,selected_offering_code:resolved ?? livePackage?.paid_code ?? null};
}
async function resolveOffer(tx: DbClient, input: Identity, paidId: string): Promise<OfferRow | undefined> {
  const [offer] = await tx<OfferRow[]>`
    SELECT o.*,p.promotion_code FROM promotion_offers o JOIN promotions p ON p.id=o.promotion_id
    WHERE o.workspace_id=${input.workspace_id}::uuid AND o.contact_id=${input.contact_id}::uuid
      AND o.conversation_id=${input.conversation_id}::uuid AND o.paid_offering_id=${paidId}::uuid
      AND o.package_mode='direct'
      AND (${input.promotion_cycle_id ?? null}::uuid IS NULL OR o.promotion_cycle_id=${input.promotion_cycle_id ?? null}::uuid)
      AND (${input.promotion_code ?? null}::text IS NULL OR p.promotion_code=${input.promotion_code ?? null})
      AND (o.status IN ('pending_review','offered','accepted','attached') OR o.promotion_cycle_id=${input.promotion_cycle_id ?? null}::uuid
        OR EXISTS(SELECT 1 FROM promotion_offer_bonus_offerings b WHERE b.offer_id=o.id AND b.source_turn_id=${input.source_turn_id}::uuid))
    ORDER BY EXISTS(SELECT 1 FROM promotion_offer_bonus_offerings b WHERE b.offer_id=o.id AND b.source_turn_id=${input.source_turn_id}::uuid) DESC,
      o.created_at DESC LIMIT 1 FOR UPDATE OF o
  `;
  return offer;
}
async function validateOpen(tx: DbClient, input: Identity, context: {stage:string;selected_offering_code:string|null;paid_id:string;paid_status:string;paid_type:string}, offer?: OfferRow) {
  if (context.stage==='closed' || (offer && !['pending_review','offered'].includes(offer.status))) reject('sale_already_closed');
  if (context.selected_offering_code!==input.paid_offering_code || context.paid_status!=='active' || context.paid_type!=='course') reject('invalid_offering');
  if (offer?.expires_at && offer.expires_at.getTime()<=Date.now()) reject('stale_offer_version');
  const [facts] = await tx<Array<{paid: boolean;eligible: boolean}>>`
    SELECT EXISTS(SELECT 1 FROM payments WHERE workspace_id=${input.workspace_id}::uuid
      AND contact_id=${input.contact_id}::uuid AND offering_id=${context.paid_id}::uuid
      AND source_conversation_id=${input.conversation_id}::uuid
      AND status='paid') AS paid,
      EXISTS(SELECT 1 FROM contacts WHERE id=${input.contact_id}::uuid AND status<>'inactivo'
        AND coalesce(lifecycle_status,'active')='active' AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM contact_channel_permissions permission
          JOIN conversations conversation ON conversation.id=${input.conversation_id}::uuid
          WHERE permission.contact_id=${input.contact_id}::uuid AND permission.channel=conversation.channel
            AND permission.consent_status='revoked')) AS eligible
  `;
  if (facts.paid) reject('sale_already_closed');
  if (!facts.eligible) reject('bonus_disabled');
  if (offer) {
    const [promotion] = await tx`SELECT id FROM promotions WHERE id=${offer.promotion_id}::uuid
      AND workspace_id=${input.workspace_id}::uuid AND active=true AND 'text'=ANY(channels)
      AND (valid_from IS NULL OR valid_from<=now()) AND (valid_until IS NULL OR valid_until>now())
      AND (SELECT count(*) FROM promotion_offers WHERE promotion_id=${offer.promotion_id}::uuid
        AND contact_id=${input.contact_id}::uuid AND status='attached')<max_redemptions_per_contact FOR SHARE`;
    if (!promotion) reject('bonus_disabled');
  }
}

export async function offerDirectCourseBonusV1(db: DbClient, input: OfferDirectCourseBonusInputV1): Promise<DirectCourseBonusResultV1> {
  const limit=await authorizedLimit(input, db);
  if (!limit) return {ok:false,reason:'bonus_disabled'};
  return execute(db, async tx => {
    if (await authorizedLimit(input, tx) !== limit) reject('bonus_disabled');
    if (input.bonus_offering_codes.length!==1) reject('multiple_bonus_in_turn');
    if (!input.outbound.content.trim()) reject('bonus_without_reply');
    if (!Number.isInteger(input.expected_offer_version) || input.expected_offer_version<0
      || (input.expected_offer_version>0 && (!input.promotion_code || !input.promotion_cycle_id))) reject('stale_offer_version');
    const context=await lockIdentity(tx,input);
    let offer=await resolveOffer(tx,input,context.paid_id);
    // Owner 2026-11-03 swap replay: the new cycle created by this exact reply.
    const [swapReplay]=await tx<Array<OfferRow & {replay_version:number;exact:boolean}>>`
      SELECT o.*,p.promotion_code,b.offer_version AS replay_version,
        (b.offering_code_snapshot=${input.bonus_offering_codes[0]} AND m.id=${input.outbound.id}::uuid AND m.content=${input.outbound.content}
          AND d.provider=${input.outbound.provider} AND d.integration_id=${input.outbound.integration_id}
          AND d.channel=${input.outbound.channel} AND d.destination=${input.outbound.destination}
          AND d.idempotency_key=${input.outbound.idempotency_key}) AS exact
      FROM promotion_offer_bonus_offerings b JOIN promotion_offers o ON o.id=b.offer_id
      JOIN promotions p ON p.id=o.promotion_id JOIN messages m ON m.id=b.offered_outbound_message_id
      JOIN outbound_deliveries d ON d.message_id=m.id
      WHERE b.source_turn_id=${input.source_turn_id}::uuid AND d.idempotency_key=${input.outbound.idempotency_key}
        AND o.conversation_id=${input.conversation_id}::uuid AND o.contact_id=${input.contact_id}::uuid
        AND o.package_mode='direct' AND o.id IS DISTINCT FROM ${offer?.id ?? null}::uuid`;
    if (swapReplay) {
      if (!swapReplay.exact) reject('stale_offer_version');
      return {...durable(swapReplay,swapReplay.replay_version),outbound_message_id:input.outbound.id};
    }
    if (offer) {
      const [replay] = await tx<Array<{offer_version:number;offered_outbound_message_id:string;exact:boolean}>>`
        SELECT b.offer_version,b.offered_outbound_message_id,
          (b.offering_code_snapshot=${input.bonus_offering_codes[0]} AND b.offer_version=${input.expected_offer_version+1}
            AND m.id=${input.outbound.id}::uuid AND m.content=${input.outbound.content}
            AND d.provider=${input.outbound.provider} AND d.integration_id=${input.outbound.integration_id}
            AND d.channel=${input.outbound.channel} AND d.destination=${input.outbound.destination}
            AND d.idempotency_key=${input.outbound.idempotency_key}) AS exact
        FROM promotion_offer_bonus_offerings b JOIN messages m ON m.id=b.offered_outbound_message_id
        JOIN outbound_deliveries d ON d.message_id=m.id
        WHERE b.offer_id=${offer.id}::uuid AND b.source_turn_id=${input.source_turn_id}::uuid
      `;
      if (replay?.exact) return {...durable(offer,replay.offer_version),outbound_message_id:replay.offered_outbound_message_id};
      if (offer.offer_version!==input.expected_offer_version) reject(replay?.offered_outbound_message_id===input.outbound.id ? 'multiple_bonus_in_turn' : 'stale_offer_version');
      if (replay) reject('multiple_bonus_in_turn');
    } else if (input.expected_offer_version!==0 || input.promotion_cycle_id || input.promotion_code) {
      // Explicit first-cycle identity is supported only for an existing authorized promotion below.
      if (input.expected_offer_version!==0) reject('stale_offer_version');
    }
    const currentBatch = (await tx<Array<{ content: string }>>`
      SELECT fragment.content FROM messages current JOIN messages fragment
        ON fragment.conversation_id=current.conversation_id AND fragment.contact_id=current.contact_id
        AND fragment.direction='inbound' AND (fragment.id=current.id OR (fragment.batch_id=current.batch_id AND current.batch_id IS NOT NULL))
      WHERE current.id=${input.source_turn_id}::uuid AND current.conversation_id=${input.conversation_id}::uuid
        AND current.contact_id=${input.contact_id}::uuid
      ORDER BY fragment.conversation_seq`).map(row => row.content);
    if (isBonusCheckoutStateV1({ stage: context.stage, awaiting_reply: context.awaiting_reply,
      payment_link_request_pending: context.payment_link_request?.status === 'pending',
      handoff_call_settled: context.handoff_call_settled })) reject('sale_already_closed');
    await validateOpen(tx,input,context,offer);
    if (input.bonus_offering_codes[0]===input.paid_offering_code) reject('same_as_paid_course');
    const [bonus]=await tx`SELECT id FROM offerings WHERE workspace_id=${input.workspace_id}::uuid
      AND code=${input.bonus_offering_codes[0]} AND status='active' AND offering_type='course' FOR SHARE`;
    if (!bonus) reject('invalid_offering');
    const active=await tx<Array<{code:string;display_name:string;aliases:string[]|null}>>`SELECT code,display_name,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(metadata->'aliases')='array' THEN metadata->'aliases' ELSE '[]'::jsonb END)) aliases
      FROM offerings WHERE workspace_id=${input.workspace_id}::uuid AND status='active' AND offering_type='course'`;
    const offered=offer ? await tx<Array<{code:string}>>`SELECT offering_code_snapshot code FROM promotion_offer_bonus_offerings
      WHERE offer_id=${offer.id}::uuid ORDER BY position` : [];
    // Owner 2026-11-03: a literal customer swap of this exact course (same detector as the capability).
    const request=await customerBonusRequestThisTurnV1({...input,selected_offering_code:input.paid_offering_code},tx,active,
      offer?.status==='offered' ? offered.map(row=>row.code) : [],limit);
    const chosen=request?.bonus_offering_code===input.bonus_offering_codes[0] ? request : null;
    const swap=chosen?.kind==='swap' && offer?.status==='offered' && offer.offer_version===1 && offered.length===1
      && offered[0]!.code===chosen.replaced_offering_code ? chosen : null;
    if (chosen?.kind==='swap' && !swap) reject('stale_offer_version');
    if (!chosen) {
      // The motive comes from the current batch; no persisted memory authorizes it.
      const evidence=await readCourseBonusLadderV1({...input,selected_offering_code:context.selected_offering_code},tx);
      const motiveReason=validateBonusMotiveV1({motive:input.motive,moves:input.declared_moves ?? [],batch:currentBatch,
        has_delivered_bonus:offered.length>0,retention_used:evidence?.retention_used ?? false,
        purchase_decline_recorded:evidence?.purchase_decline_recorded ?? false,
        previous_turn_asked_price_question:evidence?.previous_turn_asked_price_question ?? false});
      if (motiveReason) throw new Rejection('ladder_step_pending',motiveReason);
    }
    if (!swap && offer && offer.offer_version>=limit) reject('bonus_limit_reached');
    // The model chooses the course; it must belong to the authorized set: the
    // paid course's affinity row, the universal bridges or a course the customer named literally.
    if (!chosen && !authorizedBonusCodesV1({paid_code:input.paid_offering_code,active_codes:active.map(row=>row.code),
      named_codes:courseCodesNamedInBatchV1(currentBatch,active)}).includes(input.bonus_offering_codes[0]!)
      && !offered.some(row=>row.code===input.bonus_offering_codes[0])) reject('invalid_offering');
    let replacedExpiresAt: Date | null = null;
    if (swap && offer) {
      // Never swap under a live call: the voice store reads the offered cycle.
      const [call]=await tx`SELECT 1 FROM call_sessions WHERE conversation_id=${input.conversation_id}::uuid
        AND contact_id=${input.contact_id}::uuid
        AND status IN ('requested','dispatching','provider_accepted','dispatch_ambiguous','in_progress') LIMIT 1`;
      if (call) reject('stale_offer_version');
      // A swap never adds a gift; cap the churn anyway (security review 2026-11-03).
      const [swaps]=await tx<Array<{n:number}>>`SELECT count(*)::int n FROM promotion_offers
        WHERE conversation_id=${input.conversation_id}::uuid AND contact_id=${input.contact_id}::uuid
          AND cancel_reason='CUSTOMER_REPLACED_BONUS'`;
      if ((swaps?.n ?? 0)>=MAX_BONUS_SWAPS_PER_CONVERSATION_V1) reject('bonus_limit_reached');
      replacedExpiresAt=offer.expires_at ?? null;
      // History is kept: the old cycle is cancelled, never rewritten.
      await tx`UPDATE promotion_offers SET status='cancelled',cancel_reason='CUSTOMER_REPLACED_BONUS' WHERE id=${offer.id}::uuid`;
      await tx`UPDATE course_bonus_followups SET status='cancelled',terminal_reason='CUSTOMER_REPLACED_BONUS'
        WHERE offer_id=${offer.id}::uuid AND status='pending'`;
      offer=undefined;
    }
    if (offer) {
      if ((await tx`SELECT id FROM promotion_offer_bonus_offerings WHERE offer_id=${offer.id}::uuid AND offering_id=${bonus.id}::uuid`).length) reject('duplicate_bonus');
    } else {
      const code=(swap ? null : input.promotion_code) ?? `any_bonus_${createHash('sha256').update(`${input.paid_offering_code}\u0000${input.bonus_offering_codes[0]}`).digest('hex').slice(0,32)}`;
      if (swap || !input.promotion_code) await tx`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
        VALUES (${input.workspace_id}::uuid,${code},${context.paid_id}::uuid,ARRAY['text'],true) ON CONFLICT(workspace_id,promotion_code) DO NOTHING`;
      const [promotion]=await tx`SELECT id FROM promotions WHERE workspace_id=${input.workspace_id}::uuid
        AND promotion_code=${code} AND paid_offering_id=${context.paid_id}::uuid AND active=true
        AND 'text'=ANY(channels) AND (valid_from IS NULL OR valid_from<=now()) AND (valid_until IS NULL OR valid_until>now()) FOR SHARE`;
      if (!promotion) reject('bonus_disabled');
      const [created]=await tx<OfferRow[]>`INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,package_mode,promotion_cycle_id)
        VALUES (${input.workspace_id}::uuid,${input.contact_id}::uuid,${input.conversation_id}::uuid,${promotion.id}::uuid,${context.paid_id}::uuid,'direct',COALESCE(${swap ? null : input.promotion_cycle_id ?? null}::uuid,gen_random_uuid())) RETURNING *`;
      offer={...created,promotion_code:code};
      if (replacedExpiresAt) {
        // The replacement keeps the original promotion window.
        await tx`UPDATE promotion_offers SET expires_at=${replacedExpiresAt} WHERE id=${created.id}::uuid`;
        offer={...offer,expires_at:replacedExpiresAt};
      }
      await validateOpen(tx,input,context,offer);
    }
    await tx`INSERT INTO messages(id,conversation_id,contact_id,direction,content,in_reply_to,part_index)
      VALUES (${input.outbound.id}::uuid,${input.conversation_id}::uuid,${input.contact_id}::uuid,'outbound',${input.outbound.content},${input.source_turn_id}::uuid,${input.outbound.part_index ?? 0})`;
    await tx`INSERT INTO outbound_deliveries(message_id,conversation_id,contact_id,provider,integration_id,channel,destination,idempotency_key)
      VALUES (${input.outbound.id}::uuid,${input.conversation_id}::uuid,${input.contact_id}::uuid,${input.outbound.provider},${input.outbound.integration_id},${input.outbound.channel},${input.outbound.destination},${input.outbound.idempotency_key})`;
    const [result]=await tx<Array<{version:number}>>`SELECT append_direct_course_bonus(${offer.id}::uuid,${bonus.id}::uuid,${input.source_turn_id}::uuid,${input.outbound.id}::uuid,${swap ? 0 : input.expected_offer_version}) AS version`;
    return {...durable(offer,result.version),outbound_message_id:input.outbound.id};
  });
}

export async function acceptDirectCourseBonusV1(db: DbClient, input: AcceptDirectCourseBonusInputV1): Promise<AcceptDirectCourseBonusResultV1> {
  if (!await mayAcceptExistingPackage(input, db)) return {ok:false,reason:'bonus_disabled'};
  return execute(db,async tx=>{
    if (!await mayAcceptExistingPackage(input, tx)) reject('bonus_disabled');
    if (!input.promotion_code || !input.promotion_cycle_id || !Number.isInteger(input.expected_offer_version) || input.expected_offer_version<1) reject('stale_offer_version');
    const context=await lockIdentity(tx,input);
    const offer=await resolveOffer(tx,input,context.paid_id);
    if (!offer || offer.offer_version!==input.expected_offer_version) reject('stale_offer_version');
    await validateExistingPackage(tx,offer);
    if (['accepted','attached'].includes(offer.status) && offer.accepted_source_turn_id===input.source_turn_id) return durable(offer);
    await validateOpen(tx,input,context,offer);
    await tx`SELECT accept_direct_course_bonus(${offer.id}::uuid,${input.source_turn_id}::uuid,${input.expected_offer_version})`;
    return durable(offer);
  });
}

/** Only called after the Retell signature and canonical call correlation are verified. */
export async function acceptDirectCourseBonusByVoiceV1(db: DbClient, input: AcceptDirectCourseBonusInputV1 & {
  readonly call_id: string;
}): Promise<AcceptDirectCourseBonusResultV1> {
  return execute(db,async tx=>{
    if (!input.promotion_code || !input.promotion_cycle_id || !Number.isInteger(input.expected_offer_version)
      || input.expected_offer_version<1) reject('stale_offer_version');
    const context=await lockIdentity(tx,input);
    const offer=await resolveOffer(tx,input,context.paid_id);
    if (!offer || offer.offer_version!==input.expected_offer_version) reject('stale_offer_version');
    await validateExistingPackage(tx,offer);
    const [call]=await tx`SELECT id FROM call_sessions WHERE id=${input.call_id}::uuid
      AND workspace_id=${input.workspace_id}::uuid AND contact_id=${input.contact_id}::uuid
      AND conversation_id=${input.conversation_id}::uuid AND source_turn_id=${input.source_turn_id}::uuid
      AND provider='retell' AND provider_call_id IS NOT NULL
      AND status IN ('provider_accepted','in_progress') FOR SHARE`;
    if (!call) reject('bonus_without_reply');
    if (['accepted','attached'].includes(offer.status)) {
      const [evidence]=await tx`SELECT call_id FROM promotion_voice_acceptances WHERE offer_id=${offer.id}::uuid`;
      if (evidence && evidence.call_id!==input.call_id) reject('stale_offer_version');
      return durable(offer);
    }
    if (!await mayAcceptExistingPackage(input, tx)) reject('bonus_disabled');
    await validateOpen(tx,input,context,offer);
    await tx`INSERT INTO promotion_voice_acceptances(offer_id,call_id,workspace_id,contact_id,conversation_id,promotion_cycle_id,offer_version)
      VALUES (${offer.id}::uuid,${input.call_id}::uuid,${input.workspace_id}::uuid,${input.contact_id}::uuid,
        ${input.conversation_id}::uuid,${input.promotion_cycle_id}::uuid,${input.expected_offer_version})`;
    await tx`UPDATE promotion_offers SET status='accepted',accepted_at=clock_timestamp(),bonus_snapshot_sealed_at=clock_timestamp()
      WHERE id=${offer.id}::uuid`;
    return durable(offer);
  });
}
