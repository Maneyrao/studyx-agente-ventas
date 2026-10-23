import type { DbClient } from '@/lib/db/types';
import { loadCentralCargaBonusConfig } from '@/features/fulfillment/central-carga/config';

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
  readonly status: CourseBonusCapabilityStatus;
  readonly may_schedule_checkin: boolean;
  readonly may_request_review: boolean;
  readonly may_accept_offer: boolean;
  readonly may_send_promoted_payment: boolean;
  readonly promotion_code: string | null;
  readonly bonus_offerings: ReadonlyArray<{
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
  /** Durable evidence that Agent A already classified and handled a first
   * price objection for this exact conversation, promotion, and paid course. */
  readonly prior_price_objection_checkin: boolean;
  readonly promotion: CourseBonusPromotionProjectionV1 | null;
  readonly active_offer: CourseBonusOfferProjectionV1 | null;
  readonly now?: Date;
}): CourseBonusCapabilityV1 {
  const now = (input.now ?? new Date()).getTime();
  const promotion = input.promotion;
  if (input.selected_offering_code === null) return hidden('needs_interest');
  if (!promotion
    || !promotion.active
    || promotion.paid_offering_code !== input.selected_offering_code
    || !promotion.channels.includes(input.channel)
    || (timestamp(promotion.valid_from) !== null && timestamp(promotion.valid_from)! > now)
    || (timestamp(promotion.valid_until) !== null && timestamp(promotion.valid_until)! <= now)
    || promotion.bonus_offerings.length === 0) {
    return hidden('unavailable');
  }

  const offer = input.active_offer;
  const offerExpired = offer?.expires_at !== null && offer?.expires_at !== undefined
    && timestamp(offer.expires_at) !== null && timestamp(offer.expires_at)! <= now;
  if (offer && offer.promotion_code === promotion.promotion_code && offerExpired) {
    return hidden('not_eligible');
  }
  if (offer && offer.promotion_code === promotion.promotion_code && !offerExpired) {
    if (offer.status === 'pending_review') return hidden('review_pending');
    if (offer.status === 'offered') {
      return {
        ...hidden('offer_available'),
        may_accept_offer: true,
        promotion_code: promotion.promotion_code,
        bonus_offerings: promotion.bonus_offerings,
      };
    }
    if (offer.status === 'accepted' || offer.status === 'attached') {
      return {
        ...hidden('accepted'),
        may_send_promoted_payment: true,
        promotion_code: promotion.promotion_code,
        bonus_offerings: promotion.bonus_offerings,
      };
    }
  }

  if (input.prior_price_objection_checkin) {
    return hidden('review_available', { may_request_review: true });
  }
  return hidden('checkin_available', { may_schedule_checkin: true });
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

export async function readCourseBonusCapabilityV1(input: {
  readonly workspace_slug: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly channel: 'text' | 'voice';
  readonly selected_offering_code: string | null;
  readonly now?: Date;
}, deps: { readonly db: DbClient }): Promise<CourseBonusCapabilityV1> {
  if (!loadCentralCargaBonusConfig().enabled) return hidden('unavailable');
  if (input.selected_offering_code === null) return hidden('needs_interest');
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
        AND candidate.status IN ('pending_review','offered','accepted','attached')
      ORDER BY candidate.created_at DESC
      LIMIT 1
    ) po ON true
    LEFT JOIN public.promotions offer_promotion ON offer_promotion.id = po.promotion_id
    WHERE workspace.slug = ${input.workspace_slug}
      AND paid.code = ${input.selected_offering_code}
    ORDER BY p.active DESC, p.created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return deriveCourseBonusCapabilityV1({
    channel: input.channel,
    selected_offering_code: input.selected_offering_code,
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
    now: input.now,
  });
}
