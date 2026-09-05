import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCourseInformationToolV1 } from '@/features/conversation/application/agent-tools-read';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

const codeSchema = z.string().trim().min(1).max(128).regex(/^[a-z0-9_-]+$/iu);

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const parsed = codeSchema.safeParse((await context.params).code);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_COURSE_CODE' }, { status: 400 });
  }

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch {
    return NextResponse.json({
      tool: 'get_course_information',
      success: false,
      canonical_data: null,
      error_code: 'CATALOG_UNAVAILABLE',
      recoverable: true,
      idempotency_result: 'not_applicable',
      preparation_id: null,
    });
  }

  const result = await getCourseInformationToolV1(
    { store: businessContextStore, workspaceSlug },
    { code: parsed.data },
  );
  return NextResponse.json(result);
}
