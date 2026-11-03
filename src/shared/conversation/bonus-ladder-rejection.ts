import type { CourseBonusLadderV1 } from './bonus-ladder';

/** Factual repair metadata transported through the existing rejection subjects. */
export function courseBonusLadderRejectionSubjectsV1(ladder?: CourseBonusLadderV1): string[] {
  return [
    'forbidden_promise', 'direct_bonus:ladder_step_pending',
    ...(ladder ? ladder.missing_steps.map(step => `bonus_ladder:missing:${step}`) : ['bonus_ladder:evidence_unavailable']),
  ];
}
