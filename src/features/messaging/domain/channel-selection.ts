import type { ChannelIdentity } from '../ports/channel-identity-store';
import type { MessagingChannelName } from '../ports/message-channel';

/**
 * Which channels can carry a message to this contact right now, in order.
 *
 * Pure: the caller supplies the clock, so the same inputs always yield the same
 * order. A non-deterministic ordering would make a failed send impossible to
 * reproduce.
 */

export interface ChannelAvailabilityInput {
  identities: ChannelIdentity[];
  /** When each channel's free-form window closes. Absent means no window. */
  replyWindowExpiresAt: Record<string, string | null>;
  /** Channels the deployment actually has credentials for. */
  configuredChannels: MessagingChannelName[];
  /** Tenant-level fallback order, used when the caller states no preference. */
  preferenceOrder: MessagingChannelName[];
  preferredChannel?: MessagingChannelName;
  now: Date;
}

/**
 * Only WhatsApp enforces a service window: outside it, Meta rejects free-form
 * messages. Telegram has no equivalent, so a missing entry means "no window",
 * never "expired".
 */
export function isWithinReplyWindow(
  channel: MessagingChannelName,
  replyWindowExpiresAt: Record<string, string | null>,
  now: Date,
): boolean {
  if (channel !== 'whatsapp') return true;
  const expiry = replyWindowExpiresAt[channel];
  if (!expiry) return false;
  return new Date(expiry).getTime() > now.getTime();
}

/**
 * Usable identities, best first.
 *
 * An empty result means the contact is unreachable — a different thing from a
 * send that failed, and the caller must be able to tell them apart.
 */
export function selectChannels(input: ChannelAvailabilityInput): ChannelIdentity[] {
  const configured = new Set(input.configuredChannels);

  const usable = input.identities.filter((identity) =>
    configured.has(identity.channel)
    && isWithinReplyWindow(identity.channel, input.replyWindowExpiresAt, input.now));

  const rank = (identity: ChannelIdentity): number => {
    if (input.preferredChannel && identity.channel === input.preferredChannel) return -1;
    const position = input.preferenceOrder.indexOf(identity.channel);
    return position === -1 ? input.preferenceOrder.length : position;
  };

  return [...usable].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Same channel rank: the identity we saw most recently is likeliest to work.
    const byRecency = new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    if (byRecency !== 0) return byRecency;
    // Final tie-break so the order is total and reproducible.
    return a.destination.localeCompare(b.destination);
  });
}
