import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES, validateGoldenAuthorityReferences, type GoldenTurnV1 } from './scenarios';
import { OWNER_GOLDEN_CASES, OWNER_REPLAY_CASES } from './owner-rules-scenarios';
import { OWNER_REPLAY_CUSTOMER_TURNS_V1, OWNER_REPLAY_SOURCE_V1 } from './owner-conversation-2026-11-02';
import { selectGoldenCasesV1 } from './run-config.mjs';
import { evaluateHardRules, type GoldenTurnObservationV1 } from './judge';
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
    for (const id of ['negated_price', 'price_question']) {
      expect(scenario.turns.find(turn => turn.id === id)?.expected).toMatchObject({ action: ['none'], state: { promotion: { bonusCount: [1] } } });
    }
  });

  it('requires committed delivery and persisted call evidence rather than a model invitation alone', () => {
    const turn = measured([{ type: 'workflow_committed' }, { type: 'call_offer_recorded' }]);
    const valid = observed({ callOffer: 'Coordinamos una llamada?', response: 'Respuesta\nCoordinamos una llamada?', recordedCallOfferCount: 1 });
    expect(evaluateHardRules(turn, valid).failures).toEqual([]);
    expect(evaluateHardRules(turn, { ...valid, recordedCallOfferCount: 0 }).failures[0]?.code).toBe('EARLY_CALL_OFFER_NOT_RECORDED');
    expect(evaluateHardRules(turn, { ...valid, workflow: { ...valid.workflow!, commitSucceeded: false } }).failures[0]?.code).toBe('WORKFLOW_COMMIT_FAILED');
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
