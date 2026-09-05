import { NextResponse } from 'next/server';
import {
  getCourseInformationToolV1,
  isCanonicalCourseCodeV1,
  readToolFailureV1,
} from '@/features/conversation/application/agent-tools-read';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const code = (await context.params).code;
  if (!isCanonicalCourseCodeV1(code)) {
    return NextResponse.json(readToolFailureV1(
      'get_course_information',
      'INVALID_COURSE_CODE',
    ));
  }

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch {
    return NextResponse.json(readToolFailureV1(
      'get_course_information',
      'CATALOG_UNAVAILABLE',
    ));
  }

  const result = await getCourseInformationToolV1(
    { store: businessContextStore, workspaceSlug },
    { code },
  );
  return NextResponse.json(result);
}
