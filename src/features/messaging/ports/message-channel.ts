/**
 * Outbound messaging channel.
 *
 * The port deliberately adopts the *weakest* guarantee of the providers behind
 * it: acceptance, not delivery, and no provider-side idempotency. Telegram
 * answers synchronously with a created message; WhatsApp only says "accepted".
 * Promising Telegram's stronger contract would leave the WhatsApp adapter
 * unable to implement it honestly, and an adapter that overstates its guarantee
 * is worse than one that is merely limited.
 *
 * Idempotency is NOT solved here. It belongs to the delivery ledger, which owns
 * the idempotency key and the unique constraint behind it.
 */

export type MessagingChannelName = 'telegram' | 'whatsapp';

export interface SendTextInput {
  /** Channel-native recipient: chat id for Telegram, phone number for WhatsApp. */
  destination: string;
  text: string;
  /** Provider-side traceability only; never used to deduplicate. */
  correlationId: string;
}

export interface SendTextResult {
  /**
   * Stable message identifier, unique within (provider, integration_id).
   *
   * Telegram's message_id is unique per chat, NOT globally, so its adapter must
   * compose it with the chat id — `outbound_deliveries` has a UNIQUE on
   * (provider, integration_id, provider_message_id) that two different chats
   * would otherwise collide on. WhatsApp's `wamid.` is already global.
   */
  providerMessageId: string;
  acceptedAt: string;
}

export interface MessageChannel {
  readonly channel: MessagingChannelName;
  readonly provider: string;
  readonly integrationId: string;
  /** Longest text the provider accepts. Both current providers allow 4096. */
  readonly maxTextLength: number;
  sendText(input: SendTextInput): Promise<SendTextResult>;
}

/**
 * How a failure should be acted upon — never the raw provider error.
 *
 * The use case decides on this enum alone. Provider error shapes differ
 * (Telegram classifies by error_code, WhatsApp by a numeric error.code) and
 * neither publishes a stable error-string contract, so leaking them upward
 * would scatter provider knowledge across the application layer.
 */
export type ChannelFailureKind =
  | 'permanent'      // this identity will never work again: blocked, deleted, unknown chat
  | 'transient'      // rate limited or provider fault: worth retrying
  | 'window_closed'  // WhatsApp 131047: the channel is unavailable right now
  | 'config_error';  // bad token, unregistered number: escalate, do not retry blindly

export class ConfirmedChannelError extends Error {
  readonly kind: ChannelFailureKind;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(kind: ChannelFailureKind, code: string, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'ConfirmedChannelError';
    this.kind = kind;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The send may or may not have reached the user: timeout, dropped connection,
 * unreadable response.
 *
 * This must never be collapsed into success or into a permanent failure.
 * Calling it success would state something untrue to a salesperson on a live
 * call; calling it a definitive failure would invite a resend that duplicates a
 * message the contact already received.
 */
export class AmbiguousChannelError extends Error {
  readonly code: string;

  constructor(code = 'CHANNEL_SEND_AMBIGUOUS') {
    super(code);
    this.name = 'AmbiguousChannelError';
    this.code = code;
  }
}
