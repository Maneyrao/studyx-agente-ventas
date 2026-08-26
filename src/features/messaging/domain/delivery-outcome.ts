import type { ChannelFailureKind } from '../ports/message-channel';

/**
 * Maps what a provider did to what the delivery ledger records and what the
 * caller is told. Pure: no clock, no database, no provider types.
 *
 * The single rule everything else follows: the system never claims a message
 * was sent unless a provider confirmed accepting it.
 */

/** States already present in `outbound_deliveries`. No new state is introduced. */
export type DeliveryState =
  | 'pending' | 'leased' | 'submitted' | 'delivered'
  | 'failed_retryable' | 'dead_letter' | 'cancelled';

export type SendOutcome =
  | 'sent'
  | 'rejected_by_policy'
  | 'unreachable'
  | 'retryable'
  | 'permanent';

export type ProviderResult =
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'failed'; kind: ChannelFailureKind; code: string; retryAfterSeconds?: number | null }
  | { status: 'ambiguous'; code: string };

export interface DeliveryDecision {
  /** Null means "do not settle the ledger": try the next channel instead. */
  state: DeliveryState | null;
  outcome: SendOutcome | null;
  /** Retire the channel identity: retrying it can only fail the same way. */
  retireIdentity: boolean;
  /** The provider says the free-form window is shut; correct the local guess. */
  closeWindow: boolean;
  /** Keep looking for another usable channel. */
  tryNextChannel: boolean;
  reason: string | null;
  retryAfterSeconds: number | null;
}

export function decideDeliveryOutcome(result: ProviderResult): DeliveryDecision {
  const base = {
    retireIdentity: false,
    closeWindow: false,
    tryNextChannel: false,
    reason: null as string | null,
    retryAfterSeconds: null as number | null,
  };

  if (result.status === 'accepted') {
    // `submitted`, not `delivered`. WhatsApp answers `accepted`; HTTP 200 means
    // the provider took the message, not that a device received it, and this
    // version processes no status callbacks. Claiming delivery would assert
    // something the system cannot know — and `outbound_deliveries` enforces
    // CHECK (state <> 'delivered' OR delivered_at IS NOT NULL) besides.
    return { ...base, state: 'submitted', outcome: 'sent' };
  }

  if (result.status === 'ambiguous') {
    // The send may well have arrived. Recording success would lie; recording a
    // dead letter would invite a resend that duplicates. Retryable under the
    // same idempotency key is the only honest answer — the unique constraint
    // stops the retry from producing a second message.
    return { ...base, state: 'failed_retryable', outcome: 'retryable', reason: result.code };
  }

  switch (result.kind) {
    case 'permanent':
      return {
        ...base,
        state: 'dead_letter',
        outcome: 'permanent',
        retireIdentity: true,
        reason: result.code,
      };

    case 'window_closed':
      // Not a failure — information. Meta exposes no window-state endpoint, so
      // the local window is an optimistic guess and this is the provider
      // correcting it. Settling the ledger here would record a fault where the
      // right move is simply to use another channel.
      return {
        ...base,
        state: null,
        outcome: null,
        closeWindow: true,
        tryNextChannel: true,
        reason: result.code,
      };

    case 'transient':
      return {
        ...base,
        state: 'failed_retryable',
        outcome: 'retryable',
        reason: result.code,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
      };

    case 'config_error':
      // Our deployment is broken, not the contact's identity. Retiring it would
      // punish every contact for a bad token.
      return {
        ...base,
        state: 'failed_retryable',
        outcome: 'retryable',
        reason: result.code,
      };
  }
}
