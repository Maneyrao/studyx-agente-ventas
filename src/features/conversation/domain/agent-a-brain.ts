import type { ConversationMoveV1 } from './conversation-pipeline';

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
  readonly customer: {
    readonly display_name: string | null;
    readonly memories: ReadonlyArray<{
      readonly id: string;
      readonly type: AgentAMemoryTypeV1;
      readonly key: string;
      readonly value: string;
      readonly confidence: number;
    }>;
  };
  readonly commercial_state: {
    readonly selected_offering_code: string | null;
    readonly selected_payment_plan: AgentAPaymentPlanV1 | null;
    readonly stage: 'exploring' | 'qualified' | 'course_selected' | 'plan_selected' | 'payment_link_sent' | 'handoff' | 'closed';
    readonly call_preference: 'unknown' | 'call' | 'chat' | 'declined';
    readonly call_offer_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
    readonly call_offer_count: 0 | 1 | 2;
    readonly awaiting_reply: 'none' | 'area_choice' | 'course_choice' | 'call_or_chat' | 'payment_plan' | 'payment_confirmation';
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
    readonly areas: ReadonlyArray<{ readonly code: string; readonly display_name: string }>;
    readonly candidate_offerings: ReadonlyArray<{
      readonly code: string;
      readonly display_name: string;
      readonly area_code: string | null;
    }>;
    readonly payment_plans: ReadonlyArray<{
      readonly code: AgentAPaymentPlanV1;
      readonly label: string;
    }>;
  };
  readonly capabilities: {
    readonly may_reply: boolean;
    readonly may_offer_call: boolean;
    readonly may_request_call_now: boolean;
    readonly may_present_payment_options: boolean;
    readonly may_send_payment_link: boolean;
    readonly authorized_payment_plan: AgentAPaymentPlanV1 | null;
  };
}

export type AgentAProposedActionV1 =
  | { readonly type: 'none' }
  | { readonly type: 'request_call_now'; readonly reason: 'direct_request' | 'accepted_offer' }
  | {
      readonly type: 'send_payment_link';
      readonly offering_code: string;
      readonly payment_plan: AgentAPaymentPlanV1;
    };

export interface AgentATurnProposalV1 {
  readonly schema_version: 1;
  readonly move: ConversationMoveV1;
  readonly response: {
    readonly messages: readonly [string] | readonly [string, string] | readonly [string, string, string];
  };
  readonly proposed_action: AgentAProposedActionV1;
  readonly used_fact_ids: readonly string[];
  readonly used_memory_ids: readonly string[];
  readonly memory_candidates: ReadonlyArray<{
    readonly type: AgentAMemoryTypeV1;
    readonly key: string;
    readonly value: string;
    readonly source_quote: string;
    readonly confidence: number;
  }>;
}
