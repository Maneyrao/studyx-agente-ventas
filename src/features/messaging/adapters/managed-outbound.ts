import type { ChannelIdentityStore } from '../ports/channel-identity-store';
import type postgres from 'postgres';
import {
  loadBotpressManagedMessagingConfig,
  loadMessagingChannelsConfig,
} from '@/lib/config';
import {
  sendOutboundMessage,
  type SendOutboundMessageInput,
  type SendOutboundMessageResult,
} from '../application/send-outbound-message';
import { AuthorizedEgressContentAuthorizer } from './authorized-egress-content-authorizer';
import { BotpressManagedChannel } from './botpress-managed.channel';
import { BotpressManagedIdentityStore } from './botpress-managed-identity-store';
import { PostgresChannelIdentityStore } from './postgres-channel-identity-store';
import { WhatsAppCloudChannel } from './whatsapp-cloud.channel';
import { TelegramMessageChannel } from './telegram-message.channel';
import { TelegramBotApiClient } from '@/features/calls/adapters/telegram-bot-api.client';
import type { MessageChannel, MessagingChannelName } from '../ports/message-channel';

export type ManagedOutboundSender = (
  input: SendOutboundMessageInput,
) => Promise<SendOutboundMessageResult>;

/**
 * One route-selection boundary for every asynchronous Agent A send.
 *
 * Botpress-managed egress wins when configured because it owns the active
 * WhatsApp/Telegram OAuth connection. Direct-provider adapters remain an
 * explicit fallback for installations that do not use Botpress-managed
 * channels.
 */
export function createManagedOutboundSender(db: postgres.Sql, pinnedDestination?: string): ManagedOutboundSender {
  const botpress = loadBotpressManagedMessagingConfig();
  const messaging = botpress ? null : loadMessagingChannelsConfig();
  const channels: Partial<Record<MessagingChannelName, MessageChannel>> = {};
  const identities = botpress
    ? new BotpressManagedIdentityStore(db)
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
  } else {
    if (messaging?.whatsapp) {
      channels.whatsapp = new WhatsAppCloudChannel({
        ...messaging.whatsapp,
        timeoutMs: messaging.whatsapp.requestTimeoutMs,
      });
    }
    if (messaging?.telegram) {
      channels.telegram = new TelegramMessageChannel(
        new TelegramBotApiClient({
          token: messaging.telegram.botToken,
          timeoutMs: messaging.telegram.requestTimeoutMs,
        }),
        messaging.telegram.integrationId,
      );
    }
  }

  const routedIdentities: ChannelIdentityStore = pinnedDestination ? {
    loadEligibilityFacts: (...args) => identities.loadEligibilityFacts(...args),
    listUsableIdentities: async (...args) => (await identities.listUsableIdentities(...args))
      .filter(identity => identity.destination === pinnedDestination),
    markIdentityUnusable: (...args) => identities.markIdentityUnusable(...args),
    closeReplyWindow: (...args) => identities.closeReplyWindow(...args),
  } : identities;
  return (input) => sendOutboundMessage(input, {
    identities: routedIdentities,
    channels,
    preferenceOrder: messaging?.channelPreference ?? ['whatsapp', 'telegram'],
    contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
    sideEffectAuthorizer: {
      authorize: async ({ destination }) => pinnedDestination && destination !== pinnedDestination
        ? { allowed: false as const, reason: 'POST_SALE_WRONG_CONVERSATION' }
        : { allowed: true as const, reason: null },
    },
    db,
  });
}
