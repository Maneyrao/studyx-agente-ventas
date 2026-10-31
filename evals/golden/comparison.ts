type ApprovalV1 = boolean | null;

/** User acceptance gate; independent of the reference run/provider. */
export function absoluteGoldenAcceptanceV1(cases: readonly ComparableCaseV1[]) {
  const required = ['07', '10', '11', '12', '15'];
  const turns = cases.flatMap(item => item.turns);
  const passed = turns.filter(item => item.approved === true).length;
  const critical = required.map(code => ({ code,
    approved: cases.some(item => item.case_id.startsWith(`${code}_`) && item.approved === true),
  }));
  return { approved: cases.length === 16 && turns.length === 48 && passed >= 41 && critical.every(item => item.approved),
    passed_turns: passed, expected_turns: 48, minimum_passed_turns: 41, critical_cases: critical };
}

interface ComparableTurnV1 {
  readonly turn_id: string;
  readonly approved: ApprovalV1;
}

interface ComparableCaseV1 {
  readonly case_id: string;
  readonly approved: ApprovalV1;
  readonly turns: readonly ComparableTurnV1[];
}

interface CompareGoldenRunsInputV1 {
  readonly baselineLabel: string;
  readonly candidateLabel: string;
  readonly baselineProvider: string;
  readonly candidateProvider: string;
  readonly baselineCases: readonly ComparableCaseV1[];
  readonly candidateCases: readonly ComparableCaseV1[];
}

type ChangeV1 = 'improved' | 'regressed' | 'unchanged' | 'missing';

function change(baseline: ApprovalV1 | undefined, candidate: ApprovalV1 | undefined): ChangeV1 {
  if (baseline === undefined || candidate === undefined || baseline === null || candidate === null) return 'missing';
  if (baseline === candidate) return 'unchanged';
  return candidate ? 'improved' : 'regressed';
}

export function compareGoldenRunsV1(input: CompareGoldenRunsInputV1) {
  const candidateByCase = new Map(input.candidateCases.map((item) => [item.case_id, item]));
  const cases = input.baselineCases.map((baselineCase) => {
    const candidateCase = candidateByCase.get(baselineCase.case_id);
    return {
      case_id: baselineCase.case_id,
      baseline: baselineCase.approved,
      candidate: candidateCase?.approved ?? null,
      change: change(baselineCase.approved, candidateCase?.approved),
    };
  });
  const turns = input.baselineCases.flatMap((baselineCase) => {
    const candidateCase = candidateByCase.get(baselineCase.case_id);
    const candidates = new Map(candidateCase?.turns.map((turn) => [turn.turn_id, turn]) ?? []);
    return baselineCase.turns.map((baselineTurn) => {
      const candidate = candidates.get(baselineTurn.turn_id);
      return {
        case_id: baselineCase.case_id,
        turn_id: baselineTurn.turn_id,
        baseline: baselineTurn.approved,
        candidate: candidate?.approved ?? null,
        change: change(baselineTurn.approved, candidate?.approved),
      };
    });
  });
  return {
    baseline: input.baselineLabel,
    candidate: input.candidateLabel,
    disclosure: `La comparación cambia proveedor y juez (${input.baselineProvider} → ${input.candidateProvider}); las diferencias no se atribuyen por sí solas al agente.`,
    summary: {
      cases_improved: cases.filter((item) => item.change === 'improved').length,
      cases_regressed: cases.filter((item) => item.change === 'regressed').length,
      cases_unchanged: cases.filter((item) => item.change === 'unchanged').length,
      turns_improved: turns.filter((item) => item.change === 'improved').length,
      turns_regressed: turns.filter((item) => item.change === 'regressed').length,
      turns_unchanged: turns.filter((item) => item.change === 'unchanged').length,
      turns_missing: turns.filter((item) => item.change === 'missing').length,
    },
    cases,
    turns,
  };
}
