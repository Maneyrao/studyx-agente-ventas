import type { CourseBonusLadderV1 } from './bonus-ladder';

/** Factual repair metadata transported through the existing rejection subjects. */
export function courseBonusLadderRejectionSubjectsV1(ladder?: CourseBonusLadderV1): string[] {
  if (!ladder) {
    return [
      'forbidden_promise',
      'direct_bonus:ladder_step_pending',
      'bonus_ladder:evidence_unavailable',
    ];
  }
  return [
    'forbidden_promise', 'direct_bonus:ladder_step_pending',
    `bonus_ladder:recorded_price_objections:${ladder.observed_price_objection_count}:required:${ladder.required_price_objection_count}`,
    `bonus_ladder:call_invitation:${ladder.call_invitation_status}`,
    ...ladder.missing_steps
      .map(step => `bonus_ladder:missing:${step}`),
  ];
}
