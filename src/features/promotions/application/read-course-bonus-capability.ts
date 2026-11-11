import { readNegotiationPaymentStateV1 } from '@/features/payments/application/negotiation-payment-state';
import { readCourseBonusLadderV1 } from './read-course-bonus-ladder';
import { TERMINAL_CALL_STATUSES } from '@/features/calls/domain/call-state';
import { authorizedBonusCodesV1, courseCodesNamedInBatchV1, isBonusCheckoutStateV1 } from '@/shared/conversation/deterministic-sales-rules';
import { currentFactualCourseReferencesV1 } from '@/features/orchestration/domain/course-focus';
import { customerBonusRequestV1, type CustomerBonusRequestV1 } from '@/features/promotions/domain/customer-bonus-request';
import type { CourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import type { DbClient } from '@/lib/db/types';
import { loadCourseBonusFlowConfig } from './course-bonus-flow-config';
import type { CourseBonusMaxCoursesV1 } from '../domain/course-bonus';
import {
  loadCentralCargaBonusConfig,
} from '@/features/fulfillment/central-carga/config';
import { isCentralCargaBonusEnabledForStoredContact } from '@/features/fulfillment/central-carga/bonus-contact-permission';

export type CourseBonusCapabilityStatus =
  | 'unavailable'
  | 'needs_interest'
  | 'not_eligible'
  | 'checkin_available'
  | 'review_available'
  | 'review_pending'
  | 'offer_available'
  | 'accepted';

export interface CourseBonusCapabilityV1 {
  readonly ladder?: CourseBonusLadderV1;
  readonly enabled?: boolean;
  readonly max_bonus_courses?: CourseBonusMaxCoursesV1;
  readonly may_offer_bonus?: boolean;
  readonly may_reopen_negotiation?: boolean;
  readonly promotion_cycle_id?: string | null;
  readonly offer_version?: number;
  readonly accepted_at?: string | null;
  readonly package_status?: CourseBonusOfferProjectionV1['status'] | null;
  readonly delivered_bonus_offerings?: Array<{readonly code:string; readonly display_name:string; readonly position:number}>;
  /** Persisted promotion state only (never inferred from agent phrases). */
  readonly sales_flow?: {
    readonly retention_used: boolean;
    readonly promo_expires_at: string | null;
  };
  /** Bonus permission set (owner 2026-11-03): affinity row, universal bridges and
   * any course the customer named literally. The model picks one; the backend validates. */
  readonly bonus_candidates?: Array<{ readonly code: string; readonly display_name: string }>;
  /** Only a literal customer swap of the single offered bonus ("cambiar X por Y"). */
  readonly rule_bonus?: { readonly paid_offering_code: string; readonly paid_display_name: string; readonly bonus_offering_code: string; readonly display_name: string; readonly position: number;
    /** Owner 2026-11-03: the customer named this course as the gift ("add") or as a replacement ("swap"). */
    readonly source?: 'customer_request'; readonly replaces_offering_code?: string; readonly replaces_display_name?: string } | null;
  readonly status: CourseBonusCapabilityStatus;
  readonly may_schedule_checkin: boolean;
  readonly may_request_review: boolean;
  readonly may_accept_offer: boolean;
  readonly may_send_promoted_payment: boolean;
  readonly promotion_code: string | null;
  readonly bonus_selection_mode?: 'configured' | 'any_active_course';
  /** Exact course being discussed. This is not a purchase selection. */
  readonly interest_offering_code: string | null;
  readonly bonus_offerings: ReadonlyArray<{
    readonly offered_at?: string;
    readonly code: string;
    readonly display_name: string;
    readonly position: number;
  }>;
}

export interface CourseBonusPromotionProjectionV1 {
  readonly promotion_code: string;
  readonly paid_offering_code: string;
  readonly channels: readonly ('text' | 'voice')[];
  readonly active: boolean;
  readonly valid_from: string | Date | null;
  readonly valid_until: string | Date | null;
  readonly bonus_offerings: CourseBonusCapabilityV1['bonus_offerings'];
}

export interface CourseBonusOfferProjectionV1 {
  readonly status: 'pending_review' | 'offered' | 'accepted' | 'cancelled' | 'expired' | 'attached';
  readonly promotion_code: string;
  readonly expires_at: string | Date | null;
}

export interface PromotionContextRepairPlanV1 {
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly interest_offering_code: string;
  readonly previous_price_objection_count: number;
  readonly proposed_price_objection_count: number;
  readonly evidence_source_turn_ids: readonly string[];
  readonly latest_source_turn_id: string | null;
  readonly protected_offer: boolean;
}

export function derivePromotionContextRepairPlanV1(input: {
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly interest_offering_code: string;
  readonly existing: {
    readonly interest_offering_code: string | null;
    readonly price_objection_count: number;
    readonly source_turn_id: string | null;
  } | null;
  readonly accepted_price_objection_turn_ids: readonly string[];
  readonly active_offer_status: CourseBonusOfferProjectionV1['status'] | null;
}): PromotionContextRepairPlanV1 {
  if (input.existing?.interest_offering_code
    && input.existing.interest_offering_code !== input.interest_offering_code) {
    throw new Error('PROMOTION_CONTEXT_COURSE_MISMATCH');
  }
  const evidenceSourceTurnIds = [...new Set(input.accepted_price_objection_turn_ids)];
  const previousCount = Math.max(0, Math.min(2, input.existing?.price_objection_count ?? 0));
  const protectedOffer = input.active_offer_status === 'accepted'
    || input.active_offer_status === 'attached';
  const proposedCount = protectedOffer
    ? previousCount
    : Math.max(previousCount, Math.min(2, evidenceSourceTurnIds.length));
  return {
    workspace_id: input.workspace_id,
    conversation_id: input.conversation_id,
    contact_id: input.contact_id,
    interest_offering_code: input.interest_offering_code,
    previous_price_objection_count: previousCount,
    proposed_price_objection_count: proposedCount,
    evidence_source_turn_ids: evidenceSourceTurnIds,
    latest_source_turn_id: evidenceSourceTurnIds.at(-1)
      ?? input.existing?.source_turn_id
      ?? null,
    protected_offer: protectedOffer,
  };
}

export async function applyPromotionContextRepairPlanV1(
  db: DbClient,
  plan: PromotionContextRepairPlanV1,
): Promise<{ interest_offering_code: string | null; price_objection_count: number } | null> {
  if (plan.protected_offer
    || plan.proposed_price_objection_count <= plan.previous_price_objection_count) {
    return {
      interest_offering_code: plan.interest_offering_code,
      price_objection_count: plan.previous_price_objection_count,
    };
  }
  const rows = await db<Array<{
    interest_offering_code: string | null;
    price_objection_count: number;
  }>>`
    INSERT INTO conversation_promotion_context_v1 (
      workspace_id, conversation_id, contact_id, interest_offering_code,
      price_objection_count, source_turn_id
    )
    SELECT
      ${plan.workspace_id}::uuid,
      ${plan.conversation_id}::uuid,
      ${plan.contact_id}::uuid,
      ${plan.interest_offering_code},
      ${plan.proposed_price_objection_count},
      ${plan.latest_source_turn_id}::uuid
    WHERE EXISTS (
      SELECT 1 FROM conversation_sales_context_states_v1 state
      WHERE state.workspace_id = ${plan.workspace_id}::uuid
        AND state.conversation_id = ${plan.conversation_id}::uuid
        AND state.contact_id = ${plan.contact_id}::uuid
    )
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET
      price_objection_count = GREATEST(
        conversation_promotion_context_v1.price_objection_count,
        EXCLUDED.price_objection_count
      ),
      source_turn_id = CASE
        WHEN EXCLUDED.price_objection_count > conversation_promotion_context_v1.price_objection_count
          THEN EXCLUDED.source_turn_id
        ELSE conversation_promotion_context_v1.source_turn_id
      END,
      updated_at = CASE
        WHEN EXCLUDED.price_objection_count > conversation_promotion_context_v1.price_objection_count
          THEN now()
        ELSE conversation_promotion_context_v1.updated_at
      END
    WHERE conversation_promotion_context_v1.interest_offering_code IS NOT DISTINCT FROM
      EXCLUDED.interest_offering_code
    RETURNING interest_offering_code, price_objection_count
  `;
  if (rows.length === 0) throw new Error('PROMOTION_CONTEXT_REPAIR_SCOPE_CHANGED');
  return rows[0] ?? null;
}

export async function recordPromotionConversationContextV1(
  db: DbClient,
  input: {
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
    readonly source_turn_id: string;
    readonly discussed_offering_code: string | null;
    readonly records_price_objection: boolean;
    readonly reset_context?: boolean;
  },
): Promise<{ interest_offering_code: string | null; price_objection_count: number } | null> {
  if (input.discussed_offering_code === null && !input.records_price_objection
    && input.reset_context !== true) return null;
  const rows = await db<Array<{
    interest_offering_code: string | null;
    price_objection_count: number;
  }>>`
    INSERT INTO conversation_promotion_context_v1 (
      workspace_id, conversation_id, contact_id, interest_offering_code,
      price_objection_count, source_turn_id
    )
    SELECT
      ${input.workspace_id}::uuid,
      ${input.conversation_id}::uuid,
      ${input.contact_id}::uuid,
      ${input.discussed_offering_code},
      ${input.reset_context === true ? 0 : input.records_price_objection ? 1 : 0},
      ${input.source_turn_id}::uuid
    WHERE EXISTS (
      SELECT 1 FROM conversation_sales_context_states_v1 state
      WHERE state.workspace_id = ${input.workspace_id}::uuid
        AND state.conversation_id = ${input.conversation_id}::uuid
        AND state.contact_id = ${input.contact_id}::uuid
    )
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET
      interest_offering_code = CASE
        WHEN ${input.reset_context === true} THEN NULL
        ELSE COALESCE(
          EXCLUDED.interest_offering_code,
          conversation_promotion_context_v1.interest_offering_code
        )
      END,
      price_objection_count = CASE
        WHEN ${input.reset_context === true} THEN 0
        WHEN EXCLUDED.interest_offering_code IS NOT NULL
          AND EXCLUDED.interest_offering_code IS DISTINCT FROM
            conversation_promotion_context_v1.interest_offering_code
          THEN EXCLUDED.price_objection_count
        WHEN EXCLUDED.source_turn_id = conversation_promotion_context_v1.source_turn_id
          THEN conversation_promotion_context_v1.price_objection_count
        ELSE LEAST(
          2,
          conversation_promotion_context_v1.price_objection_count
            + EXCLUDED.price_objection_count
        )
      END,
      contact_id = EXCLUDED.contact_id,
      source_turn_id = EXCLUDED.source_turn_id,
      updated_at = now()
    RETURNING interest_offering_code, price_objection_count
  `;
  return rows[0] ?? null;
}

const hidden = (
  status: CourseBonusCapabilityStatus,
  extras: Partial<CourseBonusCapabilityV1> = {},
): CourseBonusCapabilityV1 => ({
  status,
  may_schedule_checkin: false,
  may_request_review: false,
  may_accept_offer: false,
  may_send_promoted_payment: false,
  promotion_code: null,
  interest_offering_code: null,
  bonus_offerings: [],
  ...extras,
});

function timestamp(value: string | Date | null): number | null {
  if (value === null) return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function deriveCourseBonusCapabilityV1(input: {
  readonly channel: 'text' | 'voice';
  readonly selected_offering_code: string | null;
  readonly discussed_offering_code?: string | null;
  /** Structured model-owned price-objection evidence, capped at two. */
  readonly recorded_price_objections?: number;
  /** Durable evidence that Agent A already classified and handled a first
   * price objection for this exact conversation, promotion, and paid course. */
  readonly prior_price_objection_checkin: boolean;
  readonly promotion: CourseBonusPromotionProjectionV1 | null;
  readonly active_offer: CourseBonusOfferProjectionV1 | null;
  readonly allows_any_active_bonus?: boolean;
  readonly now?: Date;
}): CourseBonusCapabilityV1 {
  const now = (input.now ?? new Date()).getTime();
  const promotion = input.promotion;
  const interestOfferingCode = input.discussed_offering_code ?? input.selected_offering_code;
  if (interestOfferingCode === null) return hidden('needs_interest');
  const anyActiveBonus = input.allows_any_active_bonus === true && input.active_offer === null;
  if (!anyActiveBonus && (!promotion
    || !promotion.active
    || promotion.paid_offering_code !== interestOfferingCode
    || !promotion.channels.includes(input.channel)
    || (timestamp(promotion.valid_from) !== null && timestamp(promotion.valid_from)! > now)
    || (timestamp(promotion.valid_until) !== null && timestamp(promotion.valid_until)! <= now)
    || promotion.bonus_offerings.length === 0)) {
    return hidden('unavailable');
  }
  if (anyActiveBonus
    && ((input.recorded_price_objections ?? 0) > 0 || input.prior_price_objection_checkin)) {
    return hidden('review_available', {
      may_request_review: true,
      interest_offering_code: interestOfferingCode,
      bonus_selection_mode: 'any_active_course',
    });
  }
  if (promotion === null) {
    return hidden('checkin_available', {
      interest_offering_code: interestOfferingCode,
      bonus_selection_mode: 'any_active_course',
    });
  }

  const offer = input.active_offer;
  const offerExpired = offer?.expires_at !== null && offer?.expires_at !== undefined
    && timestamp(offer.expires_at) !== null && timestamp(offer.expires_at)! <= now;
  if (offer && offer.promotion_code === promotion.promotion_code && offerExpired) {
    return hidden('not_eligible');
  }
  if (offer && offer.promotion_code === promotion.promotion_code && !offerExpired) {
    if (offer.status === 'pending_review') {
      return hidden('review_pending', { interest_offering_code: interestOfferingCode });
    }
    if (offer.status === 'offered') {
      return {
        ...hidden('offer_available'),
        may_accept_offer: true,
        promotion_code: promotion.promotion_code,
        interest_offering_code: interestOfferingCode,
        bonus_offerings: promotion.bonus_offerings,
      };
    }
    if (offer.status === 'accepted' || offer.status === 'attached') {
      return {
        ...hidden('accepted'),
        may_send_promoted_payment: true,
        promotion_code: promotion.promotion_code,
        interest_offering_code: interestOfferingCode,
        bonus_offerings: promotion.bonus_offerings,
      };
    }
  }

  if ((input.recorded_price_objections ?? 0) > 0 || input.prior_price_objection_checkin) {
    return hidden('review_available', {
      may_request_review: true,
      interest_offering_code: interestOfferingCode,
    });
  }
  return hidden('checkin_available', {
    may_schedule_checkin: true,
    interest_offering_code: interestOfferingCode,
  });
}

interface CapabilityRow {
  promotion_code: string;
  paid_offering_code: string;
  channels: ('text' | 'voice')[];
  active: boolean;
  valid_from: Date | null;
  valid_until: Date | null;
  bonus_offerings: Array<{ code: string; display_name: string; position: number }>;
  offer_status: CourseBonusOfferProjectionV1['status'] | null;
  offer_promotion_code: string | null;
  offer_expires_at: Date | null;
  prior_price_objection_checkin: boolean;
}

export function deriveDirectCourseBonusCapabilityV1(input: {
  readonly interest_offering_code: string;
  readonly may_reopen_negotiation?: boolean;
  readonly max_bonus_courses: CourseBonusMaxCoursesV1;
  readonly ladder?: CourseBonusLadderV1;
  readonly package: {
    readonly promotion_code: string;
    readonly promotion_cycle_id: string;
    readonly offer_version: number;
    readonly status: CourseBonusOfferProjectionV1['status'];
    readonly expires_at?: string | Date | null;
    readonly accepted_at?: string | Date | null;
    readonly courses: CourseBonusCapabilityV1['bonus_offerings'];
    readonly delivered_courses?: CourseBonusCapabilityV1['bonus_offerings'];
    readonly delivered: boolean;
    readonly later_reply: boolean;
    readonly payment_superseded?: boolean;
  } | null;
  /** Active catalog courses the bonus set is drawn from. */
  readonly active_courses?: ReadonlyArray<{ readonly code: string; readonly display_name: string }>;
  /** Courses the customer named literally in this batch (they widen the set). */
  readonly named_codes?: readonly string[];
  /** Literal customer swap this turn (customerBonusRequestV1). */
  readonly customer_request?: CustomerBonusRequestV1 | null;
}): CourseBonusCapabilityV1 {
  const offer = input.package;
  const expiresAt = timestamp(offer?.expires_at ?? null);
  const expired = expiresAt !== null && expiresAt <= Date.now();
  const open = offer === null || (offer.status === 'offered' && !expired)
    || (input.may_reopen_negotiation === true && ['accepted','attached'].includes(offer.status) && !expired);
  const ready = offer === null || (offer.delivered && offer.later_reply);
  const swapBonus = customerSwapBonus(input, open && ready);
  const candidates = bonusCandidates(input, open && ready);
  const accepted = offer?.status === 'accepted' || offer?.status === 'attached';
  return {
    ...hidden(accepted ? 'accepted' : offer ? 'offer_available' : 'checkin_available'),
    enabled: true, max_bonus_courses: input.max_bonus_courses,
    ...(input.may_reopen_negotiation ? {may_reopen_negotiation:true} : {}),
    ...(input.ladder ? {ladder:input.ladder} : {}),
    // Structural availability only. The motive is validated per proposal
    // against the current message, never decided here.
    may_offer_bonus: open && ready && (offer?.courses.length ?? 0) < input.max_bonus_courses
      && (candidates.length > 0 || swapBonus !== null),
    may_accept_offer: offer?.status === 'offered' && ready && !expired,
    may_send_promoted_payment: accepted && offer?.payment_superseded !== true,
    interest_offering_code: input.interest_offering_code,
    promotion_code: offer?.promotion_code ?? null,
    promotion_cycle_id: offer?.promotion_cycle_id ?? null,
    offer_version: offer?.offer_version ?? 0,
    accepted_at: offer?.accepted_at ? new Date(offer.accepted_at).toISOString() : null,
    package_status: expired && offer?.status === 'offered' ? 'expired' : offer?.status ?? null,
    bonus_selection_mode: 'any_active_course',
    bonus_offerings: offer?.courses ?? [],
    delivered_bonus_offerings: [...(offer?.delivered_courses ?? (offer?.delivered ? offer.courses : []))],
    bonus_candidates: candidates,
    rule_bonus: swapBonus,
  };
}

function customerSwapBonus(input: Parameters<typeof deriveDirectCourseBonusCapabilityV1>[0], extendable: boolean): CourseBonusCapabilityV1['rule_bonus'] {
  const request = input.customer_request;
  const courses = input.active_courses ?? [];
  const paid = courses.find(course => course.code === input.interest_offering_code);
  const bonus = request ? courses.find(course => course.code === request.bonus_offering_code) : undefined;
  if (!request || !extendable || !paid || !bonus) return null;
  const offered = input.package?.courses ?? [];
  const replaced = offered.length === 1 && offered[0]!.code === request.replaced_offering_code ? offered[0]! : null;
  if (!replaced || input.package?.status !== 'offered') return null;
  return { paid_offering_code: paid.code, paid_display_name: paid.display_name, bonus_offering_code: bonus.code,
    display_name: bonus.display_name, position: 1, source: 'customer_request',
    replaces_offering_code: replaced.code, replaces_display_name: replaced.display_name };
}

/** Set membership (affinity row, universal bridges, literally named courses),
 * minus the paid course and what the package already holds. */
export function bonusCandidates(input: Pick<Parameters<typeof deriveDirectCourseBonusCapabilityV1>[0],
  'active_courses' | 'interest_offering_code' | 'named_codes' | 'package'>, extendable: boolean): Array<{ code: string; display_name: string }> {
  const courses = input.active_courses ?? [];
  if (!extendable || !courses.some(course => course.code === input.interest_offering_code)) return [];
  const offered = new Set((input.package?.courses ?? []).map(course => course.code));
  return authorizedBonusCodesV1({ paid_code: input.interest_offering_code, active_codes: courses.map(course => course.code),
    named_codes: input.named_codes })
    .filter(code => !offered.has(code))
    .flatMap(code => courses.filter(course => course.code === code).map(course => ({ code, display_name: course.display_name })));
}

/** Owner instant promo (2026-11-02): "me interesa X, tenés promo?" names the
 * paid course in the same message. Only a single, unambiguous, active course
 * named by the customer this turn, and only alongside a promo request. */
async function currentBatchTexts(input: {
  contact_id: string; conversation_id: string; source_turn_id?: string;
}, db: DbClient): Promise<string[]> {
  if (!input.source_turn_id) return [];
  // The whole current intervention: everything since Emma's last reply (owner 2026-11-10).
  const batch = await db<Array<{ content: string }>>`
    SELECT fragment.content FROM messages current
    CROSS JOIN LATERAL agent_intervention_inbound_v1(current.id) fragment
    WHERE current.id=${input.source_turn_id}::uuid AND current.conversation_id=${input.conversation_id}::uuid
      AND current.contact_id=${input.contact_id}::uuid
    ORDER BY fragment.occurred_at, fragment.conversation_seq`;
  return batch.map(row => row.content);
}

/** No sales state yet (first message) means no checkout; a literal promo request is the trigger. */


/** A leveled family ("Inglés 1/2/3") referenced without a level resolves to
 * its entry level; anything else must be a single course. */
function singleOrEntryLevelV1(codes: readonly string[]): string | null {
  const unique = [...new Set(codes)];
  if (unique.length === 1) return unique[0]!;
  const levels = unique.map(code => /^(.+)_(\d+)$/u.exec(code));
  if (unique.length < 2 || levels.some(match => match === null)) return null;
  if (new Set(levels.map(match => match![1])).size !== 1) return null;
  return [...unique].sort((a, b) => Number(/_(\d+)$/u.exec(a)![1]) - Number(/_(\d+)$/u.exec(b)![1]))[0]!;
}

/** The promotion interest is the course the customer referenced this turn or,
 * failing that, most recently in the session. Interest only: no selection, and
 * no reading of the customer's intent (literal catalog references only). */
async function promoRequestedCourseThisTurn(input: {
  workspace_slug: string; contact_id: string; conversation_id: string; source_turn_id?: string;
}, db: DbClient): Promise<string | null> {
  const texts = await currentBatchTexts(input, db);
  const offerings = await db<Array<{ code: string; display_name: string; aliases: string[] | null }>>`
    SELECT o.code, o.display_name, ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.metadata->'aliases')='array'
      THEN o.metadata->'aliases' ELSE '[]'::jsonb END)) aliases
    FROM offerings o JOIN workspaces w ON w.id=o.workspace_id
    WHERE w.slug=${input.workspace_slug} AND o.status='active' AND o.offering_type='course'`;
  const references = currentFactualCourseReferencesV1(texts, { as_of: new Date().toISOString(),
    offerings_total: offerings.length, injection_suspected_count: 0,
    offerings: offerings.map(offering => ({ code: offering.code, display_name: offering.display_name,
      aliases: offering.aliases ?? [], academy: null })) }, []);
  const index = { as_of: new Date().toISOString(), offerings_total: offerings.length, injection_suspected_count: 0,
    offerings: offerings.map(offering => ({ code: offering.code, display_name: offering.display_name,
      aliases: offering.aliases ?? [], academy: null })) };
  const visible = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const resolve = (batch: readonly string[], found: ReturnType<typeof currentFactualCourseReferencesV1>): string | null => {
    if (found.length === 0) return null;
    // "Me interesa Introducción al Ecommerce ... mi tienda online": a partial term
    // can also hit another course; the full canonical name the customer wrote wins.
    const text = ` ${visible(batch.join(' '))} `;
    const fullNames = found.filter(reference => {
      const offering = offerings.find(candidate => candidate.code === reference.offeringCode);
      return offering !== undefined && text.includes(` ${visible(offering.display_name)} `);
    });
    if (fullNames.length === 1) return fullNames[0].offeringCode;
    return singleOrEntryLevelV1(found.map(reference => reference.offeringCode));
  };
  // "ingles" names a leveled family the shared detector treats as ambiguous.
  const familyEntry = (batch: readonly string[]): string | null => {
    const tokens = ` ${visible(batch.join(' '))} `;
    const families = new Map<string, string[]>();
    for (const offering of offerings) {
      const level = /^(.+)_(\d+)$/u.exec(offering.code);
      const term = visible(offering.display_name).replace(/\s+\d+$/u, '');
      if (level && term.length >= 3 && term !== visible(offering.display_name)) {
        families.set(term, [...(families.get(term) ?? []), offering.code]);
      }
    }
    const hits = [...families].filter(([term, codes]) => codes.length > 1 && tokens.includes(` ${term} `));
    return hits.length === 1 ? singleOrEntryLevelV1(hits[0]![1]) : null;
  };
  const current = resolve(texts, references);
  if (current || references.length > 0) return current;
  const currentFamily = familyEntry(texts);
  if (currentFamily) return currentFamily;
  if (!input.source_turn_id) return null;
  const earlier = await db<Array<{ content: string }>>`
    SELECT prior.content FROM messages prior JOIN messages current ON current.id=${input.source_turn_id}::uuid
    WHERE prior.conversation_id=current.conversation_id AND prior.contact_id=current.contact_id
      AND prior.direction='inbound' AND prior.created_at < current.created_at
      AND prior.created_at > current.created_at - interval '6 hours'
    ORDER BY prior.created_at DESC, prior.conversation_seq DESC LIMIT 12`;
  for (const message of earlier) {
    const found = currentFactualCourseReferencesV1([message.content], index, []);
    if (found.length) return resolve([message.content], found);
    const family = familyEntry([message.content]);
    if (family) return family;
  }
  return null;
}

async function readDirectCapability(input: {
  workspace_slug: string; contact_id: string; conversation_id: string;
  selected_offering_code: string | null; source_turn_id?: string;
}, db: DbClient, max: CourseBonusMaxCoursesV1): Promise<CourseBonusCapabilityV1> {

  if (!input.selected_offering_code) {
    // Interest is commercial state, not a purchase selection. Resolve only the
    // durable, scoped projection with a correlated source no later than this turn.
    const [interest] = await db<Array<{interest_offering_code:string}>>`
      SELECT COALESCE(package.paid_code,p.interest_offering_code) AS interest_offering_code
      FROM conversation_promotion_context_v1 p
      JOIN workspaces w ON w.id=p.workspace_id AND w.slug=${input.workspace_slug}
      JOIN conversation_sales_context_states_v1 s ON s.workspace_id=p.workspace_id
        AND s.conversation_id=p.conversation_id AND s.contact_id=p.contact_id
      JOIN messages source ON source.id=p.source_turn_id AND source.conversation_id=p.conversation_id
        AND source.contact_id=p.contact_id AND source.direction='inbound'
      JOIN messages current ON current.conversation_id=p.conversation_id AND current.contact_id=p.contact_id
        AND current.direction='inbound' AND current.id=${input.source_turn_id ?? null}::uuid
      LEFT JOIN LATERAL (
        SELECT paid.code AS paid_code FROM promotion_offers o
        JOIN offerings paid ON paid.id=o.paid_offering_id AND paid.workspace_id=p.workspace_id
        WHERE o.workspace_id=p.workspace_id AND o.conversation_id=p.conversation_id AND o.contact_id=p.contact_id
          AND o.package_mode='direct' AND o.status IN ('offered','accepted','attached')
          AND NOT EXISTS(SELECT 1 FROM payment_intent_supersessions superseded WHERE superseded.payment_id=o.payment_id)
          AND EXISTS(SELECT 1 FROM promotion_offer_bonus_offerings gift
            WHERE gift.offer_id=o.id AND gift.offering_code_snapshot=p.interest_offering_code)
        ORDER BY o.created_at DESC LIMIT 1
      ) package ON true
      WHERE p.conversation_id=${input.conversation_id}::uuid AND p.contact_id=${input.contact_id}::uuid
        AND s.selected_offering_code IS NULL
        AND message_occurrence_v1(source.metadata,source.created_at)<=message_occurrence_v1(current.metadata,current.created_at)
    `;
    // Owner 2026-11-03 (live swap 07:41): with no selection and no recorded
    // interest, the paid course of the conversation's live direct package is
    // the interest, so a gift choice or swap can be read against it. Only
    // without such a package is the course named this turn the interest.
    const [livePackage] = interest ? [] : await db<Array<{paid_code:string}>>`
      SELECT paid.code AS paid_code FROM promotion_offers o
      JOIN offerings paid ON paid.id=o.paid_offering_id AND paid.workspace_id=o.workspace_id
      JOIN workspaces w ON w.id=o.workspace_id AND w.slug=${input.workspace_slug}
      WHERE o.conversation_id=${input.conversation_id}::uuid AND o.contact_id=${input.contact_id}::uuid
        AND o.package_mode='direct' AND o.status='offered'
      ORDER BY o.created_at DESC LIMIT 1`;
    const sameTurnCourse = interest || livePackage ? null : await promoRequestedCourseThisTurn(input, db);
    const interestCode = interest?.interest_offering_code ?? sameTurnCourse ?? livePackage?.paid_code ?? null;
    if (!interestCode) return {...hidden('needs_interest'), enabled:true,max_bonus_courses:max};
    input={...input,selected_offering_code:interestCode};

  }
  const [row] = await db<Array<{
    promotion_code: string | null; promotion_cycle_id: string; offer_version: number;
    status: CourseBonusOfferProjectionV1['status']; courses: CourseBonusCapabilityV1['bonus_offerings'];
    expires_at: Date | null; accepted_at: Date | null;
    delivered_courses: CourseBonusCapabilityV1['bonus_offerings']; delivered: boolean; later_reply: boolean;
    payment_superseded: boolean;
  }>>`
    SELECT p.promotion_code,o.promotion_cycle_id,o.offer_version,o.status,o.expires_at,o.accepted_at,
      EXISTS(SELECT 1 FROM payment_intent_supersessions superseded WHERE superseded.payment_id=o.payment_id) AS payment_superseded,
      COALESCE(b.courses,'[]'::jsonb) courses,COALESCE(b.delivered_courses,'[]'::jsonb) delivered_courses,
      COALESCE(b.delivered,false) delivered,
      COALESCE(b.latest_delivery < message_occurrence_v1(current.metadata,current.created_at),false) later_reply
    FROM workspaces w JOIN offerings paid ON paid.workspace_id=w.id AND paid.code=${input.selected_offering_code}
      AND paid.status='active' AND paid.offering_type='course'
    JOIN workspace_contacts wc ON wc.workspace_id=w.id AND wc.contact_id=${input.contact_id}::uuid
    JOIN LATERAL(SELECT m.* FROM messages m WHERE m.conversation_id=${input.conversation_id}::uuid
      AND m.contact_id=${input.contact_id}::uuid AND m.direction='inbound'
      AND (${input.source_turn_id ?? null}::uuid IS NULL OR m.id=${input.source_turn_id ?? null}::uuid)
      ORDER BY m.conversation_seq DESC,m.created_at DESC LIMIT 1) current ON true
    LEFT JOIN LATERAL(SELECT candidate.* FROM promotion_offers candidate
      WHERE candidate.workspace_id=w.id AND candidate.contact_id=wc.contact_id
        AND sale_family_root_v1(candidate.workspace_id,candidate.contact_id,candidate.conversation_id)
          IS NOT DISTINCT FROM sale_family_root_v1(candidate.workspace_id,candidate.contact_id,current.conversation_id)
        AND candidate.paid_offering_id=paid.id
        -- Another family conversation's package counts only when attached to a payment (the reopen path).
        AND (candidate.conversation_id=current.conversation_id OR candidate.status='attached')
        AND candidate.package_mode='direct' AND candidate.status IN ('offered','accepted','attached')
      ORDER BY (candidate.conversation_id=current.conversation_id) DESC,candidate.created_at DESC LIMIT 1) o ON true
    LEFT JOIN promotions p ON p.id=o.promotion_id
    LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('code',s.offering_code_snapshot,
      'display_name',s.offering_display_name_snapshot,'position',s.position,'offered_at',s.offered_at) ORDER BY s.position) courses,
      jsonb_agg(jsonb_build_object('code',s.offering_code_snapshot,
      'display_name',s.offering_display_name_snapshot,'position',s.position) ORDER BY s.position)
        FILTER(WHERE s.delivered_at IS NOT NULL) delivered_courses,
      bool_and(s.delivered_at IS NOT NULL) delivered,max(s.delivered_at) latest_delivery
      FROM promotion_offer_bonus_offerings s WHERE s.offer_id=o.id) b ON true
    WHERE w.slug=${input.workspace_slug} AND w.status='active'
  `;
  if (!row) return {...hidden('unavailable'),enabled:false,max_bonus_courses:max};
  const evidence=await readCourseBonusLadderV1(input,db);
  const ladder: CourseBonusLadderV1 | null = evidence ? {retention_used:evidence.retention_used,
    previous_turn_asked_price_question:evidence.previous_turn_asked_price_question,
    price_presented:evidence.price_presented,
    prior_price_objection_recorded:evidence.prior_price_objection_recorded ?? false,
    ...(evidence.carried_over_bonus_offerings ? {carried_over_bonus_offerings:evidence.carried_over_bonus_offerings} : {})} : null;
  const activeCourses=await db<Array<{code:string;display_name:string;aliases:string[]|null}>>`
    SELECT o.code,o.display_name,ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.metadata->'aliases')='array'
      THEN o.metadata->'aliases' ELSE '[]'::jsonb END)) aliases
    FROM offerings o JOIN workspaces w ON w.id=o.workspace_id
    WHERE w.slug=${input.workspace_slug} AND o.status='active' AND o.offering_type='course'`;
  const customerRequest = row.status === 'accepted' || row.status === 'attached' ? null
    : await customerBonusRequestThisTurnV1(input, db, activeCourses,
      row.status === 'offered' ? (row.courses ?? []).map(course => course.code) : [], max);
  // A carried-over gift may be kept for the new main course (owner 2026-11-10).
  const namedCodes = [...new Set([...courseCodesNamedInBatchV1(await currentBatchTexts(input, db), activeCourses),
    ...(ladder?.carried_over_bonus_offerings ?? []).map(course => course.code)])];
  // Checkout (by durable state) closes new gifts: never advertise the effect there.
  const [salesState] = await db<Array<{stage:string;awaiting_reply:string|null;link_status:string|null;handoff_call_settled:boolean}>>`
    SELECT state.stage,state.awaiting_reply,state.payment_link_request->>'status' AS link_status,
      COALESCE((SELECT latest.status = ANY(${TERMINAL_CALL_STATUSES as unknown as string[]}::text[]) FROM call_sessions latest
        WHERE latest.conversation_id = state.conversation_id AND latest.contact_id = state.contact_id
        ORDER BY latest.requested_at DESC, latest.id DESC LIMIT 1), false) AS handoff_call_settled
    FROM conversation_sales_context_states_v1 state
    WHERE state.conversation_id=${input.conversation_id}::uuid AND state.contact_id=${input.contact_id}::uuid LIMIT 1`;
  const inCheckout = salesState !== undefined && isBonusCheckoutStateV1({stage:salesState.stage,
    awaiting_reply:salesState.awaiting_reply ?? 'none',payment_link_request_pending:salesState.link_status==='pending',
    handoff_call_settled:salesState.handoff_call_settled});
  const [scope] = await db<Array<{workspace_id:string;offering_id:string}>>`SELECT o.workspace_id,o.id AS offering_id
    FROM offerings o JOIN workspaces w ON w.id=o.workspace_id
    WHERE w.slug=${input.workspace_slug} AND o.code=${input.selected_offering_code}`;
  const paymentState = scope ? await readNegotiationPaymentStateV1(db,{...scope,
    contact_id:input.contact_id,conversation_id:input.conversation_id}) : null;
  const mayReopen = (salesState?.stage==='payment_link_sent' || salesState?.stage==='closed') && paymentState?.may_reopen===true;
  const derived = deriveDirectCourseBonusCapabilityV1({interest_offering_code:input.selected_offering_code!,
    may_reopen_negotiation:mayReopen,
    active_courses:activeCourses,named_codes:namedCodes,
    ...(ladder ? {ladder} : {}),
    max_bonus_courses:max,customer_request:customerRequest,
    package:row.promotion_code ? {...row,promotion_code:row.promotion_code} : null});
  return {...derived, ...((inCheckout && !mayReopen) || paymentState?.blocked ? {may_offer_bonus:false,may_accept_offer:false,may_send_promoted_payment:false} : {}),
    sales_flow:{retention_used:ladder?.retention_used ?? false,
      promo_expires_at:row.status==='offered' && row.expires_at ? new Date(row.expires_at).toISOString() : null}};
}

/** Literal customer swap of the single offered bonus, read from the current batch. */
export async function customerBonusRequestThisTurnV1(input: {
  contact_id: string; conversation_id: string; source_turn_id?: string; selected_offering_code: string | null;
}, db: DbClient, offerings: ReadonlyArray<{ code: string; display_name: string; aliases?: string[] | null }>,
offered: readonly string[], max: number): Promise<CustomerBonusRequestV1 | null> {
  if (!input.source_turn_id || !input.selected_offering_code) return null;
  const texts = await currentBatchTexts(input, db);
  if (texts.length === 0) return null;
  const previous = (await db<Array<{ content: string }>>`
    SELECT prior.content FROM messages prior JOIN messages current ON current.id=${input.source_turn_id}::uuid
    WHERE prior.conversation_id=current.conversation_id AND prior.contact_id=current.contact_id
      AND prior.direction='outbound' AND prior.created_at < current.created_at
    ORDER BY prior.created_at DESC LIMIT 4`).map(row => row.content);
  return customerBonusRequestV1({ batch_texts: texts, offerings, paid_offering_code: input.selected_offering_code,
    offered_bonus_codes: offered, max_bonus_courses: max, previous_agent_messages: previous });
}

export async function readCourseBonusCapabilityV1(input: {
  readonly workspace_slug: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly channel: 'text' | 'voice';
  readonly selected_offering_code: string | null;
  readonly source_turn_id?: string;
  readonly now?: Date;
}, deps: { readonly db: DbClient }): Promise<CourseBonusCapabilityV1> {
  try {
    const flow = loadCourseBonusFlowConfig();
    if (flow.mode === 'review' && input.channel === 'text' && (input.selected_offering_code || input.source_turn_id)) {
      const obligation=await readDirectCapability(input,deps.db,flow.maxBonusCourses ?? 3);
      if (['offered','accepted','attached'].includes(obligation.package_status ?? '')
        && obligation.bonus_offerings.length>=1 && obligation.bonus_offerings.length<=3
        && obligation.offer_version===obligation.bonus_offerings.length) {
        return {...obligation,enabled:false,may_offer_bonus:false,
          may_request_review:false,may_schedule_checkin:false};
      }
    }
    if (!await isCentralCargaBonusEnabledForStoredContact(loadCentralCargaBonusConfig(),
      { contactId: input.contact_id, workspaceSlug: input.workspace_slug }, deps.db)) {
      return flow.mode === 'direct' && flow.maxBonusCourses !== null
        ? {...hidden('unavailable'),enabled:false,max_bonus_courses:flow.maxBonusCourses}
        : hidden('unavailable');
    }
    if (flow.mode === 'direct' && flow.maxBonusCourses !== null) {
      if (input.channel !== 'text') return {...hidden('unavailable'),enabled:false};
      return await readDirectCapability(input,deps.db,flow.maxBonusCourses);
    }
  } catch { return {...hidden('unavailable'),enabled:false}; }
  const contexts = await deps.db<Array<{
    interest_offering_code: string | null;
    price_objection_count: number;
  }>>`
    SELECT context.interest_offering_code, context.price_objection_count
    FROM conversation_promotion_context_v1 context
    JOIN workspaces workspace ON workspace.id = context.workspace_id
    WHERE workspace.slug = ${input.workspace_slug}
      AND context.conversation_id = ${input.conversation_id}::uuid
      AND context.contact_id = ${input.contact_id}::uuid
    LIMIT 1
  `;
  const discussedOfferingCode = contexts[0]?.interest_offering_code ?? null;
  const interestOfferingCode = discussedOfferingCode ?? input.selected_offering_code;
  if (interestOfferingCode === null) return hidden('needs_interest');
  const rows = await deps.db<CapabilityRow[]>`
    SELECT
      p.promotion_code,
      paid.code AS paid_offering_code,
      p.channels,
      p.active,
      p.valid_from,
      p.valid_until,
      CASE
        WHEN po.id IS NOT NULL AND po.status IN ('offered','accepted','attached') THEN
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'code', snapshot.offering_code_snapshot,
              'display_name', snapshot.offering_display_name_snapshot,
              'position', snapshot.position
            ) ORDER BY snapshot.position)
            FROM public.promotion_offer_bonus_offerings snapshot
            WHERE snapshot.offer_id = po.id
          ), '[]'::jsonb)
        ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'code', bonus.code,
            'display_name', bonus.display_name,
            'position', pbo.position
          ) ORDER BY pbo.position)
          FROM public.promotion_bonus_offerings pbo
          JOIN public.offerings bonus ON bonus.id = pbo.offering_id
          WHERE pbo.promotion_id = p.id
        ), '[]'::jsonb)
      END AS bonus_offerings,
      po.status AS offer_status,
      offer_promotion.promotion_code AS offer_promotion_code,
      po.expires_at AS offer_expires_at,
      EXISTS (
        SELECT 1
        FROM public.promotion_offers prior_offer
        JOIN public.course_bonus_followups prior_followup
          ON prior_followup.offer_id = prior_offer.id
         AND prior_followup.kind = 'price_objection_checkin'
        WHERE prior_offer.workspace_id = p.workspace_id
          AND prior_offer.contact_id = ${input.contact_id}::uuid
          AND prior_offer.conversation_id = ${input.conversation_id}::uuid
          AND prior_offer.promotion_id = p.id
          AND prior_offer.paid_offering_id = p.paid_offering_id
          AND prior_offer.cancel_reason = 'CHECKIN_ONLY'
      ) AS prior_price_objection_checkin
    FROM public.promotions p
    JOIN public.workspaces workspace ON workspace.id = p.workspace_id
    JOIN public.offerings paid ON paid.id = p.paid_offering_id
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.promotion_offers candidate
      WHERE candidate.workspace_id = p.workspace_id
        AND candidate.contact_id = ${input.contact_id}::uuid
        AND candidate.conversation_id = ${input.conversation_id}::uuid
        AND candidate.promotion_id = p.id
        AND candidate.status IN ('pending_review','offered','accepted')
        AND candidate.payment_id IS NULL
        AND (candidate.expires_at IS NULL OR candidate.expires_at > now())
      ORDER BY candidate.created_at DESC
      LIMIT 1
    ) po ON true
    LEFT JOIN public.promotions offer_promotion ON offer_promotion.id = po.promotion_id
    WHERE workspace.slug = ${input.workspace_slug}
      AND p.active = true
      AND ${input.channel}::text = ANY(p.channels)
      AND (p.valid_from IS NULL OR p.valid_from <= now())
      AND (p.valid_until IS NULL OR p.valid_until > now())
      AND (
        paid.code = ${interestOfferingCode}
        OR (
          po.id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.promotion_offer_bonus_offerings related_bonus
            WHERE related_bonus.offer_id = po.id
              AND related_bonus.offering_code_snapshot = ${interestOfferingCode}
          )
        )
      )
    ORDER BY
      CASE WHEN po.id IS NOT NULL THEN 0 ELSE 1 END,
      po.created_at DESC NULLS LAST,
      p.active DESC,
      p.created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  const anyActiveBonusRows = row ? [{ authorized: true }] : await deps.db<Array<{ authorized: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM public.offerings offering
      JOIN public.workspaces workspace ON workspace.id = offering.workspace_id
      WHERE workspace.slug = ${input.workspace_slug}
        AND offering.code = ${interestOfferingCode}
        AND offering.status = 'active'
        AND EXISTS (
          SELECT 1 FROM public.offerings candidate
          WHERE candidate.workspace_id = offering.workspace_id
            AND candidate.status = 'active'
            AND candidate.id <> offering.id
        )
    ) AS authorized
  `;
  // Once an offer has been delivered it owns its paid course durably. Merely
  // discussing the included course must not hide the package or turn that
  // bonus into the purchase identity.
  const effectiveInterestOfferingCode = row?.offer_status
    ? row.paid_offering_code
    : discussedOfferingCode;
  return deriveCourseBonusCapabilityV1({
    channel: input.channel,
    selected_offering_code: input.selected_offering_code,
    discussed_offering_code: effectiveInterestOfferingCode,
    recorded_price_objections: contexts[0]?.price_objection_count ?? 0,
    prior_price_objection_checkin: row?.prior_price_objection_checkin ?? false,
    promotion: row ? {
      promotion_code: row.promotion_code,
      paid_offering_code: row.paid_offering_code,
      channels: row.channels,
      active: row.active,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      bonus_offerings: row.bonus_offerings,
    } : null,
    active_offer: row?.offer_status && row.offer_promotion_code ? {
      status: row.offer_status,
      promotion_code: row.offer_promotion_code,
      expires_at: row.offer_expires_at,
    } : null,
    allows_any_active_bonus: anyActiveBonusRows[0]?.authorized === true,
    now: input.now,
  });
}
