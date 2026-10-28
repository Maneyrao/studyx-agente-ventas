import type { CourseBonusFlowModeV1, CourseBonusMaxCoursesV1 } from '../domain/course-bonus';

export interface CourseBonusFlowConfigV1 {
  readonly mode: CourseBonusFlowModeV1;
  readonly maxBonusCourses: CourseBonusMaxCoursesV1 | null;
}

/** Direct offers require an explicitly authorized limit; configuration errors stop rollout. */
export function loadCourseBonusFlowConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CourseBonusFlowConfigV1 {
  const mode = environment.COURSE_BONUS_FLOW_MODE ?? 'review';
  if (mode !== 'review' && mode !== 'direct') {
    throw new Error('Invalid COURSE_BONUS_FLOW_MODE');
  }
  const limit = environment.COURSE_BONUS_MAX_COURSES;
  if (limit === undefined && mode === 'review') return { mode, maxBonusCourses: null };
  if (limit !== '1' && limit !== '2' && limit !== '3') {
    throw new Error('Invalid or missing COURSE_BONUS_MAX_COURSES');
  }
  return { mode, maxBonusCourses: Number(limit) as CourseBonusMaxCoursesV1 };
}
