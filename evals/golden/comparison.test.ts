import { describe, expect, it } from 'vitest';

import { absoluteGoldenAcceptanceV1, compareGoldenRunsV1 } from './comparison';

describe('golden run comparison', () => {
  it('does not claim a provider change when both runs used official DeepSeek', () => {
    const comparison = compareGoldenRunsV1({ baselineLabel: 'v8', candidateLabel: 'focused-pro',
      baselineProvider: 'deepseek', candidateProvider: 'deepseek', baselineCases: [], candidateCases: [] });
    expect(comparison.disclosure).toContain('mismo proveedor');
    expect(comparison.disclosure).not.toContain('cambia proveedor');
  });
  it('requires 41 of 48 turns and every critical case independently of v8', () => {
    const cases = Array.from({ length: 16 }, (_, index) => ({
      case_id: `${String(index + 1).padStart(2, '0')}_synthetic`, approved: true as boolean | null,
      turns: Array.from({ length: 3 }, (_, turn) => ({ turn_id: `${turn}`, approved: true as boolean | null })),
    }));
    for (let index = 0; index < 7; index += 1) cases[index].turns[0].approved = false;
    expect(absoluteGoldenAcceptanceV1(cases).approved).toBe(true);
    cases[7].turns[0].approved = null;
    expect(absoluteGoldenAcceptanceV1(cases).approved).toBe(false);
    cases[7].turns[0].approved = true;
    cases[11].approved = false;
    expect(absoluteGoldenAcceptanceV1(cases).approved).toBe(false);
  });
  it('compares every case and turn without implying the agent is the only changed variable', () => {
    const comparison = compareGoldenRunsV1({
      baselineLabel: 'baseline-v8',
      candidateLabel: 'acceptance-d2c836a-nim',
      baselineProvider: 'deepseek',
      candidateProvider: 'nvidia_nim',
      baselineCases: [
        { case_id: '01', approved: true, turns: [{ turn_id: 'a', approved: true }, { turn_id: 'b', approved: false }] },
        { case_id: '02', approved: false, turns: [{ turn_id: 'a', approved: false }] },
      ],
      candidateCases: [
        { case_id: '01', approved: false, turns: [{ turn_id: 'a', approved: false }, { turn_id: 'b', approved: true }] },
        { case_id: '02', approved: false, turns: [{ turn_id: 'a', approved: false }] },
      ],
    });

    expect(comparison.disclosure).toContain('proveedor');
    expect(comparison.summary).toEqual({
      cases_improved: 0,
      cases_regressed: 1,
      cases_unchanged: 1,
      turns_improved: 1,
      turns_regressed: 1,
      turns_unchanged: 1,
      turns_missing: 0,
    });
    expect(comparison.turns).toEqual([
      { case_id: '01', turn_id: 'a', baseline: true, candidate: false, change: 'regressed' },
      { case_id: '01', turn_id: 'b', baseline: false, candidate: true, change: 'improved' },
      { case_id: '02', turn_id: 'a', baseline: false, candidate: false, change: 'unchanged' },
    ]);
  });

  it('records missing turns instead of silently dropping them', () => {
    const comparison = compareGoldenRunsV1({
      baselineLabel: 'baseline-v8', candidateLabel: 'candidate',
      baselineProvider: 'deepseek', candidateProvider: 'nvidia_nim',
      baselineCases: [{ case_id: '01', approved: true, turns: [{ turn_id: 'a', approved: true }] }],
      candidateCases: [{ case_id: '01', approved: null, turns: [] }],
    });
    expect(comparison.summary.turns_missing).toBe(1);
    expect(comparison.turns[0]).toMatchObject({ change: 'missing', candidate: null });
  });
});
