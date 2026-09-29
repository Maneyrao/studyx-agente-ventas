import {
  handleRetellToolRequest,
  type RetellToolName,
} from '@/features/calls/application/retell-tools';
import {
  loadBusinessWorkspaceConfig,
  loadSheetsProjectionConfig,
} from '@/lib/config';
import {
  PostgresRetellOrchestrationStore,
} from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { constantTimeSecretEqual } from '@/lib/security/shared-secret';
import { logger } from '@/lib/observability/structured-log';

function misconfigured(status = 500): Response {
  return Response.json(
    {
      ok: false,
      ...(status === 200
        ? { motivo: 'La herramienta no está configurada en este momento.' }
        : {}),
      error: { code: 'TOOL_MISCONFIGURED' },
    },
    { status },
  );
}

export async function handleRetellToolRoute(
  request: Request,
  expectedName: RetellToolName,
): Promise<Response> {
  const apiKey = process.env.RETELL_API_KEY?.trim();
  const toolsSecret = process.env.RETELL_TOOLS_SECRET?.trim();
  if (!toolsSecret) return misconfigured();
  if (!constantTimeSecretEqual(request.headers.get('x-studyx-tools-secret'), toolsSecret)) {
    return Response.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const requireRetellSignature = process.env.VOICE_PROVIDER?.trim() !== 'xendra';
  if (requireRetellSignature && !apiKey) return misconfigured(200);

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch {
    return misconfigured(200);
  }

  try {
    const [database, calls, business, contacts] = await Promise.all([
      import('@/lib/db/orchestrator'),
      import('@/features/calls/adapters/postgres-call-store'),
      import('@/features/orchestration/adapters/postgres-business-context'),
      import('@/features/calls/adapters/postgres-retell-tools'),
    ]);
    const callStore = new calls.PostgresCallStore(database.sql);
    let sendOutbound;
    try {
      const outbound = await import('@/features/messaging/adapters/managed-outbound');
      sendOutbound = outbound.createManagedOutboundSender(database.sql);
    } catch (error) {
      logger.error({
        event: 'retell.tools.outbound_unavailable',
        cause_class: error instanceof Error ? error.name : 'NonErrorThrow',
      });
      return Response.json({ ok: false, error: { code: 'OUTBOUND_UNAVAILABLE' } }, { status: 200 });
    }
    return await handleRetellToolRequest(request, expectedName, {
      apiKey: apiKey ?? '',
      requireRetellSignature,
      toolsSecret,
      workspaceSlug,
      calls: callStore,
      business: new business.PostgresBusinessContextStore(database.sql),
      contacts: new contacts.PostgresRetellContactToolStore(database.sql),
      sheets: loadSheetsProjectionConfig(),
      orchestration: new PostgresRetellOrchestrationStore(database.sql, { sendOutbound }),
    });
  } catch {
    return Response.json(
      {
        ok: false,
        motivo: 'No pude completar esa acción en este momento.',
        error: { code: 'TOOL_UNAVAILABLE' },
      },
      { status: 200 },
    );
  }
}
