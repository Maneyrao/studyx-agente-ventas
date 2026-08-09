import { describe, expect, it } from 'vitest';
import {
  parseDecisionV3,
  parseDecisionAny,
  type DecisionV3,
} from '@/features/orchestration/domain/decision-v3';
import { DecisionValidationError } from '@/features/orchestration/domain/decision';

const validCore: Omit<DecisionV3, 'business_action' | 'retrieval_used'> = {
  schema_version: 3,
  intent: 'commercial',
  kind: 'reply',
  response: 'El curso cuesta 100 pesos.',
  response_type: 'commercial_reply',
  confidence: 0.9,
  reason_code: 'ANSWER_PRICE',
  memory_candidates: [],
  missing_information: [],
  next_state: 'completed',
};

describe('parseDecisionV3', () => {
  it('accepts a minimal v3 with null business_action + null retrieval_used', () => {
    const result = parseDecisionV3({
      ...validCore,
      business_action: null,
      retrieval_used: null,
    });
    expect(result.schema_version).toBe(3);
    expect(result.business_action).toBeNull();
    expect(result.retrieval_used).toBeNull();
  });

  it('accepts business_action=send_pricing_info with a SKU', () => {
    const result = parseDecisionV3({
      ...validCore,
      business_action: { type: 'send_pricing_info', sku: 'CURSO-VENTAS-PRO' },
      retrieval_used: null,
    });
    expect(result.business_action).toEqual({
      type: 'send_pricing_info',
      sku: 'CURSO-VENTAS-PRO',
    });
  });

  it('accepts business_action=schedule_followup with ISO datetime', () => {
    const result = parseDecisionV3({
      ...validCore,
      business_action: { type: 'schedule_followup', when_iso: '2026-08-15T14:30:00Z' },
      retrieval_used: null,
    });
    expect(result.business_action?.type).toBe('schedule_followup');
  });

  it('rejects schedule_followup with a non-ISO datetime', () => {
    expect(() =>
      parseDecisionV3({
        ...validCore,
        business_action: { type: 'schedule_followup', when_iso: 'tomorrow at 2pm' },
        retrieval_used: null,
      }),
    ).toThrow(DecisionValidationError);
  });

  it('rejects mark_hot_lead with score out of [0,1]', () => {
    expect(() =>
      parseDecisionV3({
        ...validCore,
        business_action: { type: 'mark_hot_lead', score: 1.5 },
        retrieval_used: null,
      }),
    ).toThrow(DecisionValidationError);
  });

  it('accepts retrieval_used with kb=true, ltm=false, summary_version=7', () => {
    const result = parseDecisionV3({
      ...validCore,
      business_action: null,
      retrieval_used: { kb: true, long_term_memory: false, summary_version: 7 },
    });
    expect(result.retrieval_used).toEqual({
      kb: true,
      long_term_memory: false,
      summary_version: 7,
    });
  });

  it('rejects retrieval_used with negative summary_version', () => {
    expect(() =>
      parseDecisionV3({
        ...validCore,
        business_action: null,
        retrieval_used: { kb: false, long_term_memory: false, summary_version: -1 },
      }),
    ).toThrow(DecisionValidationError);
  });

  it('rejects business_action on a suppress-kind decision (side-effect forbidden)', () => {
    expect(() =>
      parseDecisionV3({
        schema_version: 3,
        intent: 'out_of_scope',
        kind: 'suppress',
        response: null,
        response_type: null,
        confidence: 0.5,
        reason_code: 'OUT_OF_SCOPE',
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        business_action: { type: 'send_pricing_info', sku: 'X' },
        retrieval_used: null,
      }),
    ).toThrow(DecisionValidationError);
  });

  it('rejects unknown top-level fields', () => {
    expect(() =>
      parseDecisionV3({
        ...validCore,
        business_action: null,
        retrieval_used: null,
        stray: 'field',
      } as unknown),
    ).toThrow(DecisionValidationError);
  });

  it('preserves v2 rule: opt_out intent must use opt_out_ack response_type', () => {
    expect(() =>
      parseDecisionV3({
        schema_version: 3,
        intent: 'opt_out',
        kind: 'reply',
        response: 'Baja realizada.',
        response_type: 'commercial_reply', // wrong: must be opt_out_ack
        confidence: 1,
        reason_code: 'OPT_OUT',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      }),
    ).toThrow(DecisionValidationError);
  });
});

describe('parseDecisionAny', () => {
  it('routes to v2 when schema_version = 2', () => {
    const result = parseDecisionAny({
      schema_version: 2,
      intent: 'commercial',
      kind: 'reply',
      response: 'hola',
      response_type: 'commercial_reply',
      confidence: 0.7,
      reason_code: 'GREET',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    });
    expect(result.schema_version).toBe(2);
  });

  it('routes to v3 when schema_version = 3', () => {
    const result = parseDecisionAny({
      ...validCore,
      business_action: null,
      retrieval_used: null,
    });
    expect(result.schema_version).toBe(3);
  });

  it('rejects unknown schema_version', () => {
    expect(() =>
      parseDecisionAny({ ...validCore, schema_version: 99, business_action: null, retrieval_used: null }),
    ).toThrow(DecisionValidationError);
  });
});
