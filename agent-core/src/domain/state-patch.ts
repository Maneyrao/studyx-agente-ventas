export const SALES_PAYMENT_PLANS_V3 = ['monthly_12', 'monthly_6', 'one_time'] as const;
export const SALES_CONTEXT_STAGES_V3 = [
  'exploring',
  'qualified',
  'course_selected',
  'plan_selected',
  'payment_link_sent',
  'handoff',
  'closed',
] as const;
export const CALL_PREFERENCES_V3 = ['unknown', 'call', 'chat', 'declined'] as const;
export const CALL_OFFER_STATUSES_V3 = [
  'not_offered', 'offered', 'accepted', 'declined',
] as const;
export const AWAITING_REPLIES_V3 = [
  'none',
  'area_choice',
  'course_choice',
  'call_or_chat',
  'payment_plan',
  'payment_confirmation',
  'contact_details',
] as const;

export type SalesPaymentPlanV3 = typeof SALES_PAYMENT_PLANS_V3[number];
export type SalesContextStageV3 = typeof SALES_CONTEXT_STAGES_V3[number];
export type CallPreferenceV3 = typeof CALL_PREFERENCES_V3[number];
export type CallOfferStatusV3 = typeof CALL_OFFER_STATUSES_V3[number];
export type AwaitingReplyV3 = typeof AWAITING_REPLIES_V3[number];

export type StatePatchFieldsV3 = {
  selected_offering_code: string | null;
  selected_payment_plan: SalesPaymentPlanV3 | null;
  stage: SalesContextStageV3;
  call_preference: CallPreferenceV3;
  call_offer_status: CallOfferStatusV3;
  /** Delta, nunca un total: el contador es del sistema. */
  call_offer_delta: 0 | 1;
  awaiting_reply: AwaitingReplyV3;
  payment_reported: boolean;
};

export interface StatePatchV3 {
  readonly expected_state_version: number;
  readonly set: Partial<StatePatchFieldsV3>;
}

type PatchFieldV3 = keyof StatePatchFieldsV3;
type PatchDestinationV3 = 'immediate' | 'deferred';

function isDomainValue<const Values extends readonly string[]>(
  domain: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === 'string' && (domain as readonly string[]).includes(value);
}

type FieldValidatorV3<Field extends PatchFieldV3> = (
  value: unknown,
) => value is StatePatchFieldsV3[Field];

const FIELD_VALIDATORS = {
  selected_offering_code: (value: unknown): value is string | null => (
    value === null || typeof value === 'string' && value.length > 0
  ),
  selected_payment_plan: (value: unknown): value is SalesPaymentPlanV3 | null => (
    value === null || isDomainValue(SALES_PAYMENT_PLANS_V3, value)
  ),
  stage: (value: unknown): value is SalesContextStageV3 => (
    isDomainValue(SALES_CONTEXT_STAGES_V3, value)
  ),
  call_preference: (value: unknown): value is CallPreferenceV3 => (
    isDomainValue(CALL_PREFERENCES_V3, value)
  ),
  call_offer_status: (value: unknown): value is CallOfferStatusV3 => (
    isDomainValue(CALL_OFFER_STATUSES_V3, value)
  ),
  call_offer_delta: (value: unknown): value is 0 | 1 => value === 0 || value === 1,
  awaiting_reply: (value: unknown): value is AwaitingReplyV3 => (
    isDomainValue(AWAITING_REPLIES_V3, value)
  ),
  payment_reported: (value: unknown): value is boolean => typeof value === 'boolean',
} satisfies { readonly [Field in PatchFieldV3]: FieldValidatorV3<Field> };

const STAGE_DESTINATIONS = {
  exploring: 'immediate',
  qualified: 'immediate',
  course_selected: 'immediate',
  plan_selected: 'immediate',
  payment_link_sent: 'deferred',
  handoff: 'deferred',
  closed: 'immediate',
} as const satisfies Record<SalesContextStageV3, PatchDestinationV3>;

const CALL_OFFER_STATUS_DESTINATIONS = {
  not_offered: 'immediate',
  offered: 'deferred',
  accepted: 'immediate',
  declined: 'immediate',
} as const satisfies Record<CallOfferStatusV3, PatchDestinationV3>;

const FIELD_DESTINATIONS = {
  selected_offering_code: 'immediate',
  selected_payment_plan: 'immediate',
  call_preference: 'immediate',
  call_offer_delta: 'deferred',
  awaiting_reply: 'deferred',
  payment_reported: 'immediate',
} as const satisfies Record<
  Exclude<PatchFieldV3, 'stage' | 'call_offer_status'>,
  PatchDestinationV3
>;

function assertValidField(field: string, value: unknown): asserts field is PatchFieldV3 {
  if (!Object.prototype.hasOwnProperty.call(FIELD_VALIDATORS, field)) {
    throw new Error(`STATE_PATCH_INVALID:${field}`);
  }
  const validator = FIELD_VALIDATORS[field as PatchFieldV3] as (candidate: unknown) => boolean;
  if (!validator(value)) throw new Error(`STATE_PATCH_INVALID:${field}`);
}

function isDeferred(field: PatchFieldV3, value: unknown): boolean {
  if (field === 'stage') {
    return STAGE_DESTINATIONS[value as SalesContextStageV3] === 'deferred';
  }
  if (field === 'call_offer_status') {
    return CALL_OFFER_STATUS_DESTINATIONS[value as CallOfferStatusV3] === 'deferred';
  }
  return FIELD_DESTINATIONS[field] === 'deferred';
}

export function splitStatePatchV3(patch: StatePatchV3): {
  readonly immediate: StatePatchV3;
  readonly deferred: StatePatchV3;
} {
  if (!Number.isSafeInteger(patch.expected_state_version) || patch.expected_state_version < 0) {
    throw new Error('STATE_PATCH_INVALID:expected_state_version');
  }
  const immediate: Partial<StatePatchFieldsV3> = {};
  const deferred: Partial<StatePatchFieldsV3> = {};
  for (const [rawField, value] of Object.entries(patch.set)) {
    if (value === undefined) continue;
    assertValidField(rawField, value);
    const target = isDeferred(rawField, value) ? deferred : immediate;
    (target as Record<PatchFieldV3, unknown>)[rawField] = value;
  }
  return {
    immediate: { expected_state_version: patch.expected_state_version, set: immediate },
    deferred: { expected_state_version: patch.expected_state_version, set: deferred },
  };
}
