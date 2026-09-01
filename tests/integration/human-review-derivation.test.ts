import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { openLocalTestDatabase } from '../helpers/db';

/**
 * Derivación a revisión tras dos fallos técnicos consecutivos (§ 07).
 *
 * No es `stage = 'handoff'`. `handoff` es terminal y la conversación tiene que
 * poder seguir: una entrada nueva vuelve a intentar el modelo. Esto es una
 * marca para el equipo, no un cierre.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture() {
  const suffix = randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '0');
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+54911${suffix}`}, 'whatsapp')
    RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contacts[0].id}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;
  const turns = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'review-1'),
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'review-2'),
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'review-3'),
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'review-4')
    RETURNING id
  `;
  return {
    contactId: contacts[0].id,
    conversationId: conversations[0].id,
    turns: turns.map((turn) => turn.id),
  };
}

run('derivación a revisión humana', () => {
  it('la primera derivación queda escrita y las repeticiones no la mueven', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const base = {
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
    };

    await store.recordTechnicalFallbackV1({
      ...base,
      source_turn_id: data.turns[0],
      consecutive_technical_fallbacks: 1,
      request_human_review: false,
    });
    const first = await store.load('studyx', data.conversationId, data.contactId);
    expect(first!.consecutive_technical_fallbacks).toBe(1);
    expect(first!.human_review_requested_at).toBeNull();

    await store.recordTechnicalFallbackV1({
      ...base,
      source_turn_id: data.turns[1],
      consecutive_technical_fallbacks: 2,
      request_human_review: true,
    });
    const derived = await store.load('studyx', data.conversationId, data.contactId);
    expect(derived!.human_review_requested_at).not.toBeNull();
    expect(derived!.consecutive_technical_fallbacks).toBe(2);

    // Máximo una derivación activa por conversación: repetir no la reescribe.
    await store.recordTechnicalFallbackV1({
      ...base,
      source_turn_id: data.turns[2],
      consecutive_technical_fallbacks: 2,
      request_human_review: true,
    });
    const again = await store.load('studyx', data.conversationId, data.contactId);
    expect(again!.human_review_requested_at).toBe(derived!.human_review_requested_at);
  });

  it('un turno exitoso reinicia el contador y deja la marca en pie', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const base = {
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
    };

    await store.recordTechnicalFallbackV1({
      ...base, source_turn_id: data.turns[0],
      consecutive_technical_fallbacks: 2, request_human_review: true,
    });
    const derived = await store.load('studyx', data.conversationId, data.contactId);
    expect(derived!.human_review_requested_at).not.toBeNull();

    // Una transición normal es, por definición, un turno que salió bien.
    await store.transition({
      ...base,
      source_turn_id: data.turns[1],
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
    });

    const after = await store.load('studyx', data.conversationId, data.contactId);
    expect(after!.consecutive_technical_fallbacks).toBe(0);
    // La marca es histórica: el equipo ya fue avisado y eso no se deshace.
    expect(after!.human_review_requested_at).not.toBeNull();
  });

  it('la conversación no queda terminal: una entrada nueva puede reintentar', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    await store.recordTechnicalFallbackV1({
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
      source_turn_id: data.turns[0],
      consecutive_technical_fallbacks: 2,
      request_human_review: true,
    });
    const state = await store.load('studyx', data.conversationId, data.contactId);
    expect(state!.stage).not.toBe('handoff');
    expect(state!.stage).not.toBe('closed');
  });

  it('el fallback técnico no toca nada comercial', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const base = {
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
    };
    const offering = await db!<Array<{ code: string }>>`
      SELECT o.code FROM offerings AS o
      JOIN workspaces AS w ON w.id = o.workspace_id
      WHERE w.slug = 'studyx' AND o.status = 'active' LIMIT 1
    `;
    await store.transition({
      ...base,
      source_turn_id: data.turns[0],
      selected_offering_code: offering[0].code,
      selected_payment_plan: 'monthly_6',
      stage: 'plan_selected',
      call_preference: 'chat',
      call_offer_status: 'declined',
      call_offer_count: 1,
      awaiting_reply: 'payment_confirmation',
      payment_reported: false,
    });

    await store.recordTechnicalFallbackV1({
      ...base, source_turn_id: data.turns[1],
      consecutive_technical_fallbacks: 1, request_human_review: false,
    });

    // Un turno técnico no cambió nada comercial y no debe simular que sí.
    const state = await store.load('studyx', data.conversationId, data.contactId);
    expect(state!.selected_offering_code).toBe(offering[0].code);
    expect(state!.selected_payment_plan).toBe('monthly_6');
    expect(state!.stage).toBe('plan_selected');
    expect(state!.awaiting_reply).toBe('payment_confirmation');
    expect(state!.call_offer_count).toBe(1);
    expect(state!.consecutive_technical_fallbacks).toBe(1);
  });

  it('un aviso de pago ya registrado sobrevive a un fallback posterior', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const base = {
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
    };
    await store.transition({
      ...base,
      source_turn_id: data.turns[0],
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: true,
    });
    const reported = await store.load('studyx', data.conversationId, data.contactId);
    expect(reported!.payment_reported_at).not.toBeNull();

    await store.recordTechnicalFallbackV1({
      ...base, source_turn_id: data.turns[1],
      consecutive_technical_fallbacks: 1, request_human_review: false,
    });
    const after = await store.load('studyx', data.conversationId, data.contactId);
    expect(after!.payment_reported_at).toBe(reported!.payment_reported_at);
  });
});
