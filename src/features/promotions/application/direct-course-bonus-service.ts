import { createHash } from 'node:crypto';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { isCentralCargaBonusEnabledForContact, loadCentralCargaBonusConfig } from '@/features/fulfillment/central-carga/config';
import { loadCourseBonusFlowConfig } from './course-bonus-flow-config';

export type DirectCourseBonusRejectionV1 = 'bonus_disabled' | 'no_price_objection' | 'invalid_offering'
  | 'same_as_paid_course' | 'duplicate_bonus' | 'bonus_limit_reached' | 'multiple_bonus_in_turn'
  | 'bonus_without_reply' | 'sale_already_closed' | 'stale_offer_version';
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
  readonly outbound: {
    readonly id: string;
    readonly content: string;
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
type Rejected = { readonly ok: false; readonly reason: DirectCourseBonusRejectionV1 };
export type DirectCourseBonusResultV1 = (DurableResult & { readonly outbound_message_id: string }) | Rejected;
export type AcceptDirectCourseBonusResultV1 = DurableResult | Rejected;
class Rejection extends Error {
  constructor(readonly reason: DirectCourseBonusRejectionV1) { super(reason); }
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
function authorizedLimit(contactId: string): number | null {
  try {
    const config = loadCourseBonusFlowConfig();
    return config.mode === 'direct' && isCentralCargaBonusEnabledForContact(loadCentralCargaBonusConfig(), contactId)
      ? config.maxBonusCourses : null;
  } catch { return null; }
}
async function execute<T>(db: DbClient, work: (tx: DbClient) => Promise<T>): Promise<T | Rejected> {
  try { return await transaction(db, work); } catch (error) {
    if (error instanceof Rejection) return { ok: false, reason: error.reason };
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
async function lockIdentity(tx: DbClient, input: Identity) {
  const [context] = await tx<Array<{stage: string; selected_offering_code: string | null; paid_id: string; paid_status: string; paid_type: string}>>`
    SELECT s.stage,s.selected_offering_code,paid.id AS paid_id,paid.status AS paid_status,paid.offering_type AS paid_type
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
  const [interest]=await tx<Array<{interest_offering_code:string;price_objection_count:number;source_turn_id:string}>>`
      SELECT interest.interest_offering_code,interest.price_objection_count,interest.source_turn_id
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
  // Effective identity only; never persist a purchase selection. Same-turn
  // interest can identify a course, but cannot establish a prior objection.
  return {...context,selected_offering_code:context.selected_offering_code ?? (source ? interest.interest_offering_code : null),
    structured_objection_authorized:source?.prior===true && interest.interest_offering_code===input.paid_offering_code
      && interest.price_objection_count>0};
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
      AND status IN ('paid','refunded')) AS paid,
      EXISTS(SELECT 1 FROM contacts WHERE id=${input.contact_id}::uuid AND status<>'inactivo'
        AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM contact_channel_permissions permission
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
  const limit=authorizedLimit(input.contact_id);
  if (!limit) return {ok:false,reason:'bonus_disabled'};
  return execute(db, async tx => {
    if (input.bonus_offering_codes.length!==1) reject('multiple_bonus_in_turn');
    if (!input.outbound.content.trim()) reject('bonus_without_reply');
    if (!Number.isInteger(input.expected_offer_version) || input.expected_offer_version<0
      || (input.expected_offer_version>0 && (!input.promotion_code || !input.promotion_cycle_id))) reject('stale_offer_version');
    const context=await lockIdentity(tx,input);
    let offer=await resolveOffer(tx,input,context.paid_id);
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
    await validateOpen(tx,input,context,offer);
    if (input.bonus_offering_codes[0]===input.paid_offering_code) reject('same_as_paid_course');
    const [bonus]=await tx`SELECT id FROM offerings WHERE workspace_id=${input.workspace_id}::uuid
      AND code=${input.bonus_offering_codes[0]} AND status='active' AND offering_type='course' FOR SHARE`;
    if (!bonus) reject('invalid_offering');
    const [objection]=await tx`SELECT m.id FROM selected_memories m JOIN messages source ON source.id=m.source_message_id
      JOIN messages current ON current.id=${input.source_turn_id}::uuid
      WHERE m.contact_id=${input.contact_id}::uuid AND m.conversation_id=${input.conversation_id}::uuid
        AND m.memory_type='objection' AND m.memory_key='price_objection' AND m.status IN ('active','accepted','superseded')
        AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now())
        AND source.direction='inbound' AND source.id<>current.id
        AND current.direction='inbound' AND current.conversation_id=source.conversation_id AND current.contact_id=source.contact_id
        AND message_occurrence_v1(source.metadata,source.created_at)<message_occurrence_v1(current.metadata,current.created_at)
      UNION ALL
      SELECT decision.id FROM agent_decisions decision JOIN messages source ON source.id=decision.turn_id
      JOIN messages current ON current.id=${input.source_turn_id}::uuid
      JOIN conversation_promotion_context_v1 evidence ON evidence.workspace_id=${input.workspace_id}::uuid
        AND evidence.conversation_id=${input.conversation_id}::uuid AND evidence.contact_id=${input.contact_id}::uuid
        AND evidence.interest_offering_code=${input.paid_offering_code} AND evidence.price_objection_count>0
      WHERE source.conversation_id=evidence.conversation_id AND source.contact_id=evidence.contact_id AND source.direction='inbound'
        AND ${context.structured_objection_authorized}
        AND current.conversation_id=source.conversation_id AND current.contact_id=source.contact_id AND current.direction='inbound'
        AND source.id<>current.id
        AND decision.memory_candidates @> '[{"type":"objection","key":"price_objection"}]'::jsonb
        AND message_occurrence_v1(source.metadata,source.created_at)<message_occurrence_v1(current.metadata,current.created_at)
      LIMIT 1`;
    if (!objection) reject('no_price_objection');
    if (offer && offer.offer_version>=limit) reject('bonus_limit_reached');
    if (offer) {
      if ((await tx`SELECT id FROM promotion_offer_bonus_offerings WHERE offer_id=${offer.id}::uuid AND offering_id=${bonus.id}::uuid`).length) reject('duplicate_bonus');
    } else {
      const code=input.promotion_code ?? `any_bonus_${createHash('sha256').update(`${input.paid_offering_code}\u0000${input.bonus_offering_codes[0]}`).digest('hex').slice(0,32)}`;
      if (!input.promotion_code) await tx`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
        VALUES (${input.workspace_id}::uuid,${code},${context.paid_id}::uuid,ARRAY['text'],true) ON CONFLICT(workspace_id,promotion_code) DO NOTHING`;
      const [promotion]=await tx`SELECT id FROM promotions WHERE workspace_id=${input.workspace_id}::uuid
        AND promotion_code=${code} AND paid_offering_id=${context.paid_id}::uuid AND active=true
        AND 'text'=ANY(channels) AND (valid_from IS NULL OR valid_from<=now()) AND (valid_until IS NULL OR valid_until>now()) FOR SHARE`;
      if (!promotion) reject('bonus_disabled');
      const [created]=await tx<OfferRow[]>`INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,package_mode,promotion_cycle_id)
        VALUES (${input.workspace_id}::uuid,${input.contact_id}::uuid,${input.conversation_id}::uuid,${promotion.id}::uuid,${context.paid_id}::uuid,'direct',COALESCE(${input.promotion_cycle_id ?? null}::uuid,gen_random_uuid())) RETURNING *`;
      offer={...created,promotion_code:code};
      await validateOpen(tx,input,context,offer);
    }
    await tx`INSERT INTO messages(id,conversation_id,contact_id,direction,content,in_reply_to)
      VALUES (${input.outbound.id}::uuid,${input.conversation_id}::uuid,${input.contact_id}::uuid,'outbound',${input.outbound.content},${input.source_turn_id}::uuid)`;
    await tx`INSERT INTO outbound_deliveries(message_id,conversation_id,contact_id,provider,integration_id,channel,destination,idempotency_key)
      VALUES (${input.outbound.id}::uuid,${input.conversation_id}::uuid,${input.contact_id}::uuid,${input.outbound.provider},${input.outbound.integration_id},${input.outbound.channel},${input.outbound.destination},${input.outbound.idempotency_key})`;
    const [result]=await tx<Array<{version:number}>>`SELECT append_direct_course_bonus(${offer.id}::uuid,${bonus.id}::uuid,${input.source_turn_id}::uuid,${input.outbound.id}::uuid,${input.expected_offer_version}) AS version`;
    return {...durable(offer,result.version),outbound_message_id:input.outbound.id};
  });
}

export async function acceptDirectCourseBonusV1(db: DbClient, input: AcceptDirectCourseBonusInputV1): Promise<AcceptDirectCourseBonusResultV1> {
  if (!authorizedLimit(input.contact_id)) return {ok:false,reason:'bonus_disabled'};
  return execute(db,async tx=>{
    if (!input.promotion_code || !input.promotion_cycle_id || !Number.isInteger(input.expected_offer_version) || input.expected_offer_version<1) reject('stale_offer_version');
    const context=await lockIdentity(tx,input);
    const offer=await resolveOffer(tx,input,context.paid_id);
    if (!offer || offer.offer_version!==input.expected_offer_version) reject('stale_offer_version');
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
    if (!authorizedLimit(input.contact_id)) reject('bonus_disabled');
    await validateOpen(tx,input,context,offer);
    await tx`INSERT INTO promotion_voice_acceptances(offer_id,call_id,workspace_id,contact_id,conversation_id,promotion_cycle_id,offer_version)
      VALUES (${offer.id}::uuid,${input.call_id}::uuid,${input.workspace_id}::uuid,${input.contact_id}::uuid,
        ${input.conversation_id}::uuid,${input.promotion_cycle_id}::uuid,${input.expected_offer_version})`;
    await tx`UPDATE promotion_offers SET status='accepted',accepted_at=clock_timestamp(),bonus_snapshot_sealed_at=clock_timestamp()
      WHERE id=${offer.id}::uuid`;
    return durable(offer);
  });
}
