import { describe, expect, it, vi } from 'vitest';
import { GOLDEN_CASES, validateGoldenAuthorityReferences, type GoldenTurnV1 } from './scenarios';
import { OWNER_GOLDEN_CASES, OWNER_REPLAY_CASES } from './owner-rules-scenarios';
import { OWNER_REPLAY_CUSTOMER_TURNS_V1, OWNER_REPLAY_SOURCE_V1 } from './owner-conversation-2026-11-02';
import { selectGoldenCasesV1 } from './run-config.mjs';
import { evaluateHardRules, judgeCaseSemantically, goldenPromotionDeltaV1,
  type EarlyCallOfferEvidenceV1, type GoldenTurnObservationV1 } from './judge';
import { negotiationSemanticTurnV1 } from './negotiation-evidence';
import { absoluteGoldenAcceptanceV1 } from './comparison';

const observed = (overrides: Partial<GoldenTurnObservationV1> = {}): GoldenTurnObservationV1 => ({
  response: 'Respuesta real', move: 'unknown', secondaryMoves: [], proposedAction: { type: 'none' },
  backendAction: null, backendRejections: [],
  state: { selectedCourse: null, stage: 'exploring', awaitingReply: 'none', plan: null,
    promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
  deliveredLinks: [], authorizedFactIds: [], authorizedFacts: [], usedFactIds: [],
  availableOfferings: [], selectedOfferingFacts: [], modelAttempts: [],
  workflow: { commitSucceeded: true, status: 'completed', errorCode: null, finalBackendDecisionError: null },
  ...overrides,
});
const measured = (hard: GoldenTurnV1['hard']): GoldenTurnV1 => ({
  id: 'measured', customer: 'Cliente', must: ['Medir efectos'], mustNot: ['No inventar'], authority: [],
  expected: { move: ['unknown'], action: ['none'], state: {} }, hard,
});

describe('owner-rule supplementary golden campaign', () => {
  it('preserves the exact formal 16-case/48-turn threshold independently of supplements', () => {
    expect(GOLDEN_CASES).toHaveLength(16);
    expect(GOLDEN_CASES.flatMap(scenario => scenario.turns)).toHaveLength(48);
    const formal = GOLDEN_CASES.map(scenario => ({ case_id: scenario.id, approved: true,
      turns: scenario.turns.map(turn => ({ turn_id: turn.id, approved: true })) }));
    expect(absoluteGoldenAcceptanceV1(formal)).toMatchObject({ approved: true, expected_turns: 48, minimum_passed_turns: 41 });
    const registry = [...GOLDEN_CASES, ...OWNER_GOLDEN_CASES, ...OWNER_REPLAY_CASES];
    expect(selectGoldenCasesV1('17,18', registry).map(scenario => scenario.id)).toEqual(OWNER_GOLDEN_CASES.map(scenario => scenario.id));
    expect(selectGoldenCasesV1('19', registry)).toEqual(OWNER_REPLAY_CASES);
  });

  it('cites Gabi and the precise owner exception in every new scenario', async () => {
    expect(OWNER_GOLDEN_CASES).toHaveLength(2);
    expect(OWNER_REPLAY_CASES).toHaveLength(1);
    await expect(validateGoldenAuthorityReferences([...OWNER_GOLDEN_CASES, ...OWNER_REPLAY_CASES])).resolves.toEqual([]);
    for (const scenario of [...OWNER_GOLDEN_CASES, ...OWNER_REPLAY_CASES]) {
      expect(scenario.turns.some(turn => turn.authority.some(ref => ref.file === 'docs/authority/prompt-agente-a-studyx-v2.md'))).toBe(true);
    }
  });

  it('replays only the 11 actual customer inputs with source provenance, never historical agent answers', () => {
    expect(OWNER_REPLAY_CUSTOMER_TURNS_V1).toHaveLength(11);
    expect(OWNER_REPLAY_CASES[0]!.turns.map(turn => turn.customer)).toEqual(OWNER_REPLAY_CUSTOMER_TURNS_V1.map(turn => turn.customer));
    expect(OWNER_REPLAY_SOURCE_V1.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(OWNER_REPLAY_CASES[0]!.turns[6]).toMatchObject({ expected: { action: ['offer_course_bonus'] } });
  });

  it('covers overlapping A/B and excludes negations and questions from escalation', () => {
    const scenario = OWNER_GOLDEN_CASES[1]!;
    expect(scenario.turns[1]!.hard).toContainEqual({ type: 'call_offer_recorded' });
    expect(scenario.turns[1]!.expected.action).toEqual(['offer_course_bonus']);
    // Owner second revision (2026-11-02): the promo request itself offers the first bonus.
    expect(scenario.turns[0]!.expected).toMatchObject({ action: ['offer_course_bonus'], state: { promotion: { bonusCount: [1] } } });
    for (const id of ['negated_price', 'price_question']) {
      expect(scenario.turns.find(turn => turn.id === id)?.expected).toMatchObject({ action: ['none'], state: { promotion: { bonusCount: [2] } } });
    }
  });

  it('accepts the recorded canonical current-state move only at the fourth-bonus limit check', () => {
    // Recorded real model behavior, source owner-rules-1687498-20261102T150651Z/17/no_fourth.
    // This tests evaluator compatibility, not model quality using a handwritten answer.
    const turn = OWNER_GOLDEN_CASES[0]!.turns.find(item => item.id === 'no_fourth')!;
    const response = 'Ya quedaron incluidos los tres: Fotografía con Celulares para Tiendas Online, Publicidad en Redes Sociales e Instagram para Emprendedores, junto con Introducción al Ecommerce. No hay un cuarto, pero con esos tres cubrís fotos, publicidad y redes para tu tienda.\nEl total sigue en USD 360, en 12 cuotas de USD 30 por mes. Arrancamos con ese plan?';
    const current = observed({ response, move: 'ask_current_state',
      state: { selectedCourse: 'introduccion_ecommerce', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', paidCourse: 'introduccion_ecommerce', bonusCount: 3,
          bonusCourses: ['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores'] } } });
    expect(evaluateHardRules(turn, current).failures).toEqual([]);
    expect(OWNER_GOLDEN_CASES.flatMap(scenario => scenario.turns)
      .filter(item => item.expected.move.includes('ask_current_state')).map(item => item.id)).toEqual(['no_fourth']);
    expect(evaluateHardRules(turn, { ...current, state: { ...current.state,
      promotion: { ...current.state.promotion, bonusCount: 4, bonusCourses: [...current.state.promotion.bonusCourses, 'excel_integral'] } } }).failures)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PROMOTION_LIMIT_EXCEEDED' })]));
  });

  it('requires committed delivery and persisted call evidence rather than a model invitation alone', () => {
    const turn = measured([{ type: 'workflow_committed' }, { type: 'call_offer_recorded' }]);
    const valid = observed({ callOffer: 'Coordinamos una llamada?', response: 'Respuesta\nCoordinamos una llamada?', recordedCallOfferCount: 1 });
    expect(evaluateHardRules(turn, valid).failures).toEqual([]);
    expect(evaluateHardRules(turn, { ...valid, recordedCallOfferCount: 0 }).failures[0]?.code).toBe('EARLY_CALL_OFFER_NOT_RECORDED');
    expect(evaluateHardRules(turn, { ...valid, workflow: { ...valid.workflow!, commitSucceeded: false } }).failures[0]?.code).toBe('WORKFLOW_COMMIT_FAILED');
  });

  it('accepts an earlier second/third-response invitation only with committed delivery in this dialogue', () => {
    const turn = measured([{ type: 'early_call_previously_recorded' }]);
    const source: EarlyCallOfferEvidenceV1 = { conversationId: 'same-dialogue', turnId: 'turn-2',
      responseOrdinal: 2, callOffer: 'Coordinamos una llamada?', committed: true, delivered: true, persistedOfferCount: 1 };
    const valid = observed({ conversationId: 'same-dialogue', recordedCallOfferCount: 1,
      callOffer: null, earlyCallOfferEvidence: [source] });
    expect(evaluateHardRules(turn, valid).failures).toEqual([]);
    for (const earlyCallOfferEvidence of [[], [{ ...source, conversationId: 'another-dialogue' }],
      [{ ...source, responseOrdinal: 4 }], [{ ...source, committed: false }], [{ ...source, delivered: false }],
      [{ ...source, persistedOfferCount: 0 }], [{ ...source, turnId: '' }]]) {
      expect(evaluateHardRules(turn, { ...valid, earlyCallOfferEvidence: earlyCallOfferEvidence as readonly EarlyCallOfferEvidenceV1[] }).failures[0]?.code)
        .toBe('EARLY_CALL_DELIVERY_EVIDENCE_MISSING');
    }
    expect(OWNER_GOLDEN_CASES[0]!.turns[2]!.hard).toContainEqual({ type: 'early_call_previously_recorded' });
    expect(OWNER_GOLDEN_CASES[1]!.turns[1]!.hard).toContainEqual({ type: 'call_offer_recorded' });
  });

  it('gives the semantic judge the previous delivered ledger, call receipt and exact next table course', async () => {
    const source: EarlyCallOfferEvidenceV1 = { conversationId: 'dialogue', turnId: 'turn-2', responseOrdinal: 2,
      callOffer: 'Coordinamos una llamada?', committed: true, delivered: true, persistedOfferCount: 1 };
    const prior = observed({ conversationId: 'dialogue', recordedCallOfferCount: 1,
      callOffer: source.callOffer, earlyCallOfferEvidence: [source], response: 'Con Fotografía. Coordinamos una llamada?',
      state: { selectedCourse: 'introduccion_ecommerce', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 1, paidCourse: 'introduccion_ecommerce', bonusCourses: ['fotografia_celulares_tiendas_online'] } } });
    const current = { ...prior, callOffer: null, response: 'Conservás el curso de fotografía sin costo.',
      ruleBonusBeforeTurn: { paid_offering_code: 'introduccion_ecommerce', bonus_offering_code: 'publicidad_redes_sociales', position: 2 } };
    const bodies: Array<{ input: string }> = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const payload = JSON.parse(body.input);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: { turn_id: payload.turn_id, approved: true, failures: [] } }) }));
    });
    try {
      const scenario = { ...OWNER_GOLDEN_CASES[1]!, turns: OWNER_GOLDEN_CASES[1]!.turns.slice(2, 4) };
      await judgeCaseSemantically({ apiKey: 'offline-payload-only', model: 'offline', scenario, observations: [prior, current] });
      const payload = JSON.parse(bodies[1]!.input);
      expect(payload.previous_delivery).toMatchObject({ conversation_id: 'dialogue', call_offer: source.callOffer,
        recorded_call_offer_count: 1, state: prior.state, delivery_result: { commitSucceeded: true } });
      expect(payload.early_call_offer_evidence).toEqual([source]);
      expect(payload.promotion_delta).toMatchObject({ same_paid_course: true, added_bonus_codes: [], removed_bonus_codes: [], new_bonus_effect_executed: false });
      expect(payload.actual.preconditions.rule_bonus_before_turn).toEqual(current.ruleBonusBeforeTurn);
      expect(goldenPromotionDeltaV1({ ...current, backendAction: 'offer_course_bonus', state: { ...current.state,
        promotion: { ...current.state.promotion, bonusCourses: [...current.state.promotion.bonusCourses, 'publicidad_redes_sociales'], bonusCount: 2 } } }, prior))
        .toMatchObject({ added_bonus_codes: ['publicidad_redes_sociales'], new_bonus_effect_executed: true });
    } finally { fetch.mockRestore(); }
  });

  it('does not substitute another course duration for Ecommerce facts in the current context', () => {
    const turn = measured([{ type: 'current_course_facts_present', value: 'introduccion_ecommerce' }]);
    const fact = { id: 'offering:marketing_digital:duration:v1', kind: 'duration', value: '16 clases' };
    expect(evaluateHardRules(turn, observed({ authorizedFacts: [fact] })).failures[0]?.code).toBe('CURRENT_COURSE_FACTS_MISSING');
    expect(evaluateHardRules(turn, observed({ authorizedFacts: [{ ...fact, id: 'offering:introduccion_ecommerce:duration:v1', value: '8 clases' }] })).failures).toEqual([]);
  });

  it('uses the owner override only for current rule-2 evidence and preserves historical rule-10 semantics', () => {
    const turn = GOLDEN_CASES[5]!.turns[2]!;
    const current = negotiationSemanticTurnV1(turn, true, true);
    expect(current.authority.some(ref => ref.file === 'AGENTS.md')).toBe(true);
    expect(current.must.join(' ')).toContain('sin esperar una llamada previa');
    expect(current.mustNot.join(' ')).toContain('No suprimir una regla');
    expect(negotiationSemanticTurnV1(turn, true).must.join(' ')).toContain('antes de bonificar');
  });
});
