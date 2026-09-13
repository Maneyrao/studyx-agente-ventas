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
import { TelegramMessageChannel } from '@/features/messaging/adapters/telegram-message.channel';
import { TelegramBotApiClient } from '@/features/calls/adapters/telegram-bot-api.client';
import type { MessageChannel, MessagingChannelName } from '@/features/messaging/ports/message-channel';
import { constantTimeSecretEqual } from '@/lib/security/shared-secret';

function misconfigured(status = 500): Response {
  return Response.json(
    { ok: false, error: { code: 'TOOL_MISCONFIGURED' } },
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
    const { sendOutboundMessage } = await import('@/features/messaging/application/send-outbound-message');
    const { PostgresChannelIdentityStore } = await import('@/features/messaging/adapters/postgres-channel-identity-store');
    const callStore = new calls.PostgresCallStore(database.sql);
    let sendOutbound: RetellOutboundSender | undefined;
    try {
      const messaging = loadMessagingChannelsConfig();
      const channels: Partial<Record<MessagingChannelName, MessageChannel>> = {};
      const whatsapp = messaging.whatsapp
        ? new WhatsAppCloudChannel({ ...messaging.whatsapp, timeoutMs: messaging.whatsapp.requestTimeoutMs })
        : null;
      if (whatsapp) channels.whatsapp = whatsapp;
      const telegram = messaging.telegram
        ? new TelegramMessageChannel(
            new TelegramBotApiClient({
              token: messaging.telegram.botToken,
              timeoutMs: messaging.telegram.requestTimeoutMs,
            }),
            messaging.telegram.integrationId,
          )
        : null;
      if (telegram) channels.telegram = telegram;
      if (Object.keys(channels).length > 0) {
        const identities = new PostgresChannelIdentityStore(database.sql);
        sendOutbound = (input) => sendOutboundMessage(input, {
          identities,
          channels,
          preferenceOrder: messaging.channelPreference,
          contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
          // The authenticated tool authorizes this operation. Tenant,
          // conversation, opt-out and sandbox policy still run immediately
          // before the selected channel is contacted.
          sideEffectAuthorizer: { authorize: async () => ({ allowed: true as const, reason: null }) },
          db: database.sql,
        });
      }
    } catch {
      sendOutbound = undefined;
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
      { ok: false, error: { code: 'TOOL_UNAVAILABLE' } },
      { status: 200 },
    );
  }
}
