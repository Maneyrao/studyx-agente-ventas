import { describe, expect, it } from 'vitest';
import { loadCourseBonusFlowConfig } from '@/features/promotions/application/course-bonus-flow-config';

describe('loadCourseBonusFlowConfig', () => {
  it('keeps review mode without inventing a bonus limit by default', () => {
    expect(loadCourseBonusFlowConfig({})).toEqual({ mode: 'review', maxBonusCourses: null });
    expect(loadCourseBonusFlowConfig({ COURSE_BONUS_FLOW_MODE: 'review' }))
      .toEqual({ mode: 'review', maxBonusCourses: null });
  });

  it.each(['review', 'direct'])('accepts explicit limits 1–3 in %s mode', (mode) => {
    for (const limit of ['1', '2', '3']) {
      expect(loadCourseBonusFlowConfig({ COURSE_BONUS_FLOW_MODE: mode, COURSE_BONUS_MAX_COURSES: limit }))
        .toEqual({ mode, maxBonusCourses: Number(limit) });
    }
  });

  it.each(['', 'DIRECT', 'unknown'])('rejects invalid mode %j', (mode) => {
    expect(() => loadCourseBonusFlowConfig({ COURSE_BONUS_FLOW_MODE: mode }))
      .toThrow('COURSE_BONUS_FLOW_MODE');
  });

  it('requires an explicit limit before enabling direct mode', () => {
    expect(() => loadCourseBonusFlowConfig({ COURSE_BONUS_FLOW_MODE: 'direct' }))
      .toThrow('COURSE_BONUS_MAX_COURSES');
  });

  it.each(['', '0', '4', '-1', '1.5', '03', 'NaN', 'Infinity'])('rejects invalid limit %j in either mode', (limit) => {
    for (const mode of ['review', 'direct']) {
      expect(() => loadCourseBonusFlowConfig({ COURSE_BONUS_FLOW_MODE: mode, COURSE_BONUS_MAX_COURSES: limit }))
        .toThrow('COURSE_BONUS_MAX_COURSES');
    }
  });
});
