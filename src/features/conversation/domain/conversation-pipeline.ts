import type { SalesContextStage, SalesPaymentPlan } from '@/features/sales/domain/sales-context';

export const CONVERSATION_MOVE_KINDS_V1 = [
  'greeting',
  'browse_catalog',
  'select_area',
  'select_course',
  'ask_course_information',
  'continue_by_chat',
  'request_call',
  'decline_call',
  'ask_payment_options',
  'select_payment_plan',
  'defer_payment',
  'request_payment_link',
  'decline_purchase',
  'unknown',
] as const;

export const CONVERSATION_VETOES_V1 = ['call', 'payment_link', 'purchase'] as const;
export const CALL_PREFERENCES_V1 = ['unknown', 'call', 'chat', 'declined'] as const;
export const CALL_OFFER_STATUSES_V1 = ['not_offered', 'offered', 'accepted', 'declined'] as const;
export const AWAITING_REPLIES_V1 = [
  'none',
  'area_choice',
  'course_choice',
  'call_or_chat',
  'payment_plan',
  'payment_confirmation',
] as const;

export const RESPONSE_GOALS_V1 = [
  'greet_and_discover',
  'guide_area_choice',
  'guide_course_choice',
  'explain_selected_course',
  'continue_course_advice',
  'offer_call_or_chat',
  'acknowledge_chat_preference',
  'acknowledge_call_decline',
  'confirm_call_request',
  'present_payment_options',
  'confirm_selected_plan',
  'acknowledge_payment_deferral',
  'confirm_payment_link',
  'acknowledge_purchase_decline',
  'clarify_current_step',
  'catalog_temporarily_unavailable',
] as const;

export const MISSING_INFORMATION_V1 = [
  'area_reference',
  'course_reference',
  'course_selection',
  'course_information_topic',
  'call_or_chat_choice',
  'payment_plan',
  'payment_confirmation',
  'catalog_snapshot',
] as const;

export type ConversationMoveKindV1 = typeof CONVERSATION_MOVE_KINDS_V1[number];
export type ConversationVetoV1 = typeof CONVERSATION_VETOES_V1[number];
export type CallPreferenceV1 = typeof CALL_PREFERENCES_V1[number];
export type CallOfferStatusV1 = typeof CALL_OFFER_STATUSES_V1[number];
export type AwaitingReplyV1 = typeof AWAITING_REPLIES_V1[number];
export type ResponseGoalV1 = typeof RESPONSE_GOALS_V1[number];
export type MissingInformationV1 = typeof MISSING_INFORMATION_V1[number];

export interface ConversationMoveV1 {
  readonly schema_version: 1;
  readonly move: ConversationMoveKindV1;
  readonly secondary_moves: readonly ConversationMoveKindV1[];
  readonly vetoes: readonly ConversationVetoV1[];
  readonly course_reference?: string;
  readonly area_reference?: string;
  readonly payment_plan?: SalesPaymentPlan;
  readonly confidence: number;
}

export interface ConversationStateV1 {
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
  readonly stage: SalesContextStage;
  readonly call_preference: CallPreferenceV1;
  readonly call_offer_status: CallOfferStatusV1;
  readonly awaiting_reply: AwaitingReplyV1;
  readonly source_turn_id: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ConversationStateTransitionV1 {
  readonly workspace_slug: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
  readonly stage: SalesContextStage;
  readonly call_preference: CallPreferenceV1;
  readonly call_offer_status: CallOfferStatusV1;
  readonly awaiting_reply: AwaitingReplyV1;
  readonly source_turn_id: string | null;
}

export type CanonicalFactRequestV1 =
  | { readonly kind: 'area_options'; readonly limit: 1 | 2 | 3 }
  | { readonly kind: 'course_options'; readonly area_code: string; readonly limit: 1 | 2 | 3 }
  | {
      readonly kind: 'offering_name' | 'offering_description' | 'offering_duration' | 'offering_modality';
      readonly offering_code: string;
    }
  | { readonly kind: 'payment_options'; readonly offering_code: string }
  | {
      readonly kind: 'payment_link';
      readonly offering_code: string;
      readonly payment_plan: SalesPaymentPlan;
    };

export type AllowedBusinessActionV1 =
  | { readonly type: 'none' }
  | { readonly type: 'request_call_now'; readonly reason: 'direct_request' | 'accepted_offer' }
  | {
      readonly type: 'send_payment_link';
      readonly offering_code: string;
      readonly payment_plan: SalesPaymentPlan;
    };

export interface TurnPlanV1 {
  readonly schema_version: 1;
  readonly next_stage: SalesContextStage;
  readonly response_goal: ResponseGoalV1;
  readonly canonical_fact_requests: readonly CanonicalFactRequestV1[];
  readonly allowed_business_action: AllowedBusinessActionV1;
  readonly missing_information: readonly MissingInformationV1[];
  readonly should_offer_call: boolean;
  readonly next_call_preference: CallPreferenceV1;
  readonly next_call_offer_status: CallOfferStatusV1;
  readonly next_awaiting_reply: AwaitingReplyV1;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
}

export interface CanonicalFactRefV1 {
  readonly id: string;
  readonly kind:
    | 'area_name'
    | 'offering_name'
    | 'offering_description'
    | 'offering_duration'
    | 'offering_modality'
    | 'payment_plan_label'
    | 'payment_plan_price'
    | 'payment_link';
  readonly offering_code?: string;
  readonly payment_plan?: SalesPaymentPlan;
}

export interface ComposedNarrativeV1 {
  readonly schema_version: 1;
  readonly narrative: {
    readonly opening: string;
    readonly explanation: string | null;
    readonly next_question: string | null;
  };
  readonly used_fact_ids: readonly string[];
}
