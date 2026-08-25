import {
  AmbiguousChannelError,
  ConfirmedChannelError,
  type MessageChannel,
  type SendTextInput,
  type SendTextResult,
} from '../ports/message-channel';
import {
  TelegramAmbiguousError,
  TelegramApiError,
  type TelegramBotClient,
} from '@/features/calls/adapters/telegram-bot-api.client';

/** Bot API hard limit for a text message. */
const TELEGRAM_MAX_TEXT_LENGTH = 4096;

/**
 * Telegram's `message_id` is unique *per chat*, not globally, while
 * `outbound_deliveries` carries UNIQUE (provider, integration_id,
 * provider_message_id). Two different chats can legitimately be handed the same
 * number, so storing it bare would make one of those deliveries collide with an
 * unrelated one. Composing with the chat id keeps the identifier unique where
 * the constraint requires it.
 */
export function telegramProviderMessageId(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

export class TelegramMessageChannel implements MessageChannel {
  readonly channel = 'telegram' as const;
  readonly provider = 'telegram';
  readonly maxTextLength = TELEGRAM_MAX_TEXT_LENGTH;

  constructor(
    private readonly telegram: TelegramBotClient,
    readonly integrationId: string,
  ) {}

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    if (input.text.length > this.maxTextLength) {
      // Refused up front rather than silently truncated: a payment link cut in
      // half is worse than a message that never went out.
      throw new ConfirmedChannelError('config_error', 'TELEGRAM_TEXT_TOO_LONG');
    }

    try {
      const sent = await this.telegram.sendMessage({
        chatId: input.destination,
        text: input.text,
      });
      return {
        providerMessageId: telegramProviderMessageId(input.destination, sent.messageId),
        acceptedAt: sent.acceptedAt,
      };
    } catch (error) {
      // A timeout or dropped connection proves nothing about whether the user
      // got the message, so it stays ambiguous all the way up.
      if (error instanceof TelegramAmbiguousError) {
        throw new AmbiguousChannelError(error.code);
      }
      if (error instanceof TelegramApiError) {
        throw new ConfirmedChannelError(
          error.kind,
          `TELEGRAM_${error.kind.toUpperCase()}:${error.providerErrorCode ?? 'unknown'}`,
          error.retryAfterSeconds,
        );
      }
      throw new AmbiguousChannelError('TELEGRAM_SEND_AMBIGUOUS');
    }
  }
}
