import type { ContextLoadAckV1 } from '../domain/context-receipt';

export type ContextReceiptDeliveryStatus = 'pending' | 'accepted' | 'ambiguous' | 'failed';
export type ContextReceiptVerdict = 'correct' | 'incorrect' | null;

export interface ReserveContextReceiptInput {
  callId: string;
  idempotencyKey: string;
  contextHash: string;
  ack: ContextLoadAckV1;
  telegramChatId: string;
  telegramUserId: string;
  nonceHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface ContextReceiptRecord extends ReserveContextReceiptInput {
  id: string;
  deliveryStatus: ContextReceiptDeliveryStatus;
  telegramMessageId: string | null;
  verdict: ContextReceiptVerdict;
  verifiedAt: string | null;
}

export interface ContextReceiptStore {
  reserve(input: ReserveContextReceiptInput): Promise<{ created: boolean; receipt: ContextReceiptRecord }>;
  markAccepted(receiptId: string, telegramMessageId: string, acceptedAt?: string, latencyMs?: number): Promise<void>;
  markAmbiguous(receiptId: string, errorCode?: string): Promise<void>;
  markFailed(receiptId: string, errorCode?: string): Promise<void>;
  findByCallback(input: {
    nonceHash: string;
    telegramChatId: string;
    telegramUserId: string;
    telegramMessageId: string;
  }): Promise<ContextReceiptRecord | null>;
  recordVerdict(input: {
    receiptId: string;
    verdict: Exclude<ContextReceiptVerdict, null>;
    callbackQueryId: string;
    updateId: string;
    verifiedAt: string;
  }): Promise<'recorded' | 'duplicate' | 'conflict'>;
}

export interface TelegramSmokeDestinationResolver {
  resolve(callId: string, phoneE164: string): Promise<{ chatId: string; userId: string }>;
}

export interface TelegramSmokeBindingStore extends TelegramSmokeDestinationResolver {
  registerBinding(input: {
    chatId: string;
    userId: string;
    startedAt: string;
  }): Promise<'registered' | 'duplicate'>;
}
