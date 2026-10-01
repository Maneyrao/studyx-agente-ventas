import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => { await db?.end(); });

run('lead course interests', () => {
  it('retains several selected courses while the active checkout remains singular', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [workspace] = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name) VALUES (${`multi-${suffix}`}, 'Multi') RETURNING id
    `;
    const [contact] = await db!<Array<{ id: string }>>`
      INSERT INTO contacts (phone, channel_origin)
      VALUES (${`+54911${Math.floor(10000000 + Math.random() * 89999999)}`}, 'whatsapp') RETURNING id
    `;
    await db!`INSERT INTO workspace_contacts (workspace_id, contact_id) VALUES (${workspace.id}::uuid, ${contact.id}::uuid)`;
    const [conversation] = await db!<Array<{ id: string }>>`
      INSERT INTO conversations (contact_id, channel, status) VALUES (${contact.id}::uuid, 'whatsapp', 'open') RETURNING id
    `;
    for (const code of [`course-a-${suffix}`, `course-b-${suffix}`]) {
      await db!`
        INSERT INTO offerings (workspace_id, code, display_name, offering_type, status, description, price_type, price_amount, currency)
        VALUES (${workspace.id}::uuid, ${code}, ${code}, 'course', 'active', 'desc', 'fixed', 360, 'USD')
      `;
    }
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, selected_offering_code, stage
      ) VALUES (${workspace.id}::uuid, ${conversation.id}::uuid, ${contact.id}::uuid, ${`course-a-${suffix}`}, 'course_selected')
    `;
    await db!`
      UPDATE conversation_sales_context_states_v1
      SET selected_offering_code = ${`course-b-${suffix}`}, version = version + 1
      WHERE workspace_id = ${workspace.id}::uuid AND conversation_id = ${conversation.id}::uuid
    `;

    const interests = await db!<Array<{ offering_code: string; status: string }>>`
      SELECT offering_code, status FROM lead_course_interests
      WHERE workspace_id = ${workspace.id}::uuid AND contact_id = ${contact.id}::uuid
      ORDER BY offering_code
    `;
    expect(interests).toEqual([
      { offering_code: `course-a-${suffix}`, status: 'selected' },
      { offering_code: `course-b-${suffix}`, status: 'selected' },
    ]);
  });
});
