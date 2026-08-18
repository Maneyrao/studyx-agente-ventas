import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ContextReceiptRecord, ContextReceiptStore } from '@/features/calls/ports/context-receipt-store';
import { verifyTelegramContext } from '@/features/calls/application/verify-telegram-context';

const nonce = 'nonce_abcdefgh';
const nonceHash = createHash('sha256').update(nonce).digest('hex');
const now = '2026-08-16T12:00:00.000Z';

const fixedCallId = randomUUID();

function receipt(): ContextReceiptRecord {
  return {
    id: randomUUID(), callId: fixedCallId, idempotencyKey: 'voice-call:test', contextHash: 'a'.repeat(64),
    ack: { schema_version: 1, event: 'context_loaded', call_id: randomUUID(), context_hash: 'a'.repeat(64), received_fields: ['call_id'], missing_fields: [], status: 'accepted', loaded_at: now },
    telegramChatId: 'chat-1', telegramUserId: 'user-1', telegramMessageId: '77', nonceHash,
    expiresAt: '2026-08-16T12:15:00.000Z', createdAt: now, deliveryStatus: 'accepted', verdict: null, verifiedAt: null,
  };
}

function harness(found: ContextReceiptRecord | null = receipt(), recordResult: 'recorded' | 'duplicate' | 'conflict' = 'recorded') {
  const receipts: ContextReceiptStore = {
    reserve: vi.fn(), markAccepted: vi.fn(), markAmbiguous: vi.fn(), markFailed: vi.fn(),
    findByCallback: vi.fn(async () => found),
    recordVerdict: vi.fn(async () => recordResult),
  };
  const telegram = { sendMessage: vi.fn(), answerCallbackQuery: vi.fn(async () => undefined) };
  return { receipts, telegram };
}

describe('verifyTelegramContext', () => {
  it('records a correct visual verdict and always closes the callback spinner', async () => {
    const { receipts, telegram } = harness();
    await expect(verifyTelegramContext({
      updateId: '900', callbackQueryId: 'cb-1', callbackData: `bctx:${nonce}:ok`,
      chatId: 'chat-1', userId: 'user-1', messageId: '77', receivedAt: now,
    }, { receipts, telegram })).resolves.toEqual({ status: 'recorded', verdict: 'correct', callId: fixedCallId });
    expect(receipts.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'correct' }));
    expect(telegram.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it('is idempotent for a duplicate callback', async () => {
    const { receipts, telegram } = harness(receipt(), 'duplicate');
    await expect(verifyTelegramContext({
      updateId: '900', callbackQueryId: 'cb-1', callbackData: `bctx:${nonce}:ok`,
      chatId: 'chat-1', userId: 'user-1', messageId: '77', receivedAt: now,
    }, { receipts, telegram })).resolves.toEqual({ status: 'duplicate', verdict: 'correct', callId: fixedCallId });
    expect(telegram.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong user', { chatId: 'chat-1', userId: 'attacker', messageId: '77', callbackData: `bctx:${nonce}:ok` }],
    ['wrong chat', { chatId: 'other-chat', userId: 'user-1', messageId: '77', callbackData: `bctx:${nonce}:ok` }],
    ['invalid nonce', { chatId: 'chat-1', userId: 'user-1', messageId: '77', callbackData: 'bctx:other_nonce:ok' }],
  ])('fails closed for %s and still answers Telegram', async (_name, override) => {
    const { receipts, telegram } = harness(null);
    await expect(verifyTelegramContext({
      updateId: '900', callbackQueryId: 'cb-1', receivedAt: now, ...override,
    }, { receipts, telegram })).resolves.toEqual({ status: 'rejected', code: 'CALLBACK_NOT_AUTHORIZED' });
    expect(receipts.recordVerdict).not.toHaveBeenCalled();
    expect(telegram.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it('rejects an expired nonce and never records the verdict', async () => {
    const expired = { ...receipt(), expiresAt: '2026-08-16T11:59:59.000Z' };
    const { receipts, telegram } = harness(expired);
    await expect(verifyTelegramContext({
      updateId: '900', callbackQueryId: 'cb-1', callbackData: `bctx:${nonce}:bad`,
      chatId: 'chat-1', userId: 'user-1', messageId: '77', receivedAt: now,
    }, { receipts, telegram })).resolves.toEqual({ status: 'rejected', code: 'CALLBACK_EXPIRED' });
    expect(receipts.recordVerdict).not.toHaveBeenCalled();
    expect(telegram.answerCallbackQuery).toHaveBeenCalledOnce();
  });
});
