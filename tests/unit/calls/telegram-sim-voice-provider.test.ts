import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hashCallContext } from '@/features/calls/domain/call-context';
import type {
  ContextReceiptRecord,
  ContextReceiptStore,
  TelegramSmokeDestinationResolver,
} from '@/features/calls/ports/context-receipt-store';
import { AmbiguousVoiceProviderError } from '@/features/calls/ports/voice-provider';
import { TelegramSimVoiceProvider, telegramProviderCallId } from '@/features/calls/adapters/telegram-sim-voice.provider';
import { TelegramAmbiguousError } from '@/features/calls/adapters/telegram-bot-api.client';

const now = '2026-08-16T12:00:00.000Z';

function context() {
  return {
    call_id: randomUUID(), nombre_lead: 'Ana', curso_interes: 'Python', pais: 'AR',
    email_lead: '', resumen_whatsapp: 'Pidió una llamada.', prompt_version: 'agent-b-v1',
  };
}

function harness(sendError?: Error, acceptPersistenceError?: Error) {
  let record: ContextReceiptRecord | null = null;
  const store: ContextReceiptStore = {
    reserve: vi.fn(async (input) => {
      if (record) return { created: false as const, receipt: record };
      const created: ContextReceiptRecord = { ...input, id: randomUUID(), deliveryStatus: 'pending' as const, telegramMessageId: null, verdict: null, verifiedAt: null };
      record = created;
      return { created: true as const, receipt: created };
    }),
    markAccepted: vi.fn(async (_id, messageId) => {
      if (acceptPersistenceError) throw acceptPersistenceError;
      record = { ...record!, deliveryStatus: 'accepted', telegramMessageId: messageId };
    }),
    markAmbiguous: vi.fn(async () => { record = { ...record!, deliveryStatus: 'ambiguous' }; }),
    markFailed: vi.fn(async () => { record = { ...record!, deliveryStatus: 'failed' }; }),
    findByCallback: vi.fn(),
    recordVerdict: vi.fn(),
  };
  const destinationResolver: TelegramSmokeDestinationResolver = {
    resolve: vi.fn(async () => ({ chatId: 'chat-1', userId: 'user-1' })),
  };
  const telegram = {
    sendMessage: vi.fn(async (input: { chatId: string; text: string; correctCallbackData: string; incorrectCallbackData: string }) => {
      void input;
      if (sendError) throw sendError;
      return { messageId: '77', acceptedAt: now };
    }),
    answerCallbackQuery: vi.fn(),
  };
  const provider = new TelegramSimVoiceProvider({
    receipts: store,
    destinationResolver,
    telegram,
    now: () => new Date(now),
    nonce: () => 'nonce_abcdefgh',
  });
  return { provider, store, telegram, getRecord: () => record };
}

describe('TelegramSimVoiceProvider', () => {
  it('persists technical load evidence before one deterministic Telegram receipt', async () => {
    const input = context();
    const { provider, store, telegram, getRecord } = harness();
    await expect(provider.placeCall({ callId: input.call_id, phoneE164: '+999000000001', context: input, idempotencyKey: `voice-call:${input.call_id}` }))
      .resolves.toMatchObject({ providerCallId: telegramProviderCallId('chat-1', '77') });
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({
      callId: input.call_id, contextHash: hashCallContext(input), ack: expect.objectContaining({ status: 'accepted' }),
    }));
    expect((store.reserve as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan(telegram.sendMessage.mock.invocationCallOrder[0]);
    expect(getRecord()).toMatchObject({ deliveryStatus: 'accepted', telegramMessageId: '77' });
  });

  it('returns the accepted provider id on replay without sending twice', async () => {
    const input = context();
    const { provider, telegram } = harness();
    const request = { callId: input.call_id, phoneE164: '+999000000001', context: input, idempotencyKey: `voice-call:${input.call_id}` };
    expect(await provider.placeCall(request)).toEqual(await provider.placeCall(request));
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('pauses an ambiguous timeout and never blindly sends again', async () => {
    const input = context();
    const { provider, telegram, store } = harness(new TelegramAmbiguousError());
    const request = { callId: input.call_id, phoneE164: '+999000000001', context: input, idempotencyKey: `voice-call:${input.call_id}` };
    await expect(provider.placeCall(request)).rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    await expect(provider.placeCall(request)).rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    expect(store.markAmbiguous).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('treats a persistence failure after Telegram acceptance as ambiguous', async () => {
    const input = context();
    const { provider, telegram, store } = harness(undefined, new Error('database unavailable'));
    await expect(provider.placeCall({
      callId: input.call_id, phoneE164: '+999000000001', context: input, idempotencyKey: `voice-call:${input.call_id}`,
    })).rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    expect(telegram.sendMessage).toHaveBeenCalledOnce();
    expect(store.markAmbiguous).toHaveBeenCalledOnce();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('does not mix two concurrent contacts or contexts', async () => {
    const first = context();
    const second = { ...context(), nombre_lead: 'Bea' };
    const firstHarness = harness();
    const secondHarness = harness();
    await Promise.all([
      firstHarness.provider.placeCall({ callId: first.call_id, phoneE164: '+999000000001', context: first, idempotencyKey: `voice-call:${first.call_id}` }),
      secondHarness.provider.placeCall({ callId: second.call_id, phoneE164: '+999000000002', context: second, idempotencyKey: `voice-call:${second.call_id}` }),
    ]);
    expect(firstHarness.telegram.sendMessage.mock.calls[0][0].text).toContain('Nombre: Ana');
    expect(secondHarness.telegram.sendMessage.mock.calls[0][0].text).toContain('Nombre: Bea');
  });
});
