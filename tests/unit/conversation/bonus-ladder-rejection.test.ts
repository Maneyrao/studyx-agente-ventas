import { describe, expect, it } from 'vitest';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import { courseBonusLadderRejectionSubjectsV1 } from '@/shared/conversation/bonus-ladder-rejection';

describe('course bonus ladder rejection evidence', () => {
  it('reports unavailable evidence without inventing a missing call invitation', () => {
    const subjects = courseBonusLadderRejectionSubjectsV1();
    expect(subjects).toContain('bonus_ladder:evidence_unavailable');
    expect(subjects).not.toContain('bonus_ladder:missing:call_invitation');
    expect(subjects).not.toContain('bonus_ladder:missing:recorded_price_objections');
  });

  it('reports only the missing steps present in a real ladder snapshot', () => {
    const ladder = deriveCourseBonusLadderV1({
      observed_price_objection_count: 1,
      call_invitation_status: 'not_offered',
      call_offer_count: 0,
      may_offer_call: true,
    });
    const subjects = courseBonusLadderRejectionSubjectsV1(ladder);
    expect(subjects).toContain('bonus_ladder:missing:recorded_price_objections');
    expect(subjects).not.toContain('bonus_ladder:missing:call_invitation');
  });
});
