import { describe, expect, it, vi } from 'vitest';

import {
  evaluateHardRules,
  inferFailureLayer,
  judgeCaseSemantically,
  type GoldenTurnObservationV1,
} from './judge';
import { GOLDEN_CASES } from './scenarios';

function observation(overrides: Partial<GoldenTurnObservationV1> = {}): GoldenTurnObservationV1 {
  return {
    response: 'Hola, Soy Emma, asesora de Studyx. Qué te gustaría aprender?',
    move: 'greeting', secondaryMoves: [], proposedAction: { type: 'none' },
    backendAction: 'none', backendRejections: [],
    state: { selectedCourse: null, stage: 'exploring', awaitingReply: 'none', plan: null,
      promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    deliveredLinks: [], authorizedFactIds: [], authorizedFacts: [], usedFactIds: [],
    availableOfferings: [], selectedOfferingFacts: [], modelAttempts: [],
    ...overrides,
  };
}

describe('golden hard judge', () => {
  it('passes the exact identity turn and fails a defensive administrative variant', () => {
    const turn = GOLDEN_CASES[0]!.turns[0]!;
    expect(evaluateHardRules(turn, observation()).failures).toEqual([]);
    const failed = evaluateHardRules(turn, observation({
      response: 'Soy Emma, administrativa de Studyx Academia Internacional.',
    }));
    expect(failed.failures.map((item) => item.code)).toEqual([
      'TEXT_REQUIRED_MISSING', 'TEXT_FORBIDDEN_PRESENT', 'TEXT_FORBIDDEN_PRESENT',
    ]);
  });

  it('uses persisted promotion state and actual action rather than sales copy', () => {
    const turn = GOLDEN_CASES[5]!.turns.find((item) => item.id === 'bonus_2')!;
    const failed = evaluateHardRules(turn, observation({
      response: 'Puedo sumar otro curso.',
      proposedAction: { type: 'none' },
      state: { selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 1,
          paidCourse: 'fotografia_profesional', bonusCourses: ['diseno_photoshop'] } },
    }));
    expect(failed.failures.map((item) => item.code)).toContain('ACTION_MISMATCH');
    expect(failed.failures.map((item) => item.code)).toContain('PROMOTION_BONUS_COUNT_MISMATCH');
  });

  it('attributes missing syllabus context separately from a model refusal', () => {
    const turn = GOLDEN_CASES[12]!.turns[0]!;
    expect(inferFailureLayer(turn, observation({
      response: 'No tengo el temario.', selectedOfferingFacts: [],
    }), ['SEMANTIC_MUST_FAILED'])).toBe('contexto (temarios)');
    expect(inferFailureLayer(turn, observation({
      response: 'No tengo el temario.',
      selectedOfferingFacts: [{ id: 'syllabus:photo:v1', kind: 'offering_description', value: 'Módulo 1: cámara.' }],
    }), ['SEMANTIC_MUST_FAILED'])).toBe('brain');
  });

  it('rejects a semantic verdict that duplicates one turn and omits another', async () => {
    const scenario = GOLDEN_CASES[0]!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ turns: scenario.turns.map(() => ({
        turn_id: scenario.turns[0]!.id, approved: true, failures: [],
      })) }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: scenario.turns.map(() => observation()),
    })).rejects.toThrow('GOLDEN_JUDGE_TURN_IDS_INVALID');
    fetchMock.mockRestore();
  });

  it('rejects a semantic verdict whose approved flag contradicts its failures', async () => {
    const scenario = GOLDEN_CASES[0]!;
    const firstReference = scenario.turns[0]!.authority[0]!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ turns: scenario.turns.map((turn, index) => ({
        turn_id: turn.id,
        approved: true,
        failures: index === 0 ? [{
          code: 'SEMANTIC_MUST_FAILED', requirement_index: 0,
          authority_reference: `${firstReference.file}:${firstReference.start}-${firstReference.end}`,
          explanation: 'No cumple.',
        }] : [],
      })) }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: scenario.turns.map(() => observation()),
    })).rejects.toThrow('GOLDEN_JUDGE_VERDICT_INCOHERENT');
    fetchMock.mockRestore();
  });
});
