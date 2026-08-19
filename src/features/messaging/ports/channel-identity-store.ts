import type { MessagingChannelName } from './message-channel';

/**
 * Everything the send path needs to know about *who* it is writing to and
 * *whether it may*, read behind the tenant boundary.
 *
 * All reads are scoped by workspace. Resolving a contact's identity without
 * that filter is a data leak, not a performance detail.
 */

/** A contact's address on one channel, as stored in `channel_threads`. */
export interface ChannelIdentity {
  channel: MessagingChannelName;
  provider: string;
  integrationId: string;
  /** chat id for Telegram, phone number for WhatsApp. */
  destination: string;
  /** Drives the deterministic preference order when the caller states none. */
  lastSeenAt: string;
}

/** Facts the eligibility gate needs. Shaped to feed `evaluateTurnPolicy`. */
export interface ContactEligibilityFacts {
  contactId: string;
  contact_status: 'prospecto' | 'cliente' | 'inactivo';
  lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  deleted_at: string | null;
  /** Consent per channel; a channel with no row is treated as `unknown`. */
  consentByChannel: Record<string, 'unknown' | 'granted' | 'revoked'>;
  /**
   * When the provider's free-form window closes, per channel.
   * Only WhatsApp enforces one; Telegram has none and reports null.
   */
  replyWindowExpiresAt: Record<string, string | null>;
  /**
   * True when the contact is a synthetic lab identity.
   *
   * Migration 20260808010001 makes this a hard lock: a row in
   * `sandbox_identities` must block real calls, charges and production
   * messages. A new send path that ignored it would silently re-open the very
   * side effect that lock exists to prevent.
   */
  sandboxLocked: boolean;
}

export interface ChannelIdentityStore {
  /** Resolves the contact within the workspace. Null when it belongs elsewhere. */
  loadEligibilityFacts(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEligibilityFacts | null>;

  /** Usable identities only: rows retired with `unusable_at` are excluded. */
  listUsableIdentities(
    workspaceId: string,
    contactId: string,
  ): Promise<ChannelIdentity[]>;

  /**
   * Retires an identity the provider permanently rejected.
   * A logical mark, never a delete: it records why the contact became
   * unreachable, and it can be lifted if they write again.
   */
  markIdentityUnusable(
    workspaceId: string,
    contactId: string,
    channel: MessagingChannelName,
    destination: string,
    reason: string,
  ): Promise<void>;

  /**
   * Closes the local service window after the provider said it was already
   * closed. Meta exposes no window-state endpoint, so the local value is an
   * optimistic guess and the provider is the authority that corrects it.
   */
  closeReplyWindow(
    workspaceId: string,
    contactId: string,
    channel: MessagingChannelName,
  ): Promise<void>;
}
