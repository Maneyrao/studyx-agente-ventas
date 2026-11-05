import type { CourseMentionV1 } from '@/shared/conversation/course-mentions';
import type { CourseBonusLadderV1 } from '../../../shared/conversation/bonus-ladder';
import type { ConversationMoveV1 } from './conversation-pipeline';
import type { AgentANegotiationContextV1 } from '../../../shared/conversation/negotiation-facts';
import type { CourseBonusMaxCoursesV1, DirectCourseBonusPromotionV1 } from '../../promotions/domain/course-bonus';
import type {
  ContactProfileContextV1,
  ContactProfileRequestV1,
  ContactProfileUpdateV1,
} from '../../../shared/conversation/contact-profile-contract';

export const AGENT_A_MEMORY_TYPES_V1 = [
  'study_goal',
  'study_context',
  'preference',
  'constraint',
  'objection',
  'timeline',
  'contact_preference',
] as const;

export const AGENT_A_FACT_KINDS_V1 = [
  'area_name',
  'offering_name',
  'offering_description',
  'offering_duration',
  'offering_modality',
  'offering_syllabus',
  'payment_plan_label',
  'payment_plan_price',
] as const;

export type AgentAMemoryTypeV1 = typeof AGENT_A_MEMORY_TYPES_V1[number];
export type AgentAFactKindV1 = typeof AGENT_A_FACT_KINDS_V1[number];
export type AgentAPaymentPlanV1 = 'monthly_12' | 'monthly_6' | 'one_time';

export interface AgentAContextV1 {
  readonly schema_version: 1;
  readonly turn: {
    readonly batch_messages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
    readonly recent_turns: ReadonlyArray<{
      readonly id: string;
      readonly direction: 'inbound' | 'outbound';
      readonly content: string;
    }>;
  };
  readonly continuity?: {
    readonly assistant_has_spoken: boolean;
    readonly first_name_status: 'missing' | 'requested' | 'known';
    readonly last_agent_reply: string | null;
  };
  readonly customer: {
    readonly display_name: string | null;
    readonly contact_profile?: ContactProfileContextV1;
    readonly contact_intake?: {
      readonly nombre: string | null;
      readonly apellido: string | null;
      readonly correo: string | null;
      readonly telefono: string | null;
    } | null;
    readonly memories: ReadonlyArray<{
      readonly id: string;
      readonly type: AgentAMemoryTypeV1;
      readonly key: string;
      readonly value: string;
      readonly confidence: number;
    }>;
  };
  /** Identidad estable resuelta por el backend; `null` deja el prompt sin resolver. */
  readonly identity: {
    readonly advisor_name: string;
    readonly academy_name: string;
    readonly website: string | null;
    readonly instagram: string | null;
  } | null;
  readonly commercial_state: {
    readonly negotiation?: AgentANegotiationContextV1;
    readonly promotion?: DirectCourseBonusPromotionV1 | null;
    readonly selected_offering_code: string | null;
    readonly selected_payment_plan: AgentAPaymentPlanV1 | null;
    readonly stage: 'exploring' | 'qualified' | 'course_selected' | 'plan_selected' | 'payment_link_sent' | 'handoff' | 'closed';
    readonly call_preference: 'unknown' | 'call' | 'chat' | 'declined';
    readonly call_offer_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
    readonly call_offer_count: 0 | 1 | 2;
    readonly active_call?: { readonly call_id: string; readonly status: string } | null;
    readonly last_call_result?: {
      readonly call_id: string;
      readonly result: string | null;
      readonly ended_at: string;
      readonly announced_to_customer?: boolean;
    } | null;
    readonly awaiting_reply: 'none' | 'area_choice' | 'course_choice' | 'call_or_chat' | 'payment_plan' | 'payment_confirmation' | 'contact_details';
    readonly payment_link_request?: {
      readonly status: 'pending' | 'withdrawn' | 'consumed';
      readonly offering_code: string;
      readonly payment_plan: AgentAPaymentPlanV1;
    } | null;
  };
  readonly catalog: {
    readonly selected_offering: {
      readonly code: string;
      readonly display_name: string;
      readonly area_code: string | null;
      readonly facts: ReadonlyArray<{
        readonly id: string;
        readonly kind: AgentAFactKindV1;
        readonly value: string;
      }>;
    } | null;
    readonly areas: ReadonlyArray<{
      readonly code: string;
      readonly fact_id: string;
      readonly display_name: string;
    }>;
    readonly candidate_offerings: ReadonlyArray<{
      readonly code: string;
      readonly fact_id: string;
      readonly display_name: string;
      readonly area_code: string | null;
    }>;
    readonly payment_plans: ReadonlyArray<{
      readonly code: AgentAPaymentPlanV1;
      /** Referencia estructurada que el modelo cita para nombrar el plan. */
      readonly fact_id: string;
      readonly label: string;
    }>;
    readonly test_payment_options?: ReadonlyArray<{
      readonly code: 'stripe_verification_050';
      readonly fact_id: string;
      readonly label: string;
      readonly action: 'send_test_payment_link';
    }>;
  };
  readonly capabilities: {
    readonly may_reply: boolean;
    readonly may_offer_call: boolean;
    readonly may_request_call_now: boolean;
    readonly may_present_payment_options: boolean;
    readonly may_send_payment_link: boolean;
    readonly authorized_payment_plan: AgentAPaymentPlanV1 | null;
    readonly course_bonus?: {
      readonly enabled?: boolean;
      readonly may_offer_bonus?: boolean;
      readonly ladder?: CourseBonusLadderV1;
      readonly promotion_cycle_id?: string | null;
      readonly offer_version?: number;
      readonly accepted_at?: string | null;
      readonly package_status?: 'pending_review' | 'offered' | 'accepted' | 'cancelled' | 'expired' | 'attached' | null;
      readonly delivered_bonus_offerings?: ReadonlyArray<{ readonly code: string; readonly display_name: string; readonly position: number }>;
      readonly bonus_candidates?: ReadonlyArray<{ readonly code: string; readonly display_name: string }>;
      readonly rule_bonus?: { readonly paid_offering_code: string; readonly paid_display_name: string; readonly bonus_offering_code: string; readonly display_name: string; readonly position: number } | null;
      readonly max_bonus_courses?: CourseBonusMaxCoursesV1;
      readonly status: 'unavailable' | 'needs_interest' | 'not_eligible' | 'checkin_available'
        | 'review_available' | 'review_pending' | 'offer_available' | 'accepted';
      readonly may_schedule_checkin: boolean;
      readonly may_request_review: boolean;
      readonly may_accept_offer: boolean;
      readonly may_send_promoted_payment: boolean;
      readonly promotion_code: string | null;
      readonly bonus_selection_mode?: 'configured' | 'any_active_course';
      readonly interest_offering_code?: string | null;
      readonly bonus_offerings: ReadonlyArray<{
        readonly offered_at?: string;
        readonly code: string;
        readonly display_name: string;
        readonly position: number;
      }>;
    };
    readonly call_contact_requirements?: ReadonlyArray<{
      readonly field: 'nombre' | 'apellido' | 'correo' | 'telefono';
      readonly reason: 'missing' | 'written_whatsapp_confirmation_required';
    }>;
    readonly call_execution?: {
      readonly next_step: 'none' | 'collect_contact_details' | 'confirm_availability' | 'dispatch_authorized';
      readonly request_call_now_authorized: boolean;
    };
  };
}

export type AgentAProposedActionV1 =
  | { readonly type: 'none' }
  | { readonly type: 'request_call_now'; readonly reason: 'direct_request' | 'accepted_offer' }
  | { readonly type: 'schedule_price_objection_checkin'; readonly reason: 'price_objection' }
  | {
      readonly type: 'request_promotion_review';
      readonly reason: 'persistent_price_objection';
      readonly bonus_offering_code?: string;
    }
  | { readonly type: 'accept_promotion' }
  | {
      readonly type: 'accept_promotion';
      readonly promotion_code: string;
      readonly interest_offering_code: string;
      readonly promotion_cycle_id: string;
      readonly offer_version: number;
    }
  | {
      readonly type: 'offer_course_bonus';
      readonly bonus_offering_code: string;
      readonly interest_offering_code: string;
      readonly motive: { readonly kind: 'price_objection' | 'promotion_rejection' | 'better_promotion_request' | 'purchase_decline'; readonly quote: string };
    }
  | {
      /** Temporary, hidden Stripe verification checkout. Never a commercial plan. */
      readonly type: 'send_course_program';
      readonly offering_code: string;
    }
  | {
      readonly type: 'send_test_payment_link';
      readonly offering_code: string;
    }
  | {
      readonly type: 'send_payment_link';
      readonly offering_code: string;
      readonly payment_plan: AgentAPaymentPlanV1;
      readonly promotion_code?: string;
    };

export interface AgentATurnProposalV1 {
  /** Legacy clients may omit metadata; the backend still checks every named course. */
  readonly course_mentions?: readonly CourseMentionV1[];
  readonly schema_version: 1;
  readonly move: ConversationMoveV1;
  readonly response: {
    /** Non-empty at the transport schema; bubble count is conversational guidance. */
    readonly messages: readonly string[];
    readonly call_offer?: string | null;
  };
  readonly proposed_action: AgentAProposedActionV1;
  /** Model interpretation of the customer confirming the last delivered phone. */
  readonly confirmed_phone?: string | null;
  readonly profile_updates?: readonly ContactProfileUpdateV1[];
  readonly profile_requests?: readonly ContactProfileRequestV1[];
  readonly used_fact_ids: readonly string[];
  readonly used_memory_ids: readonly string[];
  readonly stage_hypothesis?: 'exploring' | 'qualified' | 'course_selected' | 'plan_selected'
    | 'payment_link_sent' | 'handoff' | 'closed';
  readonly repair_of?: {
    readonly rejection_id: string;
    readonly attempt: 1;
  } | null;
  /** Internal evidence only; never customer-visible and never used by any rule. */
  readonly turn_reasoning?: {
    readonly phase: string;
    readonly customer_now: string;
    readonly already_said: string;
    readonly customer_goal: string;
    readonly next_step: 'discover' | 'value' | 'objection' | 'close' | 'promo' | 'call'
      | 'checkout' | 'post_sale' | 'other';
  };
  readonly memory_candidates: ReadonlyArray<{
    readonly type: AgentAMemoryTypeV1;
    readonly key: string;
    readonly value: string;
    readonly source_quote: string;
    readonly confidence: number;
  }>;
}
