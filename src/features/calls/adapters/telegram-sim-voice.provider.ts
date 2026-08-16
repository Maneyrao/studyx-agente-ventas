import { createHash } from 'node:crypto';
import { buildContextLoadAck, buildTelegramContextReceipt, encodeContextVerdictCallback } from '../domain/context-receipt';
import { hashCallContext, parseCallContext } from '../domain/call-context';
import type { ContextReceiptStore, TelegramSmokeDestinationResolver } from '../ports/context-receipt-store';
import {
  AmbiguousVoiceProviderError,
  ConfirmedVoiceProviderError,
  type PlaceVoiceCallInput,
  type VoiceProvider,
} from '../ports/voice-provider';
import { TelegramAmbiguousError, TelegramApiError, type TelegramBotClient } from './telegram-bot-api.client';

export function telegramProviderCallId(chatId: string, messageId: string): string {
  const opaqueChat = createHash('sha256').update(chatId, 'utf8').digest('hex').slice(0, 16);
  return `telegram:${opaqueChat}:${messageId}`;
}

export class TelegramSimVoiceProvider implements VoiceProvider {
  constructor(private readonly dependencies: {
    receipts: ContextReceiptStore;
    destinationResolver: TelegramSmokeDestinationResolver;
    telegram: TelegramBotClient;
    now?: () => Date;
    nonce: () => string;
  }) {}

  async placeCall(input: PlaceVoiceCallInput): Promise<{ providerCallId: string; acceptedAt: string }> {
    const startedAtMs = Date.now();
    const context = parseCallContext(input.context);
    if (context.call_id !== input.callId) {
      throw new ConfirmedVoiceProviderError('CALL_CONTEXT_ID_MISMATCH');
    }

    const now = (this.dependencies.now ?? (() => new Date()))();
    const contextHash = hashCallContext(context);
    const ack = buildContextLoadAck(context, contextHash, now.toISOString());
    if (ack.status !== 'accepted') {
      throw new ConfirmedVoiceProviderError(ack.error_code ?? 'CONTEXT_SCHEMA_INVALID');
    }

    const destination = await this.dependencies.destinationResolver.resolve(input.callId, input.phoneE164);
    const nonce = this.dependencies.nonce();
    const nonceHash = createHash('sha256').update(nonce, 'utf8').digest('hex');
    const reservation = await this.dependencies.receipts.reserve({
      callId: input.callId,
      idempotencyKey: input.idempotencyKey,
      contextHash,
      ack,
      telegramChatId: destination.chatId,
      telegramUserId: destination.userId,
      nonceHash,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1_000).toISOString(),
      createdAt: now.toISOString(),
    });

    if (!reservation.created) {
      if (reservation.receipt.deliveryStatus === 'accepted' && reservation.receipt.telegramMessageId) {
        return {
          providerCallId: telegramProviderCallId(
            reservation.receipt.telegramChatId,
            reservation.receipt.telegramMessageId,
          ),
          acceptedAt: reservation.receipt.createdAt,
        };
      }
      if (reservation.receipt.deliveryStatus === 'failed') {
        throw new ConfirmedVoiceProviderError('TELEGRAM_PREVIOUSLY_REJECTED');
      }
      throw new AmbiguousVoiceProviderError('TELEGRAM_PREVIOUS_SEND_UNCONFIRMED');
    }

    let sent: { messageId: string; acceptedAt: string };
    try {
      sent = await this.dependencies.telegram.sendMessage({
        chatId: destination.chatId,
        text: buildTelegramContextReceipt(context, ack),
        correctCallbackData: encodeContextVerdictCallback(nonce, 'correct'),
        incorrectCallbackData: encodeContextVerdictCallback(nonce, 'incorrect'),
      });
    } catch (error) {
      if (error instanceof TelegramAmbiguousError) {
        await this.dependencies.receipts.markAmbiguous(reservation.receipt.id, error.code);
        throw new AmbiguousVoiceProviderError(error.code);
      }
      const code = error instanceof TelegramApiError ? error.code : 'TELEGRAM_SEND_FAILED';
      await this.dependencies.receipts.markFailed(reservation.receipt.id, code);
      throw new ConfirmedVoiceProviderError(code);
    }

    try {
      await this.dependencies.receipts.markAccepted(
        reservation.receipt.id,
        sent.messageId,
        sent.acceptedAt,
        Math.max(0, Date.now() - startedAtMs),
      );
      return {
        providerCallId: telegramProviderCallId(destination.chatId, sent.messageId),
        acceptedAt: sent.acceptedAt,
      };
    } catch {
      // Telegram has already acknowledged the physical send. If canonical
      // persistence fails now, retrying could duplicate the receipt.
      await this.dependencies.receipts.markAmbiguous(
        reservation.receipt.id,
        'TELEGRAM_ACCEPTED_PERSISTENCE_UNCONFIRMED',
      );
      throw new AmbiguousVoiceProviderError('TELEGRAM_ACCEPTED_PERSISTENCE_UNCONFIRMED');
    }
  }

  async findCallByInternalId(): Promise<{ providerCallId: string } | null> {
    return null;
  }

  async cancelCall(): Promise<void> {
    // A Telegram receipt is not a real call and has no provider-side call to cancel.
  }
}
