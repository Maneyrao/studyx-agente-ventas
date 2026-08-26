import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture() {
  const contact = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+54911${randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '0')}`}, 'whatsapp') RETURNING id
  `;
  const conversation = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contact[0].id}::uuid, 'whatsapp') RETURNING id
  `;
  const offering = await db!<Array<{ code: string }>>`
    SELECT o.code FROM offerings AS o JOIN workspaces AS w ON w.id = o.workspace_id
    WHERE w.slug = 'studyx' AND o.status = 'active' ORDER BY o.code LIMIT 1
  `;
  return { contactId: contact[0].id, conversationId: conversation[0].id, offeringCode: offering[0].code };
}

run('sales_context_states', () => {
  it('persists canonical course/plan state and audits each versioned transition', async () => {
    const fixtureData = await fixture();
    const store = new PostgresSalesContextStore(db!);
    const first = await store.transition({
      workspace_slug: 'studyx', contact_id: fixtureData.contactId, conversation_id: fixtureData.conversationId,
      source_turn_id: null, selected_offering_code: fixtureData.offeringCode,
      selected_payment_plan: null, stage: 'course_selected',
    });
    const second = await store.transition({
      workspace_slug: 'studyx', contact_id: fixtureData.contactId, conversation_id: fixtureData.conversationId,
      source_turn_id: null, selected_offering_code: fixtureData.offeringCode,
      selected_payment_plan: 'monthly_12', stage: 'plan_selected',
    });

    expect(first).toMatchObject({ selected_offering_code: fixtureData.offeringCode, version: 1 });
    expect(second).toMatchObject({ selected_payment_plan: 'monthly_12', stage: 'plan_selected', version: 2 });
    await expect(store.load('studyx', fixtureData.contactId)).resolves.toMatchObject({ version: 2 });
    const events = await db!<Array<{ state_version: number }>>`
      SELECT state_version FROM sales_context_state_events
      WHERE contact_id = ${fixtureData.contactId}::uuid ORDER BY state_version
    `;
    expect(events).toEqual([{ state_version: 1 }, { state_version: 2 }]);
  });

  it('rejects an offering outside the configured workspace instead of persisting text as identity', async () => {
    const fixtureData = await fixture();
    const store = new PostgresSalesContextStore(db!);
    await expect(store.transition({
      workspace_slug: 'studyx', contact_id: fixtureData.contactId, conversation_id: fixtureData.conversationId,
      source_turn_id: null, selected_offering_code: 'inventado',
      selected_payment_plan: null, stage: 'course_selected',
    })).rejects.toThrow('SALES_CONTEXT_WORKSPACE_OR_OFFERING_NOT_FOUND');
  });
});
