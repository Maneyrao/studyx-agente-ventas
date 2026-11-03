import { describe, expect, it } from 'vitest';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import { courseBonusLadderRejectionSubjectsV1 } from '@/shared/conversation/bonus-ladder-rejection';

describe('course bonus permission rejection evidence', () => {
  it('reports unavailable evidence without inventing a missing step', () => {
    const subjects = courseBonusLadderRejectionSubjectsV1();
    expect(subjects).toContain('bonus_ladder:evidence_unavailable');
    expect(subjects).not.toContain('bonus_ladder:missing:price_evidence');
  });

  it('reports only the missing steps present in a real snapshot', () => {
    const subjects = courseBonusLadderRejectionSubjectsV1(deriveCourseBonusLadderV1({ price_evidence: false, retention_used: false }));
    expect(subjects).toContain('bonus_ladder:missing:price_evidence');
    expect(subjects).not.toContain('bonus_ladder:evidence_unavailable');
    expect(courseBonusLadderRejectionSubjectsV1(deriveCourseBonusLadderV1({ price_evidence: true, retention_used: false })))
      .not.toContain('bonus_ladder:missing:price_evidence');
  });
});
