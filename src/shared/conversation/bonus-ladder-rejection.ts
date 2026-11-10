/** Factual repair metadata transported through the existing rejection subjects. */
export function courseBonusLadderRejectionSubjectsV1(motiveReason?: string): string[] {
  return [
    'forbidden_promise', 'direct_bonus:ladder_step_pending',
    'bonus_ladder:missing:current_message_motive',
    ...(motiveReason ? [`bonus_motive:${motiveReason}`] : []),
  ];
}
