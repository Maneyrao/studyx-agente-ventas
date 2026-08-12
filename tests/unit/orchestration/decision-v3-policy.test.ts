import { describe, expect, it } from 'vitest';
import {
  PERMITTED_BUSINESS_ACTIONS,
  assertBusinessActionPermitted,
  isBusinessActionPermitted,
  parseDecisionAny,
  parseDecisionV3,
} from '@/features/orchestration/domain/decision-v3';
import { DecisionValidationError } from '@/features/orchestration/domain/decision';

function v3(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 3,
    intent: 'commercial',
    kind: 'reply',
    response: 'Te cuento las opciones de cursada.',
    response_type: 'commercial_reply',
    confidence: 0.9,
    reason_code: 'ANSWER_OPTIONS',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: { kb: true, long_term_memory: false, summary_version: 3 },
    ...overrides,
  };
}

describe('business action policy', () => {
  it('permits the two observational actions', () => {
    expect(PERMITTED_BUSINESS_ACTIONS).toEqual(['mark_hot_lead', 'log_objection']);
    expect(isBusinessActionPermitted({ type: 'mark_hot_lead', score: 0.8 })).toBe(true);
    expect(isBusinessActionPermitted({ type: 'log_objection', objection_key: 'precio', quote: 'caro' })).toBe(true);
  });

  it('permits the absence of an action', () => {
    expect(isBusinessActionPermitted(null)).toBe(true);
    expect(() => assertBusinessActionPermitted(null)).not.toThrow();
  });

  it('refuses human handoff with its own code', () => {
    expect(() => assertBusinessActionPermitted({ type: 'escalate_to_human', reason: 'pide humano' }))
      .toThrow(DecisionValidationError);
    try {
      assertBusinessActionPermitted({ type: 'escalate_to_human', reason: 'pide humano' });
    } catch (error) {
      expect((error as DecisionValidationError).code).toBe('HUMAN_HANDOFF_FORBIDDEN');
    }
  });

  it.each([
    ['send_pricing_info', { type: 'send_pricing_info', sku: 'PY-8' }],
    ['schedule_followup', { type: 'schedule_followup', when_iso: '2026-09-01T10:00:00Z' }],
  ])('refuses the outward-facing action %s', (_label, action) => {
    expect(isBusinessActionPermitted(action as never)).toBe(false);
    try {
      assertBusinessActionPermitted(action as never);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DecisionValidationError).code).toBe('BUSINESS_ACTION_NOT_PERMITTED');
    }
  });
});

describe('v3 parsing stays a strict superset of v2', () => {
  it('accepts a v3 decision with retrieval_used', () => {
    const parsed = parseDecisionV3(v3());
    expect(parsed.schema_version).toBe(3);
    expect(parsed.retrieval_used).toEqual({ kb: true, long_term_memory: false, summary_version: 3 });
  });

  it('accepts a v3 decision carrying a permitted action', () => {
    const parsed = parseDecisionV3(v3({ business_action: { type: 'mark_hot_lead', score: 0.9 } }));
    expect(parsed.business_action).toEqual({ type: 'mark_hot_lead', score: 0.9 });
  });

  it('still routes a v2 payload through the v2 rules', () => {
    const parsed = parseDecisionAny({
      schema_version: 2,
      intent: 'social',
      kind: 'reply',
      response: 'Hola',
      response_type: 'social_reply',
      confidence: 0.9,
      reason_code: 'GREETING',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    });
    expect(parsed.schema_version).toBe(2);
  });

  it('keeps enforcing the v2 human_request rule under v3', () => {
    expect(() =>
      parseDecisionV3(
        v3({ intent: 'human_request', response_type: 'commercial_reply', next_state: 'completed' })
      )
    ).toThrow(DecisionValidationError);
  });

  it('refuses an action attached to a suppressed turn', () => {
    expect(() =>
      parseDecisionV3(
        v3({
          kind: 'suppress',
          response: null,
          response_type: null,
          business_action: { type: 'mark_hot_lead', score: 0.5 },
        })
      )
    ).toThrow(DecisionValidationError);
  });
});
