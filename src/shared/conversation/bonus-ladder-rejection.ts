import type { CourseBonusLadderV1 } from './bonus-ladder';

/** Factual repair metadata transported through the existing rejection subjects. */
export function courseBonusLadderRejectionSubjectsV1(ladder?: CourseBonusLadderV1): string[] {
  return [
    'forbidden_promise', 'direct_bonus:ladder_step_pending',
    `bonus_ladder:recorded_price_objections:${ladder?.observed_price_objection_count ?? 'unknown'}:required:3`,
    `bonus_ladder:call_invitation:${ladder?.call_invitation_status ?? 'unknown'}`,
    ...(ladder?.missing_steps ?? ['recorded_price_objections', 'call_invitation'])
      .map(step => `bonus_ladder:missing:${step}`),
  ];
}
