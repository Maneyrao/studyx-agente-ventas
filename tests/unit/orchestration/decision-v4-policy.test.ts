import { describe, expect, it } from 'vitest';

/**
 * Decision v4 freezes the call protocol between Agent A and the backend:
 * `call_offer` proposes (no side effect, waits for the customer) and
 * `call_confirmation` + `request_call_now` commits to asking for a call.
 * The model can never smuggle identity: phone, contact_id, call_id,
 * provider IDs and consent evidence are derived by the backend only.
 */
import {
  DecisionValidationError,
} from '../../../src/features/orchestration/domain/decision';
import {
  parseDecisionAnyVersion,
  parseDecisionV4,
} from '../../../src/features/orchestration/domain/decision-v4';

const CONFIRMATION_RESPONSE =
  'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.';

function v4(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: CONFIRMATION_RESPONSE,
    response_type: 'call_confirmation',
    confidence: 1,
    reason_code: 'CALL_CONSENT_ACCEPTED',
    business_action: {
      type: 'request_call_now',
      reason: 'accepted_offer',
      course_of_interest: 'Python',
    },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: null,
    ...overrides,
  };
}

function callOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return v4({
    response: '¿Querés que te llamemos a este número?',
    response_type: 'call_offer',
    reason_code: 'CALL_OFFER_PROPOSED',
    business_action: null,
    next_state: 'waiting_user',
    ...overrides,
  });
}

function codeOf(value: Record<string, unknown>): string {
  try {
    parseDecisionV4(value);
    return 'PARSED';
  } catch (error) {
    if (error instanceof DecisionValidationError) return error.code;
    throw error;
  }
}

describe('parseDecisionV4 — request_call_now', () => {
  it('accepts the canonical call_confirmation with an accepted_offer request', () => {
    expect(() => parseDecisionV4(v4())).not.toThrow();
  });

  it('accepts a direct_request without course_of_interest', () => {
    const parsed = parseDecisionV4(
      v4({ business_action: { type: 'request_call_now', reason: 'direct_request' } }),
    );
    expect(parsed.business_action).toEqual({ type: 'request_call_now', reason: 'direct_request' });
    expect(parsed.schema_version).toBe(4);
  });

  it('rejects request_call_now outside call_confirmation', () => {
    for (const responseType of ['clarification', 'commercial_reply', 'automation_only']) {
      const value = v4({
        response_type: responseType,
        kind: responseType === 'clarification' ? 'clarify' : 'reply',
      });
      expect(codeOf(value)).not.toBe('PARSED');
    }
  });

  it('rejects call_confirmation without a request_call_now action', () => {
    expect(codeOf(v4({ business_action: null }))).toBe('INVALID_CALL_REQUEST');
    expect(
      codeOf(v4({ business_action: { type: 'mark_hot_lead', score: 0.9 } })),
    ).toBe('INVALID_CALL_REQUEST');
  });

  it('rejects suppress with a call request', () => {
    expect(
      codeOf(v4({ kind: 'suppress', response: null, response_type: null })),
    ).not.toBe('PARSED');
  });

  it('rejects an unknown reason', () => {
    expect(
      codeOf(v4({ business_action: { type: 'request_call_now', reason: 'model_felt_like_it' } })),
    ).toBe('INVALID_BUSINESS_ACTION');
  });

  it('rejects any identity field chosen by the model', () => {
    const forbidden = [
      { phone_e164: '+5491100000000' },
      { contact_id: '18a823e8-27c2-4279-9956-058f45f33cd5' },
      { call_id: '18a823e8-27c2-4279-9956-058f45f33cd5' },
      { provider_call_id: 'retell:abc' },
      { consent_evidence: { source_message_id: 'x' } },
    ];
    for (const extra of forbidden) {
      const action = { type: 'request_call_now', reason: 'direct_request', ...extra };
      expect(codeOf(v4({ business_action: action }))).toBe('INVALID_BUSINESS_ACTION');
    }
  });

  it('rejects identity fields at the decision top level', () => {
    expect(codeOf(v4({ phone_e164: '+5491100000000' }))).toBe('UNKNOWN_DECISION_FIELD');
  });

  it('rejects v3-only business actions in v4', () => {
    expect(
      codeOf(v4({ business_action: { type: 'escalate_to_human', reason: 'x' } })),
    ).toBe('INVALID_BUSINESS_ACTION');
    expect(
      codeOf(v4({ business_action: { type: 'send_pricing_info', sku: 'PY-101' } })),
    ).toBe('INVALID_BUSINESS_ACTION');
  });

  it('still accepts the observational v4 actions with their v3 shapes', () => {
    const parsed = parseDecisionV4(
      v4({
        response_type: 'commercial_reply',
        business_action: { type: 'mark_hot_lead', score: 0.8 },
      }),
    );
    expect(parsed.business_action).toEqual({ type: 'mark_hot_lead', score: 0.8 });
  });
});

describe('parseDecisionV4 — call_offer', () => {
  it('accepts a reply offer that waits for the customer', () => {
    const parsed = parseDecisionV4(callOffer());
    expect(parsed.response_type).toBe('call_offer');
    expect(parsed.business_action).toBeNull();
    expect(parsed.next_state).toBe('waiting_user');
  });

  it('rejects a call_offer with any business action', () => {
    expect(
      codeOf(callOffer({ business_action: { type: 'mark_hot_lead', score: 1 } })),
    ).toBe('INVALID_CALL_OFFER');
  });

  it('rejects a call_offer that does not wait for the customer', () => {
    expect(codeOf(callOffer({ next_state: 'completed' }))).toBe('INVALID_CALL_OFFER');
  });

  it('rejects a call_offer emitted as clarify or suppress', () => {
    expect(codeOf(callOffer({ kind: 'clarify' }))).not.toBe('PARSED');
    expect(codeOf(callOffer({ kind: 'suppress', response: null }))).not.toBe('PARSED');
  });
});

describe('parseDecisionAnyVersion — compatibility', () => {
  it('dispatches v2, v3 and v4 by schema_version', () => {
    const base = {
      intent: 'social',
      kind: 'reply',
      response: 'Hola',
      response_type: 'social_reply',
      confidence: 1,
      reason_code: 'GREETING',
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    };
    expect(
      parseDecisionAnyVersion({ ...base, schema_version: 2, business_action: null }).schema_version,
    ).toBe(2);
    expect(
      parseDecisionAnyVersion({
        ...base,
        schema_version: 3,
        business_action: null,
        retrieval_used: null,
      }).schema_version,
    ).toBe(3);
    expect(parseDecisionAnyVersion(v4()).schema_version).toBe(4);
  });

  it('keeps call response types out of v3', () => {
    expect(() =>
      parseDecisionAnyVersion({
        ...v4(),
        schema_version: 3,
        business_action: null,
      }),
    ).toThrow(DecisionValidationError);
  });

  it('rejects unknown schema versions', () => {
    expect(codeOf(v4({ schema_version: 5 }))).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });
});
