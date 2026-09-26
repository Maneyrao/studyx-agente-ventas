import type postgres from 'postgres';
import { loadMessagingChannelsConfig } from '@/lib/config';
import { sendOutboundMessage } from '@/features/messaging/application/send-outbound-message';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { AuthorizedEgressContentAuthorizer } from '@/features/messaging/adapters/authorized-egress-content-authorizer';
import { WhatsAppCloudChannel } from '@/features/messaging/adapters/whatsapp-cloud.channel';
import { TelegramMessageChannel } from '@/features/messaging/adapters/telegram-message.channel';
import { TelegramBotApiClient } from './telegram-bot-api.client';
import type { MessageChannel, MessagingChannelName } from '@/features/messaging/ports/message-channel';
import type { PostCallFollowupDependencies } from '../application/post-call-followup';

export function createPostCallOutboundSender(
  db: postgres.Sql,
): PostCallFollowupDependencies['sendOutbound'] {
  const messaging = loadMessagingChannelsConfig();
  const channels: Partial<Record<MessagingChannelName, MessageChannel>> = {};

  if (messaging.whatsapp) {
    channels.whatsapp = new WhatsAppCloudChannel({
      ...messaging.whatsapp,
      timeoutMs: messaging.whatsapp.requestTimeoutMs,
    });
  }
  if (messaging.telegram) {
    channels.telegram = new TelegramMessageChannel(
      new TelegramBotApiClient({
        token: messaging.telegram.botToken,
        timeoutMs: messaging.telegram.requestTimeoutMs,
      }),
      messaging.telegram.integrationId,
    );
  }

  const identities = new PostgresChannelIdentityStore(db);
  return (input) => sendOutboundMessage(input, {
    identities,
    channels,
    preferenceOrder: messaging.channelPreference,
    contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
    sideEffectAuthorizer: {
      authorize: async () => ({ allowed: true as const, reason: null }),
    },
    db,
  });
}
