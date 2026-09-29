import type { DbClient } from '@/lib/db/types';
import { PostgresChannelIdentityStore } from './postgres-channel-identity-store';
import type {
  ChannelIdentity,
  ChannelIdentityStore,
  ContactEligibilityFacts,
} from '../ports/channel-identity-store';
import type { MessagingChannelName } from '../ports/message-channel';

/**
 * Resolves the durable Botpress conversation that originated the contact.
 *
 * The generic direct-provider sender keeps sandbox identities locked. A
 * Botpress-managed send may unlock only a Telegram sandbox contact that has a
 * concrete Botpress conversation of its own; it can never fall through to a
 * phone number or to another conversation.
 */
export class BotpressManagedIdentityStore implements ChannelIdentityStore {
  private readonly generic: PostgresChannelIdentityStore;

  constructor(private readonly db: DbClient) {
    this.generic = new PostgresChannelIdentityStore(db);
  }

  async loadEligibilityFacts(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEligibilityFacts | null> {
    const facts = await this.generic.loadEligibilityFacts(workspaceId, contactId);
    if (!facts?.sandboxLocked) return facts;

    const rows = await this.db<Array<{ safe_sandbox_route: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM channel_threads AS thread
        JOIN workspace_contacts AS membership
          ON membership.contact_id = thread.contact_id
         AND membership.workspace_id = ${workspaceId}::uuid
        WHERE thread.contact_id = ${contactId}::uuid
          AND thread.provider = 'telegram_sandbox'
          AND thread.channel = 'telegram'
          AND thread.unusable_at IS NULL
          AND NULLIF(thread.metadata->>'botpress_conversation_id', '') IS NOT NULL
      ) AS safe_sandbox_route
    `;
    return rows[0]?.safe_sandbox_route ? { ...facts, sandboxLocked: false } : facts;
  }

  async listUsableIdentities(
    workspaceId: string,
    contactId: string,
  ): Promise<ChannelIdentity[]> {
    const rows = await this.db<Array<{
      channel: MessagingChannelName;
      provider: string;
      integration_id: string;
      destination: string;
      last_seen_at: string;
    }>>`
      SELECT
        thread.channel,
        thread.provider,
        thread.integration_id,
        thread.metadata->>'botpress_conversation_id' AS destination,
        thread.last_seen_at
      FROM channel_threads AS thread
      JOIN workspace_contacts AS membership
        ON membership.contact_id = thread.contact_id
       AND membership.workspace_id = ${workspaceId}::uuid
      WHERE thread.contact_id = ${contactId}::uuid
        AND thread.provider IN ('botpress', 'telegram_sandbox')
        AND thread.channel IN ('whatsapp', 'telegram')
        AND thread.unusable_at IS NULL
        AND NULLIF(thread.metadata->>'botpress_conversation_id', '') IS NOT NULL
      ORDER BY thread.last_seen_at DESC
    `;
    return rows.map((row) => ({
      channel: row.channel,
      provider: row.provider,
      integrationId: row.integration_id,
      destination: row.destination,
      lastSeenAt: row.last_seen_at,
    }));
  }

  async markIdentityUnusable(
    workspaceId: string,
    contactId: string,
    channel: MessagingChannelName,
    destination: string,
    reason: string,
  ): Promise<void> {
    await this.db`
      UPDATE channel_threads AS thread
      SET unusable_at = now(), unusable_reason = ${reason}
      FROM workspace_contacts AS membership
      WHERE thread.contact_id = ${contactId}::uuid
        AND membership.contact_id = thread.contact_id
        AND membership.workspace_id = ${workspaceId}::uuid
        AND thread.channel = ${channel}
        AND thread.metadata->>'botpress_conversation_id' = ${destination}
        AND thread.unusable_at IS NULL
    `;
  }

  async closeReplyWindow(
    workspaceId: string,
    contactId: string,
    channel: MessagingChannelName,
  ): Promise<void> {
    await this.generic.closeReplyWindow(workspaceId, contactId, channel);
  }
}
