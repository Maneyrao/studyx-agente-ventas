import { describe, expect, it } from 'vitest';

import {
  extractAuthorizedContextV1,
  extractCommittedProposalV1,
  proposalEvidenceV1,
  quotedCurrentPriceEvidenceV1,
  appendEarlyCallOfferEvidenceV1,
  extractFinalDeterministicRuleOutcomeV1,
  extractFinalBackendDecisionErrorV1,
  extractContextEvidenceV1,
  extractModelAttemptsV1,
  normalizePromotionStatusV1,
  deliveryAcknowledgementTargetsV1,
  reportTurnTotalsV1,
  reportTurnLabelV1,
  noVerdictReasonV1,
} from './runner-support';

describe('golden live runner evidence extraction', () => {
  it('acknowledges every distinct outbound in a multi-bubble turn', () => {
    expect(deliveryAcknowledgementTargetsV1([
      { outboundId: 'outbound-1', providerMessageId: 'provider-1' },
      { outboundId: 'outbound-2', providerMessageId: 'provider-2' },
      { outboundId: 'outbound-1', providerMessageId: 'provider-1-duplicate' },
      { outboundId: null, providerMessageId: 'provider-without-outbound' },
    ])).toEqual([
      { outboundId: 'outbound-1', providerMessageId: 'provider-1' },
      { outboundId: 'outbound-2', providerMessageId: 'provider-2' },
    ]);
  });
  it('observes the final fixed outcome correlated to the committed proposal and preserves earlier events', () => {
    const first = { event: 'studyx.turn.deterministic_rules', turn_id: 't1', trace_id: 'trace1',
      rule_a: 'not_applicable', rule_a_bonus_code: null, rule_b: 'not_applicable' };
    const last = { ...first, rule_a: 'fixed', rule_a_bonus_code: 'foto' };
    const fallback = { proposed_action: { type: 'offer_course_bonus', bonus_offering_code: 'foto' },
      response: { messages: ['Pausa', 'Curso pago más Fotografía sin costo. Avanzamos?'], call_offer: null } };
    const exchange = { boundary: 'backend' as const, url: 'http://127.0.0.1:3217/turns/t1/decision', status: 200,
      error: null, requestBody: { turn_id: 't1', trace_id: 'trace1', agent_turn_v2: { proposal: fallback } },
      responseBody: { status: 'committed', turn_id: 't1' } };
    const events = [first, last, { ...last, trace_id: 'other-trace', rule_a: 'rewrite' }];
    const original = JSON.stringify(events);
    expect(extractFinalDeterministicRuleOutcomeV1(events, [exchange])).toEqual(last);
    expect(extractCommittedProposalV1([exchange])).toEqual(fallback);
    expect(JSON.stringify(events)).toBe(original);
    expect(extractFinalDeterministicRuleOutcomeV1(events, [{ ...exchange, status: 422, responseBody: { status: 'rejected', turn_id: 't1' } }])).toBeNull();
    expect(extractFinalDeterministicRuleOutcomeV1([first], [exchange])).toBeNull();
    expect(extractFinalDeterministicRuleOutcomeV1(events, [{ ...exchange, responseBody: { status: 'committed', turn_id: 'other-turn' } }])).toBeNull();
    expect(extractFinalDeterministicRuleOutcomeV1([first, { ...last, rule_a_bonus_code: 'wrong-course' }], [exchange])).toBeNull();
  });
  it('records an early invitation only after its same-dialogue receipt, exact delivery and persisted count', () => {
    const input = { prior: [], conversationId: 'dialogue', turnId: 'turn-2', callOffer: 'Llamamos?',
      response: 'Respuesta. Llamamos?', ruleBReason: 'response_2', committed: true, persistedOfferCount: 1 };
    const proof = appendEarlyCallOfferEvidenceV1(input);
    expect(proof).toEqual([{ conversationId: 'dialogue', turnId: 'turn-2', responseOrdinal: 2,
      callOffer: 'Llamamos?', committed: true, delivered: true, persistedOfferCount: 1 }]);
    for (const override of [{ committed: false }, { persistedOfferCount: 0 }, { response: 'Sin invitación' },
      { ruleBReason: 'response_4' }, { turnId: null }]) {
      expect(appendEarlyCallOfferEvidenceV1({ ...input, ...override })).toEqual([]);
    }
    expect(appendEarlyCallOfferEvidenceV1({ ...input, prior: proof, callOffer: null, ruleBReason: 'already_offered' })).toEqual(proof);
    expect(appendEarlyCallOfferEvidenceV1({ ...input, prior: proof, conversationId: 'other', callOffer: null })).toEqual([]);
  });
  it('measures the committed fixed fallback separately from the unchanged raw model draft', () => {
    const model = { move: { move: 'unknown', secondary_moves: [] }, response: { messages: ['Modelo sin oferta'] }, proposed_action: { type: 'none' } };
    const fallback = { ...model, response: { messages: ['Pausa', 'Te sumo Fotografía sin costo'] },
      proposed_action: { type: 'offer_course_bonus', bonus_offering_code: 'foto' } };
    const exchanges = [
      { boundary: 'deepseek' as const, status: 200, error: null, requestBody: {}, responseBody: { output_text: JSON.stringify(model) } },
      { boundary: 'backend' as const, url: 'http://127.0.0.1:3217/turns/t1/decision', status: 422,
        error: null, requestBody: { agent_turn_v2: { proposal: model } }, responseBody: { status: 'rejected' } },
      { boundary: 'backend' as const, url: 'http://127.0.0.1:3217/turns/t1/decision', status: 200,
        error: null, requestBody: { agent_turn_v2: { proposal: fallback } }, responseBody: { status: 'committed' } },
    ];
    expect(extractCommittedProposalV1(exchanges)).toEqual(fallback);
    expect(proposalEvidenceV1(extractCommittedProposalV1(exchanges)).proposedAction).toEqual(fallback.proposed_action);
    expect(extractModelAttemptsV1(exchanges)[0]?.response).toBe('Modelo sin oferta');
    expect(extractCommittedProposalV1(exchanges.slice(0, 2))).toBeNull();
    expect(extractCommittedProposalV1([{ ...exchanges[2]!, responseBody: { status: 'pending' } }])).toBeNull();
  });

  it('binds rule-A interpretation evidence to literal messages in the current batch', () => {
    const context = { turn: { batch_messages: [{ text: 'Sólo el precio me frena, me parece caro.' }] } };
    const proposal = { memory_candidates: [
      { type: 'objection', key: 'price_objection', source_quote: 'me parece caro' },
      { type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'Sólo el precio me frena' },
    ] };
    expect(quotedCurrentPriceEvidenceV1(context, proposal)).toEqual({ currentPriceObjectionQuoted: true, currentPriceOnlyBarrierQuoted: true });
    expect(quotedCurrentPriceEvidenceV1(context, { memory_candidates: proposal.memory_candidates.map(candidate => ({ ...candidate, source_quote: 'inventado' })) }))
      .toEqual({ currentPriceObjectionQuoted: false, currentPriceOnlyBarrierQuoted: false });
  });
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

describe('golden results report counts every turn', () => {
  const turn = (approved: boolean | null, execution_status: 'executed' | 'not_executed' | 'evaluation_error' = 'executed') =>
    ({ turn_id: 't', approved, execution_status, failures: [] });
  it('header totals add up and approved=null is labelled with a reason, not FALLIDO', () => {
    const turns = [turn(true), turn(false), turn(null), turn(null, 'evaluation_error')];
    const totals = reportTurnTotalsV1(turns);
    expect(totals).toMatchObject({ total: 4, approved: 1, failed: 1, no_verdict: 2, evaluation_error: 1 });
    expect(totals.approved + totals.failed + totals.no_verdict).toBe(totals.total);
    expect(turns.map(reportTurnLabelV1)).toEqual(['APROBADO', 'FALLIDO', 'SIN_VEREDICTO', 'ERROR_EVALUACIÓN']);
    expect(noVerdictReasonV1({ ...turn(null), invariant_status: 'INDETERMINATE' })).toContain('invariant_status=INDETERMINATE');
  });
});
