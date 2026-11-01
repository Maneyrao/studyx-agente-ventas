import { describe, expect, it } from 'vitest';

import {
  extractAuthorizedContextV1,
  extractFinalBackendDecisionErrorV1,
  extractContextEvidenceV1,
  extractModelAttemptsV1,
  normalizePromotionStatusV1,
} from './runner-support';

describe('golden live runner evidence extraction', () => {
  it('keeps rejected and repaired model attempts instead of hiding the first proposal', () => {
    const exchanges = [
      {
        boundary: 'deepseek' as const,
        status: 200,
        error: null,
        requestBody: { instructions: '<authorized_context>{"turn_rejection":null}</authorized_context>' },
        responseBody: { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          move: { move: 'ask_payment_options', secondary_moves: [] },
          response: { messages: ['Primera respuesta'], call_offer: null },
          proposed_action: { type: 'offer_course_bonus', bonus_offering_code: 'ingles_1' },
        }) }] }] },
      },
      {
        boundary: 'deepseek' as const,
        status: 200,
        error: null,
        requestBody: { instructions: '<authorized_context>{"turn_rejection":{"rejection_id":"rej-1","reason":"bonus_not_allowed"}}</authorized_context>' },
        responseBody: { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          move: { move: 'ask_course_information', secondary_moves: ['unknown'] },
          response: { messages: ['Respuesta reparada'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: ['offering:foto:summary:v1'],
        }) }] }] },
      },
    ];

    const attempts = extractModelAttemptsV1(exchanges);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      response: 'Primera respuesta',
      move: 'ask_payment_options',
      proposedAction: { type: 'offer_course_bonus', bonus_offering_code: 'ingles_1' },
      turnRejection: null,
    });
    expect(attempts[1]).toMatchObject({
      response: 'Respuesta reparada',
      move: 'ask_course_information',
      turnRejection: { rejection_id: 'rej-1', reason: 'bonus_not_allowed' },
    });
  });

  it('extracts the exact authorized context and maps attached promotions to accepted', () => {
    expect(extractAuthorizedContextV1({
      instructions: 'before<authorized_context>{"commercial_state":{"stage":"qualified"}}</authorized_context>after',
    })).toEqual({ commercial_state: { stage: 'qualified' } });
    expect(normalizePromotionStatusV1('attached')).toBe('accepted');
    expect(normalizePromotionStatusV1('offered')).toBe('offer_available');
    expect(normalizePromotionStatusV1(null)).toBeNull();
  });

  it('keeps every authorized fact while exposing syllabus facts as a separate subset', () => {
    const evidence = extractContextEvidenceV1([{
      boundary: 'deepseek', status: 200, error: null, responseBody: {},
      requestBody: { instructions: `<authorized_context>${JSON.stringify({
        catalog: { selected_offering: { facts: [
          { fact_id: 'offering:foto:duration:v1', kind: 'duration', value: '41 clases' },
          { fact_id: 'offering:foto:syllabus:v1', kind: 'syllabus', value: 'Cámara y edición' },
        ] } },
      })}</authorized_context>` },
    }]);
    expect(evidence.authorizedFacts.map((fact) => fact.id)).toEqual([
      'offering:foto:duration:v1', 'offering:foto:syllabus:v1',
    ]);
    expect(evidence.selectedOfferingFacts.map((fact) => fact.id)).toEqual([
      'offering:foto:syllabus:v1',
    ]);
  });

  it('records the effective course-bonus preconditions exposed to the real model', () => {
    const evidence = extractContextEvidenceV1([{
      boundary: 'deepseek', status: 200, error: null, responseBody: {},
      requestBody: { instructions: `<authorized_context>${JSON.stringify({
        capabilities: { course_bonus: {
          enabled: true,
          max_bonus_courses: 3,
          may_offer_bonus: true,
          status: 'checkin_available',
        } },
      })}</authorized_context>` },
    }]);

    expect(evidence.courseBonus).toEqual({
      enabled: true,
      maxBonusCourses: 3,
      mayOfferBonus: true,
      status: 'checkin_available',
    });
  });

  it('distinguishes a repaired decision rejection from the final backend failure', () => {
    const rejected = {
      boundary: 'backend' as const, status: 422, error: null, requestBody: {},
      url: 'http://127.0.0.1:3217/api/agent/turns/turn-1/decision',
      responseBody: { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED' },
    };
    const repaired = {
      ...rejected, status: 200,
      responseBody: { status: 'committed' },
    };

    expect(extractFinalBackendDecisionErrorV1([rejected]))
      .toBe('AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED');
    expect(extractFinalBackendDecisionErrorV1([rejected, repaired])).toBeNull();
  });
});
