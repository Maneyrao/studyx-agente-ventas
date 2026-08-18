import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { verifyTelegramContext } from '@/features/calls/application/verify-telegram-context';
import { handleTelegramWebhook } from '@/features/calls/application/telegram-webhook';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { TelegramSimVoiceProvider, telegramProviderCallId } from '@/features/calls/adapters/telegram-sim-voice.provider';
import type { TelegramSendMessageInput } from '@/features/calls/adapters/telegram-bot-api.client';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

/**
 * Crea el mismo fixture (contacto sandbox + conversación + call_sessions
 * 'requested') que el resto de este archivo, parametrizado por callId/userId/
 * chatId/nonce para poder correr varias veces sin colisionar.
 */
async function seedRequestedCall(input: { callId: string; userId: string; chatId: string }) {
  const phone = `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`;
  const contacts = await db!<Array<{ id: string }>>`INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id`;
  await db!`INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone) VALUES ('telegram_sandbox', ${input.userId}, ${contacts[0].id}::uuid, ${phone})`;
  // `synthesize-call-result-turn.ts` exige un `channel_threads` resuelto
  // (provider + integration_id) para escribir el `channel_events` de cierre;
  // el fixture manual no pasa por la ingesta real (`ingestion.service.ts`),
  // así que hay que crearlo y enlazarlo a la conversación a mano, igual que
  // hace `persistInbound` con un mensaje real de WhatsApp.
  const threads = await db!<Array<{ id: string }>>`
    INSERT INTO channel_threads (contact_id, provider, integration_id, channel, external_conversation_id)
    VALUES (${contacts[0].id}::uuid, 'botpress', 'test-integration', 'whatsapp', ${`sandbox:${input.callId}`})
    RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, channel_thread_id) VALUES (${contacts[0].id}::uuid, 'whatsapp', ${threads[0].id}::uuid) RETURNING id
  `;
  const messages = await db!<Array<{ id: string }>>`INSERT INTO messages (conversation_id, contact_id, direction, content) VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame') RETURNING id`;
  // El cron post-llamada exige consentimiento de WhatsApp explícito (fail
  // closed sobre NULL, ver `isContactBlocked`); el fixture manual no pasa por
  // la ingesta real, así que hay que sentarlo a mano.
  await db!`
    SELECT * FROM record_contact_permission_event(
      ${'test:' + input.callId}, ${contacts[0].id}::uuid, 'whatsapp', 'granted',
      'test_setup', null, ${db!.json({ reason: 'sandbox call fixture' })}, now()
    )
  `;
  const context = { call_id: input.callId, nombre_lead: 'Ana', curso_interes: 'Python', pais: 'AR', email_lead: '', resumen_whatsapp: 'Pidió llamada inmediata.', prompt_version: 'agent-b-v1' };
  await db!`
    INSERT INTO call_sessions (id, source_turn_id, contact_id, conversation_id, provider, request_idempotency_key, status, consent_source_message_id, context_snapshot, context_hash, prompt_version)
    VALUES (${input.callId}::uuid, ${messages[0].id}::uuid, ${contacts[0].id}::uuid, ${conversations[0].id}::uuid, 'telegram_sandbox', ${`voice-call:${input.callId}`}, 'requested', ${messages[0].id}::uuid, ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1')
  `;
  const receipts = new PostgresContextReceiptStore(db!, { expectedChatId: input.chatId, expectedUserId: input.userId });
  await receipts.registerBinding({ chatId: input.chatId, userId: input.userId, startedAt: '2026-08-16T11:59:00.000Z' });
  return { contactId: contacts[0].id, conversationId: conversations[0].id, receipts };
}

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
    await expect(verifyTelegramContext(callback, { receipts, telegram })).resolves.toEqual({ status: 'recorded', verdict: 'correct', callId });
    await expect(verifyTelegramContext(callback, { receipts, telegram })).resolves.toEqual({ status: 'duplicate', verdict: 'correct', callId });
    expect(telegram.answerCallbackQuery).toHaveBeenCalledTimes(2);

    const evidence = await db!<Array<{ delivery_status: string; verdict: string; context_hash: string }>>`
      SELECT delivery_status, verdict, encode(context_hash, 'hex') AS context_hash
      FROM call_context_receipts WHERE call_id = ${callId}::uuid
    `;
    expect(evidence).toEqual([{ delivery_status: 'accepted', verdict: 'correct', context_hash: hashCallContext(context) }]);
  });

  /**
   * Spec 007 (A -> B -> A) contra la ruta HTTP real, no sólo la función de
   * aplicación: hasta esta fase, nada llamaba a `recordCallEvent` desde el
   * webhook de Telegram, así que `call_sessions.status` nunca salía de
   * 'provider_accepted' y el cron post-llamada no encontraba nada que cerrar.
   * Este test prueba el loop completo: el veredicto humano por Telegram cierra
   * la llamada en el ledger, y el cron sintetiza y encola el mensaje de cierre.
   */
  it('el veredicto humano por Telegram cierra la llamada y el cron post-llamada arma el mensaje de cierre', async () => {
    const callId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const chatId = `chat-${randomUUID()}`;
    const { conversationId, receipts } = await seedRequestedCall({ callId, userId, chatId });

    const telegram = {
      sendMessage: vi.fn(async () => ({ messageId: '77', acceptedAt: '2026-08-16T12:00:00.000Z' })),
      answerCallbackQuery: vi.fn(async () => undefined),
    };
    const nonce = `nonce_${callId.replaceAll('-', '').slice(0, 16)}`;
    const provider = new TelegramSimVoiceProvider({
      receipts, destinationResolver: receipts, telegram,
      now: () => new Date('2026-08-16T12:00:00.000Z'), nonce: () => nonce,
    });
    const store = new PostgresCallStore(db!);
    await dispatchCall({ callId, workerId: 'e2e-1' }, { store, provider });

    const secret = 'e2e-webhook-secret';
    const request = new Request('http://localhost/api/webhooks/voice/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify({
        update_id: `update-${callId}`,
        callback_query: {
          id: `cb-${callId}`,
          data: `bctx:${nonce}:ok`,
          from: { id: userId },
          message: { message_id: '77', date: 1_786_000_000, chat: { id: chatId }, from: { id: userId } },
        },
      }),
    });

    const response = await handleTelegramWebhook(request, {
      receipts, telegram, calls: store, webhookSecret: secret,
      now: () => new Date('2026-08-16T12:01:00.000Z'),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'recorded', verdict: 'correct', callId });

    const projected = await db!<Array<{ status: string; analysis_status: string; result: string | null }>>`
      SELECT status, analysis_status, result FROM call_sessions WHERE id = ${callId}::uuid
    `;
    expect(projected).toEqual([{ status: 'completed', analysis_status: 'pending', result: null }]);

    const events = await db!<Array<{ event_type: string }>>`
      SELECT event_type FROM call_events WHERE call_id = ${callId}::uuid ORDER BY sequence
    `;
    // El fixture inserta `call_sessions` directamente (no pasa por
    // `reserveCallForDecision`), así que no hay evento `requested` — sólo los
    // que agrega el cierre por veredicto.
    expect(events.map((event) => event.event_type)).toEqual(['started', 'ended']);

    // `enforce_call_session_transition` fuerza `updated_at := now()` en cada
    // UPDATE (incluida la proyección que acaba de cerrar la llamada), así que
    // no se puede adelantar el reloj a mano: se usa `grace_seconds: 0` para
    // que la ventana de gracia del cron no dependa de esperar en el test.
    const followupStore = new PostgresPostCallFollowupStore(db!);
    const sweep = await runPostCallFollowup({ trace_id: randomUUID(), grace_seconds: 0, limit: 500 }, { store: followupStore });
    expect(sweep.findings.find((finding) => finding.call_id === callId)).toMatchObject({ action: 'send' });

    const outbound = await db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count
      FROM outbound_deliveries od JOIN messages m ON m.id = od.message_id
      WHERE m.conversation_id = ${conversationId}::uuid
    `;
    expect(Number(outbound[0].count)).toBeGreaterThan(0);
  });

  /**
   * El candado anti-efectos-reales: `resolveVoiceProvider()` en
   * `request-call.ts` es un switch global por env var, no por contacto — hoy
   * en producción (sin `VOICE_PROVIDER` seteado, porque Retell no existe)
   * CUALQUIER contacto real que confirme una llamada por voz recibe
   * `call_sessions.provider = 'telegram_sandbox'`, exactamente igual que un
   * contacto de sandbox. Lo único que impide que ese contacto real reciba el
   * mensaje de Telegram del tester es el JOIN a `sandbox_identities` dentro
   * de `PostgresContextReceiptStore.resolve` (ver postgres-context-receipt-
   * store.ts). Este test prueba esa propiedad de seguridad directamente: un
   * `call_sessions` con provider telegram_sandbox pero SIN fila en
   * `sandbox_identities` no debe disparar `telegram.sendMessage` bajo ninguna
   * circunstancia, y el dispatch debe fallar de forma segura.
   */
  it('un contacto real (sin sandbox_identities) nunca dispara un mensaje de Telegram', async () => {
    const callId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const chatId = `chat-${randomUUID()}`;
    // Teléfono real (no el prefijo sintético +999 que usa sandbox_identities).
    const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const contacts = await db!<Array<{ id: string }>>`INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id`;
    // Deliberadamente SIN INSERT en sandbox_identities — este es el contacto
    // real que el candado tiene que rechazar.
    const conversations = await db!<Array<{ id: string }>>`INSERT INTO conversations (contact_id, channel) VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id`;
    const messages = await db!<Array<{ id: string }>>`INSERT INTO messages (conversation_id, contact_id, direction, content) VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame') RETURNING id`;
    const context = { call_id: callId, nombre_lead: 'Cliente Real', curso_interes: 'Python', pais: 'AR', email_lead: '', resumen_whatsapp: 'Pidió llamada inmediata.', prompt_version: 'agent-b-v1' };
    await db!`
      INSERT INTO call_sessions (id, source_turn_id, contact_id, conversation_id, provider, request_idempotency_key, status, consent_source_message_id, context_snapshot, context_hash, prompt_version)
      VALUES (${callId}::uuid, ${messages[0].id}::uuid, ${contacts[0].id}::uuid, ${conversations[0].id}::uuid, 'telegram_sandbox', ${`voice-call:${callId}`}, 'requested', ${messages[0].id}::uuid, ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1')
    `;

    // El "tester" autorizado sí tiene un binding activo — si el candado
    // fallara, este es exactamente el chat al que se filtraría el mensaje.
    const receipts = new PostgresContextReceiptStore(db!, { expectedChatId: chatId, expectedUserId: userId });
    await receipts.registerBinding({ chatId, userId, startedAt: '2026-08-16T11:59:00.000Z' });

    const telegram = {
      sendMessage: vi.fn(async () => ({ messageId: '77', acceptedAt: '2026-08-16T12:00:00.000Z' })),
      answerCallbackQuery: vi.fn(async () => undefined),
    };
    const nonce = `nonce_${callId.replaceAll('-', '').slice(0, 16)}`;
    const provider = new TelegramSimVoiceProvider({
      receipts, destinationResolver: receipts, telegram,
      now: () => new Date('2026-08-16T12:00:00.000Z'), nonce: () => nonce,
    });
    const store = new PostgresCallStore(db!);

    const result = await dispatchCall({ callId, workerId: 'security-check-1' }, { store, provider });

    // Falla seguro: nunca 'provider_accepted'. La ambigüedad es aceptable
    // (requiere revisión humana); lo inaceptable sería un mensaje enviado.
    expect(result.status).not.toBe('provider_accepted');
    expect(telegram.sendMessage).not.toHaveBeenCalled();

    const receiptRows = await db!<Array<{ id: string }>>`
      SELECT id FROM call_context_receipts WHERE call_id = ${callId}::uuid
    `;
    expect(receiptRows).toHaveLength(0);
  });
});
