export type StatePatchFieldsV3 = {
  selected_offering_code: string | null;
  selected_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  stage: 'exploring' | 'qualified' | 'course_selected' | 'plan_selected'
    | 'payment_link_sent' | 'handoff' | 'closed';
  call_preference: 'unknown' | 'call' | 'chat' | 'declined';
  call_offer_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
  /** Delta, nunca un total: el contador es del sistema. */
  call_offer_delta: 0 | 1;
  awaiting_reply: 'none' | 'area_choice' | 'course_choice' | 'call_or_chat'
    | 'payment_plan' | 'payment_confirmation' | 'contact_details';
  payment_reported: boolean;
};

export interface StatePatchV3 {
  readonly expected_state_version: number;
  readonly set: Partial<StatePatchFieldsV3>;
}

/** Campos que sólo son ciertos si el cliente vio el mensaje. */
const DEFERRED_FIELDS = new Set<keyof StatePatchFieldsV3>([
  'call_offer_delta', 'awaiting_reply',
]);
/** `stage` se clasifica por su VALOR: lo que el agente entregó es diferido. */
const DEFERRED_STAGES = new Set(['payment_link_sent', 'handoff']);
/** `call_offer_status` sólo es diferido cuando afirma haber ofrecido. */
const DEFERRED_CALL_OFFER_STATUS = new Set(['offered']);

const PATCH_FIELDS = new Set<keyof StatePatchFieldsV3>([
  'selected_offering_code', 'selected_payment_plan', 'stage', 'call_preference',
  'call_offer_status', 'call_offer_delta', 'awaiting_reply', 'payment_reported',
]);
const PAYMENT_PLANS = new Set(['monthly_12', 'monthly_6', 'one_time']);
const STAGES = new Set([
  'exploring', 'qualified', 'course_selected', 'plan_selected',
  'payment_link_sent', 'handoff', 'closed',
]);
const CALL_PREFERENCES = new Set(['unknown', 'call', 'chat', 'declined']);
const CALL_OFFER_STATUSES = new Set(['not_offered', 'offered', 'accepted', 'declined']);
const AWAITING_REPLIES = new Set([
  'none', 'area_choice', 'course_choice', 'call_or_chat',
  'payment_plan', 'payment_confirmation', 'contact_details',
]);

function assertValidField(field: keyof StatePatchFieldsV3, value: unknown): void {
  let valid = PATCH_FIELDS.has(field);
  if (field === 'selected_offering_code') {
    valid = valid && (value === null || typeof value === 'string' && value.length > 0);
  } else if (field === 'selected_payment_plan') {
    valid = valid && (value === null || PAYMENT_PLANS.has(String(value)));
  } else if (field === 'stage') valid = valid && STAGES.has(String(value));
  else if (field === 'call_preference') valid = valid && CALL_PREFERENCES.has(String(value));
  else if (field === 'call_offer_status') valid = valid && CALL_OFFER_STATUSES.has(String(value));
  else if (field === 'call_offer_delta') valid = valid && (value === 0 || value === 1);
  else if (field === 'awaiting_reply') valid = valid && AWAITING_REPLIES.has(String(value));
  else if (field === 'payment_reported') valid = valid && typeof value === 'boolean';
  if (!valid) throw new Error(`STATE_PATCH_INVALID:${field}`);
}

function isDeferred(field: keyof StatePatchFieldsV3, value: unknown): boolean {
  if (field === 'stage') return DEFERRED_STAGES.has(String(value));
  if (field === 'call_offer_status') return DEFERRED_CALL_OFFER_STATUS.has(String(value));
  return DEFERRED_FIELDS.has(field);
}

export function splitStatePatchV3(patch: StatePatchV3): {
  readonly immediate: StatePatchV3;
  readonly deferred: StatePatchV3;
} {
  if (!Number.isSafeInteger(patch.expected_state_version) || patch.expected_state_version < 1) {
    throw new Error('STATE_PATCH_INVALID:expected_state_version');
  }
  const immediate: Partial<StatePatchFieldsV3> = {};
  const deferred: Partial<StatePatchFieldsV3> = {};
  for (const [field, value] of Object.entries(patch.set) as [keyof StatePatchFieldsV3, never][]) {
    if (value === undefined) continue;
    assertValidField(field, value);
    (isDeferred(field, value) ? deferred : immediate)[field] = value;
  }
  return {
    immediate: { expected_state_version: patch.expected_state_version, set: immediate },
    deferred: { expected_state_version: patch.expected_state_version, set: deferred },
  };
}
