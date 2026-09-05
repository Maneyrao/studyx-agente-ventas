export type StatePatchFieldsV3 = {
  selected_offering_code: string | null;
  selected_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  stage: string;
  call_preference: string;
  call_offer_status: string;
  /** Delta, nunca un total: el contador es del sistema. */
  call_offer_delta: 0 | 1;
  awaiting_reply: string;
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

function isDeferred(field: keyof StatePatchFieldsV3, value: unknown): boolean {
  if (field === 'stage') return DEFERRED_STAGES.has(String(value));
  if (field === 'call_offer_status') return DEFERRED_CALL_OFFER_STATUS.has(String(value));
  return DEFERRED_FIELDS.has(field);
}

export function splitStatePatchV3(patch: StatePatchV3): {
  readonly immediate: StatePatchV3;
  readonly deferred: StatePatchV3;
} {
  const immediate: Partial<StatePatchFieldsV3> = {};
  const deferred: Partial<StatePatchFieldsV3> = {};
  for (const [field, value] of Object.entries(patch.set) as [keyof StatePatchFieldsV3, never][]) {
    if (value === undefined) continue;
    (isDeferred(field, value) ? deferred : immediate)[field] = value;
  }
  return {
    immediate: { expected_state_version: patch.expected_state_version, set: immediate },
    deferred: { expected_state_version: patch.expected_state_version, set: deferred },
  };
}
