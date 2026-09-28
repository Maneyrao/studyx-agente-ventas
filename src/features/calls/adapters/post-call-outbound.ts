import type postgres from 'postgres';
import {
  loadBotpressManagedMessagingConfig,
  loadMessagingChannelsConfig,
} from '@/lib/config';
import { sendOutboundMessage } from '@/features/messaging/application/send-outbound-message';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { AuthorizedEgressContentAuthorizer } from '@/features/messaging/adapters/authorized-egress-content-authorizer';
import { WhatsAppCloudChannel } from '@/features/messaging/adapters/whatsapp-cloud.channel';
import { TelegramMessageChannel } from '@/features/messaging/adapters/telegram-message.channel';
import { TelegramBotApiClient } from './telegram-bot-api.client';
import { BotpressManagedChannel } from '@/features/messaging/adapters/botpress-managed.channel';
import { PostCallBotpressIdentityStore } from './post-call-botpress-identity-store';
import type { MessageChannel, MessagingChannelName } from '@/features/messaging/ports/message-channel';
import type { PostCallFollowupDependencies } from '../application/post-call-followup';

export function createPostCallOutboundSender(
  db: postgres.Sql,
): PostCallFollowupDependencies['sendOutbound'] {
  const botpress = loadBotpressManagedMessagingConfig();
  // Botpress owns these channel connections. When that route is configured,
  // stale or partial direct-provider credentials must not be loaded first and
  // prevent an otherwise healthy post-call continuation from starting.
  const messaging = botpress ? null : loadMessagingChannelsConfig();
  const channels: Partial<Record<MessagingChannelName, MessageChannel>> = {};
  const identities = botpress
    ? new PostCallBotpressIdentityStore(db)
    : new PostgresChannelIdentityStore(db);

  if (botpress) {
    const managed = {
      apiUrl: botpress.apiUrl,
      token: botpress.token,
      botId: botpress.botId,
      timeoutMs: botpress.requestTimeoutMs,
    };
    channels.whatsapp = new BotpressManagedChannel(managed, 'whatsapp');
    channels.telegram = new BotpressManagedChannel(managed, 'telegram');
  } else if (messaging?.whatsapp) {
    channels.whatsapp = new WhatsAppCloudChannel({
      ...messaging.whatsapp,
      timeoutMs: messaging.whatsapp.requestTimeoutMs,
    });
  }
  if (!botpress && messaging?.telegram) {
    channels.telegram = new TelegramMessageChannel(
      new TelegramBotApiClient({
        token: messaging.telegram.botToken,
        timeoutMs: messaging.telegram.requestTimeoutMs,
      }),
      messaging.telegram.integrationId,
    );
  }

  return (input) => sendOutboundMessage(input, {
    identities,
    channels,
    preferenceOrder: messaging?.channelPreference ?? ['whatsapp', 'telegram'],
    contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
    sideEffectAuthorizer: {
      authorize: async () => ({ allowed: true as const, reason: null }),
    },
    db,
  });
}
