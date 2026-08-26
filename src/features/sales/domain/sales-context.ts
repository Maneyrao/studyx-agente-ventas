export const SALES_CONTEXT_STAGES = [
  'exploring',
  'qualified',
  'course_selected',
  'plan_selected',
  'payment_link_sent',
  'handoff',
  'closed',
] as const;

export type SalesContextStage = typeof SALES_CONTEXT_STAGES[number];
export type SalesPaymentPlan = 'monthly_12' | 'monthly_6' | 'one_time';

export interface SalesContextState {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
  readonly stage: SalesContextStage;
  readonly source_turn_id: string | null;
  readonly version: number;
  readonly updated_at: string;
}

export interface SalesContextTransition {
  readonly workspace_slug: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly source_turn_id: string | null;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
  readonly stage: SalesContextStage;
}

export function isSalesPaymentPlan(value: unknown): value is SalesPaymentPlan {
  return value === 'monthly_12' || value === 'monthly_6' || value === 'one_time';
}
