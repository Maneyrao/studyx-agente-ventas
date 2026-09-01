import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import {
  PENDING_HUMAN_REVIEWS_QUERY_V1,
  probeDerivedBacklog,
} from '@/features/observability/adapters/probes';
import { openLocalTestDatabase } from '../helpers/db';

/**
 * Cómo consulta un operador las revisiones pendientes.
 *
 * No hay bandeja monitoreada — no existe UI de operador en este repositorio.
 * Lo honesto es entregar dos superficies reales y decir con todas las letras
 * que no son una bandeja: una consulta documentada y un contador en el
 * endpoint de operaciones que ya existe.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function derivedConversation() {
  const suffix = randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '0');
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+54911${suffix}`}, 'whatsapp') RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contacts[0].id}::uuid, 'whatsapp', 'open') RETURNING id
  `;
  const turns = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'pending-review')
    RETURNING id
  `;
  return {
    contactId: contacts[0].id,
    conversationId: conversations[0].id,
    turnId: turns[0].id,
  };
}

run('las revisiones pendientes son consultables', () => {
  it('la consulta documentada devuelve la conversación derivada', async () => {
    const data = await derivedConversation();
    await new PostgresConversationStateStoreV1(db!).recordTechnicalFallbackV1({
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
      source_turn_id: data.turnId,
      consecutive_technical_fallbacks: 2,
      request_human_review: true,
    });

    const rows = await db!.unsafe(PENDING_HUMAN_REVIEWS_QUERY_V1, ['studyx']);
    const found = rows.find((row) => row.conversation_id === data.conversationId);
    expect(found).toBeDefined();
    expect(found!.human_review_requested_at).not.toBeNull();
    expect(found!.consecutive_technical_fallbacks).toBe(2);
  });

  it('la consulta no expone PII', () => {
    // Un operador necesita saber QUÉ conversación revisar, no quién es. El
    // nombre y el correo se leen abriendo la conversación, con el control de
    // acceso de esa ruta, no en un listado de operaciones.
    expect(PENDING_HUMAN_REVIEWS_QUERY_V1).not.toMatch(/\b(?:name|email|phone|contacts)\b/iu);
  });

  // `detail` viaja como JSON serializado: el endpoint lo publica tal cual.
  const pendingReviews = (probe: { detail: string | null }): number =>
    (JSON.parse(probe.detail ?? '{}') as { pending_human_reviews?: number })
      .pending_human_reviews ?? 0;

  it('el probe de backlog cuenta las revisiones pendientes', async () => {
    const beforeCount = pendingReviews(await probeDerivedBacklog(db!));

    const data = await derivedConversation();
    await new PostgresConversationStateStoreV1(db!).recordTechnicalFallbackV1({
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
      source_turn_id: data.turnId,
      consecutive_technical_fallbacks: 2,
      request_human_review: true,
    });

    expect(pendingReviews(await probeDerivedBacklog(db!))).toBe(beforeCount + 1);
  });

  it('una conversación que nunca se derivó no aparece', async () => {
    const data = await derivedConversation();
    await new PostgresConversationStateStoreV1(db!).recordTechnicalFallbackV1({
      workspace_slug: 'studyx',
      conversation_id: data.conversationId,
      contact_id: data.contactId,
      source_turn_id: data.turnId,
      consecutive_technical_fallbacks: 1,
      request_human_review: false,
    });

    const rows = await db!.unsafe(PENDING_HUMAN_REVIEWS_QUERY_V1, ['studyx']);
    expect(rows.find((row) => row.conversation_id === data.conversationId)).toBeUndefined();
  });
});
