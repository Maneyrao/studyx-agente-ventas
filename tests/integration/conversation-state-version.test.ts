import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import type { DbClient } from '@/lib/db/types';
import { openLocalTestDatabase } from '../helpers/db';

const db = openLocalTestDatabase();

afterAll(async () => db.end());

async function seedConversationStateVersionFixture() {
  const suffix = randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '0');
  const [contact] = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+54911${suffix}`}, 'whatsapp')
    RETURNING id
  `;
  const [conversation] = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contact.id}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;
  const [offering] = await db!<Array<{ code: string }>>`
    SELECT offering.code
    FROM offerings AS offering
    JOIN workspaces AS workspace ON workspace.id = offering.workspace_id
    WHERE workspace.slug = 'studyx'
      AND workspace.status = 'active'
      AND offering.status = 'active'
    ORDER BY offering.code
    LIMIT 1
  `;
  const turns = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES
      (${conversation.id}::uuid, ${contact.id}::uuid, 'inbound', 'version-turn-1'),
      (${conversation.id}::uuid, ${contact.id}::uuid, 'inbound', 'version-turn-2')
    RETURNING id
  `;

  return {
    contactId: contact.id,
    conversationId: conversation.id,
    offeringCode: offering.code,
    turnIds: turns.map((turn) => turn.id),
  };
}

describe('conversation state version', () => {
  it('exposes the stored version as a number and increments it on every transition', async () => {
    const seeded = await seedConversationStateVersionFixture();
    const store = new PostgresConversationStateStoreV1(db as unknown as DbClient);

    await store.transition({
      workspace_slug: 'studyx',
      conversation_id: seeded.conversationId,
      contact_id: seeded.contactId,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
      source_turn_id: seeded.turnIds[0],
    });
    const before = await store.load('studyx', seeded.conversationId, seeded.contactId);
    expect(before).not.toBeNull();
    expect(typeof before!.version).toBe('number');

    await store.transition({
      workspace_slug: 'studyx',
      conversation_id: seeded.conversationId,
      contact_id: seeded.contactId,
      selected_offering_code: seeded.offeringCode,
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
      source_turn_id: seeded.turnIds[1],
    });

    const after = await store.load('studyx', seeded.conversationId, seeded.contactId);
    expect(after!.version).toBe(before!.version + 1);
  });
});
