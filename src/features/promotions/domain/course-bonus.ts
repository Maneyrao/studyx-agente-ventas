export type PromotionChannel = 'text' | 'voice';
export type PromotionOfferStatus =
  | 'pending_review'
  | 'offered'
  | 'accepted'
  | 'cancelled'
  | 'expired'
  | 'attached';
export type CourseBonusFollowupKind = 'price_objection_checkin' | 'promotion_review';
export type CourseBonusFollowupStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'cancelled'
  | 'ambiguous'
  | 'dead_letter';

export interface Promotion {
  readonly id: string;
  readonly workspace_id: string;
  readonly promotion_code: string;
  readonly paid_offering_id: string;
  readonly channels: readonly PromotionChannel[];
  readonly active: boolean;
  readonly valid_from: Date | null;
  readonly valid_until: Date | null;
  readonly max_redemptions_per_contact: number;
}

export interface PromotionBonusOffering {
  readonly promotion_id: string;
  readonly workspace_id: string;
  readonly offering_id: string;
  readonly position: number;
}

export interface PromotionOffer {
  readonly id: string;
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly promotion_id: string;
  readonly paid_offering_id: string;
  readonly status: PromotionOfferStatus;
  readonly offered_outbound_message_id: string | null;
  readonly payment_id: string | null;
  readonly expires_at: Date | null;
}

export interface CourseBonusFollowup {
  readonly id: string;
  readonly offer_id: string;
  readonly kind: CourseBonusFollowupKind;
  readonly due_at: Date;
  readonly status: CourseBonusFollowupStatus;
  readonly idempotency_key: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
}

export interface PaymentBonusOffering {
  readonly id: string;
  readonly payment_id: string;
  readonly promotion_id: string;
  readonly offering_id: string;
  readonly promotion_code_snapshot: string;
  readonly offering_code_snapshot: string;
  readonly offering_display_name_snapshot: string;
  readonly position: number;
}

export interface CentralBonusEnrollmentItem {
  readonly id: string;
  readonly central_enrollment_id: string;
  readonly payment_id: string;
  readonly offering_code: string;
  readonly enrollment_id: string;
  readonly enrollment_status: 'active' | 'already_enrolled';
  readonly position: number;
}
