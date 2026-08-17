import { createHash } from 'node:crypto';
import { decodeContextVerdictCallback, type ContextVerdict } from '../domain/context-receipt';
import type { ContextReceiptStore } from '../ports/context-receipt-store';
import type { TelegramBotClient } from '../adapters/telegram-bot-api.client';

export interface VerifyTelegramContextInput {
  updateId: string;
  callbackQueryId: string;
  callbackData: string;
  chatId: string;
  userId: string;
  messageId: string;
  receivedAt: string;
}

export type VerifyTelegramContextResult =
  | { status: 'recorded' | 'duplicate'; verdict: ContextVerdict }
  | { status: 'rejected'; code: string };

export async function verifyTelegramContext(
  input: VerifyTelegramContextInput,
  dependencies: { receipts: ContextReceiptStore; telegram: TelegramBotClient },
): Promise<VerifyTelegramContextResult> {
  let answerText = 'No se pudo verificar';
  try {
    const callback = decodeContextVerdictCallback(input.callbackData);
    if (!callback) return { status: 'rejected', code: 'CALLBACK_DATA_INVALID' };

    const nonceHash = createHash('sha256').update(callback.nonce, 'utf8').digest('hex');
    const receipt = await dependencies.receipts.findByCallback({
      nonceHash,
      telegramChatId: input.chatId,
      telegramUserId: input.userId,
      telegramMessageId: input.messageId,
    });
    if (!receipt) return { status: 'rejected', code: 'CALLBACK_NOT_AUTHORIZED' };
    if (Date.parse(input.receivedAt) > Date.parse(receipt.expiresAt)) {
      return { status: 'rejected', code: 'CALLBACK_EXPIRED' };
    }
    if (
      receipt.deliveryStatus !== 'accepted'
      || receipt.ack.status !== 'accepted'
      || receipt.ack.missing_fields.length > 0
      || receipt.ack.context_hash !== receipt.contextHash
    ) {
      return { status: 'rejected', code: 'CONTEXT_EVIDENCE_INVALID' };
    }

    const stored = await dependencies.receipts.recordVerdict({
      receiptId: receipt.id,
      verdict: callback.verdict,
      callbackQueryId: input.callbackQueryId,
      updateId: input.updateId,
      verifiedAt: input.receivedAt,
    });
    if (stored === 'conflict') return { status: 'rejected', code: 'CALLBACK_VERDICT_CONFLICT' };

    answerText = stored === 'duplicate' ? 'Ya estaba registrado' : 'Verificación registrada';
    return { status: stored, verdict: callback.verdict };
  } finally {
    await dependencies.telegram.answerCallbackQuery({
      callbackQueryId: input.callbackQueryId,
      text: answerText,
    });
  }
}
