import { describe, expect, it } from 'vitest';
import { courseBonusLadderRejectionSubjectsV1 } from '@/shared/conversation/bonus-ladder-rejection';

describe('course bonus motive rejection evidence', () => {
  it('always reports the missing current-message motive and never a persisted-evidence step', () => {
    const subjects = courseBonusLadderRejectionSubjectsV1();
    expect(subjects).toEqual(['forbidden_promise', 'direct_bonus:ladder_step_pending',
      'bonus_ladder:missing:current_message_motive']);
    expect(subjects.join()).not.toContain('price_evidence');
  });

  it('carries the structural reason when the motive failed a check', () => {
    expect(courseBonusLadderRejectionSubjectsV1('motive_move_incoherent')).toContain('bonus_motive:motive_move_incoherent');
  });
});
