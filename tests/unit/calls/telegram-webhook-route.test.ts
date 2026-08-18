import { randomUUID, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ContextReceiptRecord, ContextReceiptStore, TelegramSmokeBindingStore } from '@/features/calls/ports/context-receipt-store';
import type { CallStore } from '@/features/calls/ports/call-store';
import { handleTelegramWebhook } from '@/features/calls/application/telegram-webhook';

const nonce = 'nonce_abcdefgh';
const nonceHash = createHash('sha256').update(nonce).digest('hex');

function receipt(callId: string): ContextReceiptRecord {
  const now = '2026-08-16T12:00:00.000Z';
  return {
    id: randomUUID(), callId, idempotencyKey: 'voice-call:test', contextHash: 'a'.repeat(64),
    ack: { schema_version: 1, event: 'context_loaded', call_id: callId, context_hash: 'a'.repeat(64), received_fields: ['call_id'], missing_fields: [], status: 'accepted', loaded_at: now },
    telegramChatId: 'chat-1', telegramUserId: 'user-1', telegramMessageId: '77', nonceHash,
    expiresAt: '2026-08-16T12:15:00.000Z', createdAt: now, deliveryStatus: 'accepted', verdict: null, verifiedAt: null,
  };
}

function dependencies(found: ContextReceiptRecord | null = null, recordResult: 'recorded' | 'duplicate' | 'conflict' = 'recorded') {
  const receipts = {
    registerBinding: vi.fn(async () => 'registered' as const),
    resolve: vi.fn(), reserve: vi.fn(), markAccepted: vi.fn(), markAmbiguous: vi.fn(), markFailed: vi.fn(),
    findByCallback: vi.fn(async () => found), recordVerdict: vi.fn(async () => recordResult),
  } satisfies ContextReceiptStore & TelegramSmokeBindingStore;
  const telegram = { sendMessage: vi.fn(), answerCallbackQuery: vi.fn(async () => undefined) };
  const calls: CallStore = {
    claimDispatch: vi.fn(), attachProviderCall: vi.fn(), markDispatchAmbiguous: vi.fn(), markDispatchFailed: vi.fn(),
    appendEvent: vi.fn(async () => 'recorded' as const),
    recomputeProjection: vi.fn(async () => ({ status: 'completed' as const, analysisStatus: 'pending' as const, result: null })),
  };
  return { receipts, telegram, calls, webhookSecret: 'webhook-secret', now: () => new Date('2026-08-16T12:00:00.000Z') };
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

  it('closes the call ledger with started+ended when the human verdict is correct', async () => {
    const callId = randomUUID();
    const deps = dependencies(receipt(callId), 'recorded');
    const response = await handleTelegramWebhook(request({
      update_id: 3,
      callback_query: {
        id: 'cb-1', data: `bctx:${nonce}:ok`,
        from: { id: 456 },
        message: { message_id: 77, date: 1_786_000_000, chat: { id: 123 }, from: { id: 999 } },
      },
    }), deps);
    expect(response.status).toBe(200);
    expect(deps.calls.appendEvent).toHaveBeenCalledTimes(2);
    const eventTypes = (deps.calls.appendEvent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].event_type);
    expect(eventTypes).toEqual(['started', 'ended']);
    expect(deps.calls.recomputeProjection).toHaveBeenCalledWith(callId);
  });

  it('closes the call ledger with only ended (failed_to_connect) when the human verdict is incorrect', async () => {
    const callId = randomUUID();
    const deps = dependencies(receipt(callId), 'recorded');
    const response = await handleTelegramWebhook(request({
      update_id: 4,
      callback_query: {
        id: 'cb-2', data: `bctx:${nonce}:bad`,
        from: { id: 456 },
        message: { message_id: 77, date: 1_786_000_000, chat: { id: 123 }, from: { id: 999 } },
      },
    }), deps);
    expect(response.status).toBe(200);
    expect(deps.calls.appendEvent).toHaveBeenCalledTimes(1);
    expect((deps.calls.appendEvent as ReturnType<typeof vi.fn>).mock.calls[0][0].event_type).toBe('ended');
  });

  it('re-closes the ledger on a duplicate verdict (retry-safe) but not on a rejected one', async () => {
    const callId = randomUUID();
    const dupDeps = dependencies(receipt(callId), 'duplicate');
    await handleTelegramWebhook(request({
      update_id: 5,
      callback_query: {
        id: 'cb-3', data: `bctx:${nonce}:ok`,
        from: { id: 456 },
        message: { message_id: 77, date: 1_786_000_000, chat: { id: 123 }, from: { id: 999 } },
      },
    }), dupDeps);
    expect(dupDeps.calls.appendEvent).toHaveBeenCalledTimes(2);

    const rejectedDeps = dependencies(null);
    await handleTelegramWebhook(request({
      update_id: 6,
      callback_query: {
        id: 'cb-4', data: `bctx:${nonce}:ok`,
        from: { id: 456 },
        message: { message_id: 77, date: 1_786_000_000, chat: { id: 123 }, from: { id: 999 } },
      },
    }), rejectedDeps);
    expect(rejectedDeps.calls.appendEvent).not.toHaveBeenCalled();
  });
});
