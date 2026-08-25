import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type { MessagingChannelName } from '../ports/message-channel';
import type {
  ChannelIdentity,
  ChannelIdentityStore,
  ContactEligibilityFacts,
} from '../ports/channel-identity-store';

/**
 * Reads identity, consent and reachability for one contact, always inside the
 * tenant boundary.
 *
 * Every query joins `workspace_contacts`. A contact resolved without that join
 * is a cross-tenant read, which is a data leak rather than a missing filter.
 */
export class PostgresChannelIdentityStore implements ChannelIdentityStore {
  constructor(private readonly db: DbClient = sql) {}

  async loadEligibilityFacts(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEligibilityFacts | null> {
    const rows = await this.db<Array<{
      contact_id: string;
      contact_status: 'prospecto' | 'cliente' | 'inactivo';
      lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
      deleted_at: string | null;
      sandbox_locked: boolean;
    }>>`
      SELECT
        c.id               AS contact_id,
        c.status           AS contact_status,
        c.lifecycle_status,
        c.deleted_at,
        EXISTS (SELECT 1 FROM sandbox_identities si WHERE si.contact_id = c.id) AS sandbox_locked
      FROM contacts AS c
      JOIN workspace_contacts AS wc
        ON wc.contact_id = c.id AND wc.workspace_id = ${workspaceId}::uuid
      WHERE c.id = ${contactId}::uuid
    `;
    const contact = rows[0];
    if (!contact) return null;

    const permissions = await this.db<Array<{
      channel: string;
      consent_status: 'unknown' | 'granted' | 'revoked';
      reply_window_expires_at: string | null;
    }>>`
      SELECT channel, consent_status, reply_window_expires_at
      FROM contact_channel_permissions
      WHERE contact_id = ${contactId}::uuid
    `;

    const consentByChannel: Record<string, 'unknown' | 'granted' | 'revoked'> = {};
    const replyWindowExpiresAt: Record<string, string | null> = {};
    for (const row of permissions) {
      consentByChannel[row.channel] = row.consent_status;
      replyWindowExpiresAt[row.channel] = row.reply_window_expires_at;
    }

    return {
      contactId: contact.contact_id,
      contact_status: contact.contact_status,
      lifecycle_status: contact.lifecycle_status,
      deleted_at: contact.deleted_at,
      consentByChannel,
      replyWindowExpiresAt,
      sandboxLocked: contact.sandbox_locked,
    };
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
        ct.channel,
        ct.provider,
        ct.integration_id,
        CASE WHEN ct.channel = 'whatsapp' THEN c.phone ELSE ct.external_conversation_id END AS destination,
        ct.last_seen_at
      FROM channel_threads AS ct
      JOIN workspace_contacts AS wc
        ON wc.contact_id = ct.contact_id AND wc.workspace_id = ${workspaceId}::uuid
      JOIN contacts AS c ON c.id = ct.contact_id
      WHERE ct.contact_id = ${contactId}::uuid
        AND ct.unusable_at IS NULL
        AND ct.channel IN ('whatsapp', 'telegram')
      ORDER BY ct.last_seen_at DESC
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
    // A logical retirement, never a delete: the row records why the contact
    // stopped being reachable, and it can be lifted if they write again.
    await this.db`
      UPDATE channel_threads AS ct
      SET unusable_at = now(), unusable_reason = ${reason}
      FROM workspace_contacts AS wc
      WHERE ct.contact_id = ${contactId}::uuid
        AND wc.contact_id = ct.contact_id
        AND wc.workspace_id = ${workspaceId}::uuid
        AND ct.channel = ${channel}
        AND ct.external_conversation_id = ${destination}
        AND ct.unusable_at IS NULL
    `;
  }

  async closeReplyWindow(
    workspaceId: string,
    contactId: string,
    channel: MessagingChannelName,
  ): Promise<void> {
    // The provider just told us the window was already shut. Our local value
    // was an optimistic guess — Meta exposes no window-state endpoint — so this
    // records the correction instead of letting the next send repeat the trip.
    await this.db`
      UPDATE contact_channel_permissions AS ccp
      SET reply_window_expires_at = now(), updated_at = now()
      FROM workspace_contacts AS wc
      WHERE ccp.contact_id = ${contactId}::uuid
        AND wc.contact_id = ccp.contact_id
        AND wc.workspace_id = ${workspaceId}::uuid
        AND ccp.channel = ${channel}
        AND (ccp.reply_window_expires_at IS NULL OR ccp.reply_window_expires_at > now())
    `;
  }
}
