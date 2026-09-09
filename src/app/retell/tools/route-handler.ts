import {
  handleRetellToolRequest,
  type RetellP0ToolName,
} from '@/features/calls/application/retell-tools';
import {
  loadBusinessWorkspaceConfig,
  loadSheetsProjectionConfig,
} from '@/lib/config';

function misconfigured(): Response {
  return Response.json(
    { ok: false, error: { code: 'TOOL_MISCONFIGURED' } },
    { status: 500 },
  );
}

export async function handleRetellToolRoute(
  request: Request,
  expectedName: RetellP0ToolName,
): Promise<Response> {
  const apiKey = process.env.RETELL_API_KEY?.trim();
  const toolsSecret = process.env.RETELL_TOOLS_SECRET?.trim();
  if (!apiKey || !toolsSecret) return misconfigured();

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch {
    return misconfigured();
  }

  try {
    const [database, calls, business, contacts] = await Promise.all([
      import('@/lib/db/orchestrator'),
      import('@/features/calls/adapters/postgres-call-store'),
      import('@/features/orchestration/adapters/postgres-business-context'),
      import('@/features/calls/adapters/postgres-retell-tools'),
    ]);
    const callStore = new calls.PostgresCallStore(database.sql);
    return await handleRetellToolRequest(request, expectedName, {
      apiKey,
      toolsSecret,
      workspaceSlug,
      calls: callStore,
      business: new business.PostgresBusinessContextStore(database.sql),
      contacts: new contacts.PostgresRetellContactToolStore(database.sql),
      sheets: loadSheetsProjectionConfig(),
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: 'TOOL_UNAVAILABLE' } },
      { status: 500 },
    );
  }
}
