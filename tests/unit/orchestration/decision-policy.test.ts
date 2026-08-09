import { describe, expect, it } from 'vitest';
import {
  DecisionValidationError,
  parseDecisionV2,
} from '@/features/orchestration/domain/decision';

describe('Decision v2 policy', () => {
  it('accepts a complete clarification and preserves its literal contract', () => {
    expect(parseDecisionV2({
      schema_version: 2,
      intent: 'commercial',
      kind: 'clarify',
      response: '¿Sobre qué curso querés consultar?',
      response_type: 'clarification',
      confidence: 0.72,
      reason_code: 'MISSING_INFORMATION',
      business_action: null,
      memory_candidates: [],
      missing_information: ['offering'],
      next_state: 'waiting_user',
    })).toEqual({
      schema_version: 2,
      intent: 'commercial',
      kind: 'clarify',
      response: '¿Sobre qué curso querés consultar?',
      response_type: 'clarification',
      confidence: 0.72,
      reason_code: 'MISSING_INFORMATION',
      business_action: null,
      memory_candidates: [],
      missing_information: ['offering'],
      next_state: 'waiting_user',
    });
  });

  it('rejects the previous decision shape', () => {
    expect(() => parseDecisionV2({
      kind: 'reply',
      content: 'Hola',
      response_type: 'sales',
      business_action: null,
      reason_code: 'LEGACY',
      confidence: 1,
    })).toThrowError(new DecisionValidationError('SCHEMA_VERSION_UNSUPPORTED'));
  });

  it('rejects unknown properties instead of silently weakening the contract', () => {
    expect(() => parseDecisionV2({
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'Puedo contarte sobre el curso.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'COMMERCIAL_REPLY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
      content: 'campo legado',
    })).toThrowError(new DecisionValidationError('UNKNOWN_DECISION_FIELD'));
  });

  it.each([
    {
      name: 'response',
      decision: {
        schema_version: 2,
        intent: 'unknown',
        kind: 'suppress',
        response: 'No enviar',
        response_type: null,
        confidence: 1,
        reason_code: 'SUPPRESSED',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
      },
    },
    {
      name: 'response type',
      decision: {
        schema_version: 2,
        intent: 'unknown',
        kind: 'suppress',
        response: null,
        response_type: 'technical_fallback',
        confidence: 1,
        reason_code: 'SUPPRESSED',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
      },
    },
    {
      name: 'missing information',
      decision: {
        schema_version: 2,
        intent: 'unknown',
        kind: 'suppress',
        response: null,
        response_type: null,
        confidence: 1,
        reason_code: 'SUPPRESSED',
        business_action: null,
        memory_candidates: [],
        missing_information: ['offering'],
        next_state: 'completed',
      },
    },
    {
      name: 'memory candidate',
      decision: {
        schema_version: 2,
        intent: 'unknown',
        kind: 'suppress',
        response: null,
        response_type: null,
        confidence: 1,
        reason_code: 'SUPPRESSED',
        business_action: null,
        memory_candidates: [{
          type: 'preference',
          key: 'schedule',
          value: 'turno noche',
          source_quote: 'Prefiero el turno noche',
          confidence: 0.95,
        }],
        missing_information: [],
        next_state: 'completed',
      },
    },
  ])('rejects suppress with a $name side effect', ({ decision }) => {
    expect(() => parseDecisionV2(decision)).toThrowError(
      new DecisionValidationError('SUPPRESS_HAS_SIDE_EFFECT')
    );
  });

  it.each([
    {
      schema_version: 2,
      intent: 'commercial',
      kind: 'clarify',
      response: null,
      response_type: 'clarification',
      confidence: 0.7,
      reason_code: 'MISSING_INFORMATION',
      business_action: null,
      memory_candidates: [],
      missing_information: ['offering'],
      next_state: 'waiting_user',
    },
    {
      schema_version: 2,
      intent: 'commercial',
      kind: 'clarify',
      response: '¿Sobre qué curso querés consultar?',
      response_type: 'clarification',
      confidence: 0.7,
      reason_code: 'MISSING_INFORMATION',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
    },
    {
      schema_version: 2,
      intent: 'commercial',
      kind: 'clarify',
      response: '¿Sobre qué curso querés consultar?',
      response_type: 'clarification',
      confidence: 0.7,
      reason_code: 'MISSING_INFORMATION',
      business_action: null,
      memory_candidates: [],
      missing_information: ['offering'],
      next_state: 'completed',
    },
  ])('rejects an incomplete clarification', (decision) => {
    expect(() => parseDecisionV2(decision)).toThrowError(
      new DecisionValidationError('INVALID_CLARIFICATION')
    );
  });

  it('accepts a human request only as an automated waiting-user response', () => {
    expect(parseDecisionV2({
      schema_version: 2,
      intent: 'human_request',
      kind: 'reply',
      response: 'No puedo transferirte a una persona. Puedo ayudarte por acá o explicarte las opciones disponibles.',
      response_type: 'automation_only',
      confidence: 0.98,
      reason_code: 'AUTOMATED_ASSISTANCE_ONLY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
    })).toEqual({
      schema_version: 2,
      intent: 'human_request',
      kind: 'reply',
      response: 'No puedo transferirte a una persona. Puedo ayudarte por acá o explicarte las opciones disponibles.',
      response_type: 'automation_only',
      confidence: 0.98,
      reason_code: 'AUTOMATED_ASSISTANCE_ONLY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
    });
  });

  it.each([
    {
      schema_version: 2,
      intent: 'human_request',
      kind: 'reply',
      response: 'Te ayudo por acá.',
      response_type: 'social_reply',
      confidence: 1,
      reason_code: 'WRONG_TYPE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
    },
    {
      schema_version: 2,
      intent: 'human_request',
      kind: 'reply',
      response: 'Te ayudo por acá.',
      response_type: 'automation_only',
      confidence: 1,
      reason_code: 'WRONG_STATE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
  ])('rejects a human request outside the automation-only waiting state', (decision) => {
    expect(() => parseDecisionV2(decision)).toThrowError(
      new DecisionValidationError('INVALID_HUMAN_REQUEST')
    );
  });

  it.each([
    {
      schema_version: 2,
      intent: 'opt_out',
      kind: 'reply',
      response: 'Entendido. No volveremos a escribirte.',
      response_type: 'social_reply',
      confidence: 1,
      reason_code: 'WRONG_TYPE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    },
    {
      schema_version: 2,
      intent: 'opt_out',
      kind: 'reply',
      response: 'Entendido. No volveremos a escribirte.',
      response_type: 'opt_out_ack',
      confidence: 1,
      reason_code: 'WRONG_STATE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
    },
    {
      schema_version: 2,
      intent: 'opt_out',
      kind: 'reply',
      response: 'Entendido. No volveremos a escribirte.',
      response_type: 'opt_out_ack',
      confidence: 1,
      reason_code: 'MEMORY_NOT_ALLOWED',
      business_action: null,
      memory_candidates: [{
        type: 'preference',
        key: 'contact',
        value: 'do-not-contact',
        source_quote: 'No me escribas más',
        confidence: 1,
      }],
      missing_information: [],
      next_state: 'completed',
    },
  ])('rejects an invalid opt-out acknowledgement', (decision) => {
    expect(() => parseDecisionV2(decision)).toThrowError(
      new DecisionValidationError('INVALID_OPT_OUT')
    );
  });

  it('rejects every non-null business action', () => {
    expect(() => parseDecisionV2({
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'Puedo contarte sobre el curso.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'COMMERCIAL_REPLY',
      business_action: { type: 'anything' },
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    })).toThrowError(new DecisionValidationError('BUSINESS_ACTION_FORBIDDEN'));
  });

  it.each(['retry_pending', 'paused_error', 'failed'])('rejects technical state %s as a model decision', (next_state) => {
    expect(() => parseDecisionV2({
      schema_version: 2,
      intent: 'unknown',
      kind: 'reply',
      response: 'No pude procesar tu consulta.',
      response_type: 'technical_fallback',
      confidence: 1,
      reason_code: 'MODEL_UNAVAILABLE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state,
    })).toThrowError(new DecisionValidationError('INVALID_NEXT_STATE'));
  });
});
