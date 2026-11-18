/**
 * Owner rule 2026-11-18: when a payment-link action lacks something, the bot asks for it
 * instead of failing the turn. The backend only publishes what is missing and the canonical
 * options; Agent A words the question. Pure and shared, so claim, tests and bot agree.
 */
export const PAYMENT_LINK_ACTIONS_V1 = ['send_payment_link', 'send_test_payment_link'] as const;
/** Subset of the existing `missing_information` enum (conversation-pipeline). */
export const ACTION_REQUIREMENT_MISSING_V1 = ['course_selection', 'payment_plan'] as const;

export type ActionRequirementMissingV1 = typeof ACTION_REQUIREMENT_MISSING_V1[number];

export interface ActionRequirementV1 {
  readonly action: typeof PAYMENT_LINK_ACTIONS_V1[number];
  readonly ready: boolean;
  /** In asking order: the level comes before the plan. */
  readonly missing: readonly ActionRequirementMissingV1[];
  /** Complete options for each missing item; empty when the backend cannot enumerate them. */
  readonly options: {
    readonly course_selection: readonly { readonly code: string; readonly display_name: string }[];
    readonly payment_plan: readonly string[];
  };
}

export function computeActionRequirementsV1(input: {
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: string | null;
  /** Complete level list of the course family named by the customer (never trimmed). */
  readonly family_offerings: readonly { readonly code: string; readonly display_name: string }[];
  readonly payment_plan_codes: readonly string[];
}): ActionRequirementV1[] {
  const missing: ActionRequirementMissingV1[] = [];
  if (input.selected_offering_code === null) missing.push('course_selection');
  if (input.selected_payment_plan === null) missing.push('payment_plan');
  return PAYMENT_LINK_ACTIONS_V1.map(action => ({
    action,
    ready: missing.length === 0,
    missing,
    options: {
      course_selection: input.selected_offering_code === null ? input.family_offerings : [],
      payment_plan: input.selected_payment_plan === null ? input.payment_plan_codes : [],
    },
  }));
}
