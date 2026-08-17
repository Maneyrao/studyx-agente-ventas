import { describe, expect, it, vi } from 'vitest';
import type { ContextReceiptStore, TelegramSmokeBindingStore } from '@/features/calls/ports/context-receipt-store';
import { handleTelegramWebhook } from '@/features/calls/application/telegram-webhook';

function dependencies() {
  const receipts = {
    registerBinding: vi.fn(async () => 'registered' as const),
    resolve: vi.fn(), reserve: vi.fn(), markAccepted: vi.fn(), markAmbiguous: vi.fn(), markFailed: vi.fn(),
    findByCallback: vi.fn(async () => null), recordVerdict: vi.fn(),
  } satisfies ContextReceiptStore & TelegramSmokeBindingStore;
  const telegram = { sendMessage: vi.fn(), answerCallbackQuery: vi.fn(async () => undefined) };
  return { receipts, telegram, webhookSecret: 'webhook-secret' };
}

function request(body: unknown, secret = 'webhook-secret') {
  return new Request('http://localhost/api/webhooks/voice/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(body),
  });
}

describe('Telegram Agent B webhook', () => {
  it('rejects a missing or invalid webhook secret before parsing the update', async () => {
    const deps = dependencies();
    expect((await handleTelegramWebhook(request({}, 'wrong'), deps)).status).toBe(401);
    expect(deps.receipts.registerBinding).not.toHaveBeenCalled();
  });

  it('registers an authorized /start binding idempotently', async () => {
    const deps = dependencies();
    const response = await handleTelegramWebhook(request({
      update_id: 1,
      message: { message_id: 2, date: 1_786_000_000, text: '/start smoke_nonce', chat: { id: 123 }, from: { id: 456 } },
    }), deps);
    expect(response.status).toBe(200);
    expect(deps.receipts.registerBinding).toHaveBeenCalledWith(expect.objectContaining({ chatId: '123', userId: '456' }));
  });

  it('rejects malformed callback updates without touching persistence', async () => {
    const deps = dependencies();
    const response = await handleTelegramWebhook(request({ update_id: 2, callback_query: { id: 'cb' } }), deps);
    expect(response.status).toBe(400);
    expect(deps.receipts.findByCallback).not.toHaveBeenCalled();
  });
});
