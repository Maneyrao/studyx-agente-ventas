import {
  handleRetellToolRequest,
  type RetellToolName,
} from '@/features/calls/application/retell-tools';
import {
  loadBusinessWorkspaceConfig,
  loadMessagingChannelsConfig,
  loadSheetsProjectionConfig,
} from '@/lib/config';
import {
  PostgresRetellOrchestrationStore,
  type RetellOutboundSender,
} from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { AuthorizedEgressContentAuthorizer } from '@/features/messaging/adapters/authorized-egress-content-authorizer';
import { WhatsAppCloudChannel } from '@/features/messaging/adapters/whatsapp-cloud.channel';

function misconfigured(): Response {
  return Response.json(
    { ok: false, error: { code: 'TOOL_MISCONFIGURED' } },
    { status: 500 },
  );
}

export async function handleRetellToolRoute(
  request: Request,
  expectedName: RetellToolName,
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
    const { sendOutboundMessage } = await import('@/features/messaging/application/send-outbound-message');
    const { PostgresChannelIdentityStore } = await import('@/features/messaging/adapters/postgres-channel-identity-store');
    const callStore = new calls.PostgresCallStore(database.sql);
    let sendOutbound: RetellOutboundSender | undefined;
    try {
      const messaging = loadMessagingChannelsConfig();
      const whatsapp = messaging.whatsapp
        ? new WhatsAppCloudChannel({ ...messaging.whatsapp, timeoutMs: messaging.whatsapp.requestTimeoutMs })
        : null;
      if (whatsapp) {
        const identities = new PostgresChannelIdentityStore(database.sql);
        sendOutbound = (input) => sendOutboundMessage(input, {
          identities,
          channels: { whatsapp },
          preferenceOrder: ['whatsapp'],
          contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
          sideEffectAuthorizer: { authorize: async () => ({ allowed: true as const, reason: null }) },
          db: database.sql,
        });
      }
    } catch {
      sendOutbound = undefined;
    }
    return await handleRetellToolRequest(request, expectedName, {
      apiKey,
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
      { ok: false, error: { code: 'TOOL_UNAVAILABLE' } },
      { status: 500 },
    );
  }
}
