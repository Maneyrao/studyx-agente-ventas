import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { verifyTelegramContext } from '@/features/calls/application/verify-telegram-context';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { TelegramSimVoiceProvider, telegramProviderCallId } from '@/features/calls/adapters/telegram-sim-voice.provider';
import type { TelegramSendMessageInput } from '@/features/calls/adapters/telegram-bot-api.client';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

run('Agent B Telegram smoke vertical slice', () => {
  it('delivers one preauthorized context and records one human verdict under replay', async () => {
    const callId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const chatId = `chat-${randomUUID()}`;
    const phone = `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`;
    const contacts = await db!<Array<{ id: string }>>`INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id`;
    await db!`INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone) VALUES ('telegram_sandbox', ${userId}, ${contacts[0].id}::uuid, ${phone})`;
    const conversations = await db!<Array<{ id: string }>>`INSERT INTO conversations (contact_id, channel) VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id`;
    const messages = await db!<Array<{ id: string }>>`INSERT INTO messages (conversation_id, contact_id, direction, content) VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame') RETURNING id`;
    const context = { call_id: callId, nombre_lead: 'Ana', curso_interes: 'Python', pais: 'AR', email_lead: '', resumen_whatsapp: 'Pidió llamada inmediata.', prompt_version: 'agent-b-v1' };
    await db!`
      INSERT INTO call_sessions (id, source_turn_id, contact_id, conversation_id, provider, request_idempotency_key, status, consent_source_message_id, context_snapshot, context_hash, prompt_version)
      VALUES (${callId}::uuid, ${messages[0].id}::uuid, ${contacts[0].id}::uuid, ${conversations[0].id}::uuid, 'telegram_sandbox', ${`voice-call:${callId}`}, 'requested', ${messages[0].id}::uuid, ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1')
    `;

    const receipts = new PostgresContextReceiptStore(db!, { expectedChatId: chatId, expectedUserId: userId });
    await receipts.registerBinding({ chatId, userId, startedAt: '2026-08-16T11:59:00.000Z' });
    const telegram = {
      sendMessage: vi.fn(async (input: TelegramSendMessageInput) => {
        void input;
        return { messageId: '77', acceptedAt: '2026-08-16T12:00:00.000Z' };
      }),
      answerCallbackQuery: vi.fn(async () => undefined),
    };
    const nonce = `nonce_${callId.replaceAll('-', '').slice(0, 16)}`;
    const provider = new TelegramSimVoiceProvider({
      receipts, destinationResolver: receipts, telegram,
      now: () => new Date('2026-08-16T12:00:00.000Z'), nonce: () => nonce,
    });
    const store = new PostgresCallStore(db!);

    const expectedProviderCallId = telegramProviderCallId(chatId, '77');
    await expect(dispatchCall({ callId, workerId: 'smoke-1' }, { store, provider }))
      .resolves.toEqual({ status: 'provider_accepted', providerCallId: expectedProviderCallId });
    await expect(dispatchCall({ callId, workerId: 'smoke-replay' }, { store, provider }))
      .resolves.toEqual({ status: 'provider_accepted', providerCallId: expectedProviderCallId });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][0].text).toContain('Nombre: Ana');

    const callback = { updateId: `update-${callId}`, callbackQueryId: `cb-${callId}`, callbackData: `bctx:${nonce}:ok`, chatId, userId, messageId: '77', receivedAt: '2026-08-16T12:01:00.000Z' };
    await expect(verifyTelegramContext(callback, { receipts, telegram })).resolves.toEqual({ status: 'recorded', verdict: 'correct' });
    await expect(verifyTelegramContext(callback, { receipts, telegram })).resolves.toEqual({ status: 'duplicate', verdict: 'correct' });
    expect(telegram.answerCallbackQuery).toHaveBeenCalledTimes(2);

    const evidence = await db!<Array<{ delivery_status: string; verdict: string; context_hash: string }>>`
      SELECT delivery_status, verdict, encode(context_hash, 'hex') AS context_hash
      FROM call_context_receipts WHERE call_id = ${callId}::uuid
    `;
    expect(evidence).toEqual([{ delivery_status: 'accepted', verdict: 'correct', context_hash: hashCallContext(context) }]);
  });
});
