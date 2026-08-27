import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

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
    VALUES
      (${contacts[0].id}::uuid, 'whatsapp', 'closed'),
      (${contacts[0].id}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;
  const offerings = await db!<Array<{ code: string }>>`
    SELECT o.code
    FROM offerings AS o
    JOIN workspaces AS w ON w.id = o.workspace_id
    WHERE w.slug = 'studyx' AND o.status = 'active'
    ORDER BY o.code
    LIMIT 2
  `;
  const turns = await db!<Array<{ id: string; conversation_id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'turn-a-1'),
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'turn-a-2'),
      (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'turn-a-3'),
      (${conversations[1].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'turn-b-1')
    RETURNING id, conversation_id
  `;
  return {
    contactId: contacts[0].id,
    conversationA: conversations[0].id,
    conversationB: conversations[1].id,
    offeringA: offerings[0].code,
    offeringB: offerings[1].code,
    turnsA: turns.filter((turn) => turn.conversation_id === conversations[0].id).map((turn) => turn.id),
    turnB: turns.find((turn) => turn.conversation_id === conversations[1].id)!.id,
  };
}

run('conversation_sales_context_states_v1', () => {
  it('isolates state between two conversations owned by the same contact', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const conversationA = await store.transition({
      workspace_slug: 'studyx',
      conversation_id: data.conversationA,
      contact_id: data.contactId,
      source_turn_id: data.turnsA[0],
      selected_offering_code: data.offeringA,
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      call_preference: 'chat',
      call_offer_status: 'declined',
      awaiting_reply: 'payment_confirmation',
    });
    const conversationB = await store.transition({
      workspace_slug: 'studyx',
      conversation_id: data.conversationB,
      contact_id: data.contactId,
      source_turn_id: data.turnB,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      awaiting_reply: 'none',
    });

    expect(conversationA).toMatchObject({
      conversation_id: data.conversationA,
      call_preference: 'chat',
      call_offer_status: 'declined',
      selected_payment_plan: 'monthly_12',
    });
    expect(conversationB).toMatchObject({
      conversation_id: data.conversationB,
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      selected_payment_plan: null,
      version: 1,
    });
    await expect(store.load('studyx', data.conversationA, data.contactId))
      .resolves.toMatchObject({ version: 1, selected_payment_plan: 'monthly_12' });
    await expect(store.load('studyx', data.conversationB, data.contactId))
      .resolves.toMatchObject({ version: 1, selected_payment_plan: null });
  });

  it('writes exact null state so changing course clears the previous plan', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    await store.transition({
      workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
      source_turn_id: data.turnsA[0], selected_offering_code: data.offeringA,
      selected_payment_plan: 'monthly_6', stage: 'plan_selected', call_preference: 'unknown',
      call_offer_status: 'not_offered', awaiting_reply: 'payment_confirmation',
    });
    const changed = await store.transition({
      workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
      source_turn_id: data.turnsA[1], selected_offering_code: data.offeringB,
      selected_payment_plan: null, stage: 'course_selected', call_preference: 'unknown',
      call_offer_status: 'not_offered', awaiting_reply: 'none',
    });

    expect(changed).toMatchObject({
      selected_offering_code: data.offeringB,
      selected_payment_plan: null,
      stage: 'course_selected',
      version: 2,
    });
  });

  it('replays a source turn without incrementing version or duplicating its event', async () => {
    const data = await fixture();
    const store = new PostgresConversationStateStoreV1(db!);
    const input = {
      workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
      source_turn_id: data.turnsA[0], selected_offering_code: data.offeringA,
      selected_payment_plan: null, stage: 'course_selected' as const, call_preference: 'unknown' as const,
      call_offer_status: 'offered' as const, awaiting_reply: 'call_or_chat' as const,
    };

    const first = await store.transition(input);
    const replay = await store.transition(input);
    expect(replay).toEqual(first);

    const events = await db!<Array<{ state_version: number }>>`
      SELECT state_version
      FROM conversation_sales_context_state_events_v1
      WHERE workspace_id = ${first.workspace_id}::uuid
        AND conversation_id = ${data.conversationA}::uuid
      ORDER BY state_version
    `;
    expect(events).toEqual([{ state_version: 1 }]);
  });

  it('serializes concurrent transitions into unique state versions', async () => {
    const data = await fixture();
    const seedStore = new PostgresConversationStateStoreV1(db!);
    await seedStore.transition({
      workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
      source_turn_id: data.turnsA[0], selected_offering_code: data.offeringA,
      selected_payment_plan: null, stage: 'course_selected', call_preference: 'unknown',
      call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
    });
    const connections = openIndependentLocalTestDatabases(2);
    try {
      const results = await Promise.all([
        new PostgresConversationStateStoreV1(connections[0]).transition({
          workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
          source_turn_id: data.turnsA[1], selected_offering_code: data.offeringA,
          selected_payment_plan: null, stage: 'course_selected', call_preference: 'chat',
          call_offer_status: 'declined', awaiting_reply: 'none',
        }),
        new PostgresConversationStateStoreV1(connections[1]).transition({
          workspace_slug: 'studyx', conversation_id: data.conversationA, contact_id: data.contactId,
          source_turn_id: data.turnsA[2], selected_offering_code: data.offeringA,
          selected_payment_plan: null, stage: 'course_selected', call_preference: 'call',
          call_offer_status: 'accepted', awaiting_reply: 'none',
        }),
      ]);
      expect(results.map((result) => result.version).sort()).toEqual([2, 3]);
      const events = await db!<Array<{ state_version: number }>>`
        SELECT state_version FROM conversation_sales_context_state_events_v1
        WHERE workspace_id = ${results[0].workspace_id}::uuid
          AND conversation_id = ${data.conversationA}::uuid
        ORDER BY state_version
      `;
      expect(events).toEqual([
        { state_version: 1 }, { state_version: 2 }, { state_version: 3 },
      ]);
    } finally {
      await Promise.all(connections.map((connection) => connection.end()));
    }
  });
});
