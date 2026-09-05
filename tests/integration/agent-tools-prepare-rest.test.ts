import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  prepareCallRequestToolV1,
  prepareContactDetailsToolV1,
  prepareLeadProjectionToolV1,
  prepareMemoryToolV1,
} from '@/features/conversation/application/agent-tools-prepare';
import type { DbClient } from '@/lib/db/types';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

interface Fixture {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly secondTurnId: string;
  readonly extraWorkspaceIds: string[];
}

const fixtures: Fixture[] = [];

async function asOrchestrator<T>(operation: (transaction: DbClient) => Promise<T>): Promise<T> {
  const result = await db!.begin(async (transaction) => {
    await transaction`SET LOCAL ROLE orchestrator_role`;
    return operation(transaction);
  });
  return result as T;
}

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '');
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`task-2-13-${suffix}`}, 'Task 2.13 fixture', 'sandbox', 'active')
    RETURNING id
  `;
  const [contact] = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+54911${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`}, 'whatsapp')
    RETURNING id
  `;
  const [conversation] = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contact!.id}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;
  const turns = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES
      (${conversation!.id}::uuid, ${contact!.id}::uuid, 'inbound', 'Primer turno Task 2.13'),
      (${conversation!.id}::uuid, ${contact!.id}::uuid, 'inbound', 'Segundo turno Task 2.13')
    RETURNING id
  `;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspace!.id}::uuid, ${contact!.id}::uuid)
  `;
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id
    ) VALUES (${workspace!.id}::uuid, ${conversation!.id}::uuid, ${contact!.id}::uuid)
  `;

  const fixture = {
    workspaceId: workspace!.id,
    contactId: contact!.id,
    conversationId: conversation!.id,
    turnId: turns[0]!.id,
    secondTurnId: turns[1]!.id,
    extraWorkspaceIds: [],
  };
  fixtures.push(fixture);
  return fixture;
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await db!`DELETE FROM agent_turn_preparations WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversation_sales_context_state_events_v1 WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversation_sales_context_states_v1 WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM messages WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversations WHERE id = ${fixture.conversationId}::uuid`;
  const workspaceIds = [fixture.workspaceId, ...fixture.extraWorkspaceIds];
  await db!`DELETE FROM workspace_contacts WHERE workspace_id = ANY(${workspaceIds}::uuid[])`;
  await db!`DELETE FROM contacts WHERE id = ${fixture.contactId}::uuid`;
  await db!`DELETE FROM workspaces WHERE id = ANY(${workspaceIds}::uuid[])`;
}

async function addAmbiguousWorkspace(fixture: Fixture): Promise<void> {
  const suffix = randomUUID().replaceAll('-', '');
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`task-2-13-other-${suffix}`}, 'Task 2.13 ambiguous workspace', 'sandbox', 'active')
    RETURNING id
  `;
  fixture.extraWorkspaceIds.push(workspace!.id);
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspace!.id}::uuid, ${fixture.contactId}::uuid)
  `;
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id
    ) VALUES (${workspace!.id}::uuid, ${fixture.conversationId}::uuid, ${fixture.contactId}::uuid)
  `;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await cleanFixture(fixture);
});

afterAll(async () => db?.end());

run('remaining Agent Loop preparation tools', () => {
  it('reserves contact fields and reports the still-missing durable intake without mutating the contact', async () => {
    const seeded = await seedFixture();
    const first = await asOrchestrator((transaction) => prepareContactDetailsToolV1({
      db: transaction,
      turn_id: seeded.turnId,
      conversation_id: seeded.conversationId,
      contact_id: seeded.contactId,
    }, { first_name: 'Ana' }));
    const duplicate = await asOrchestrator((transaction) => prepareContactDetailsToolV1({
      db: transaction,
      turn_id: seeded.turnId,
      conversation_id: seeded.conversationId,
      contact_id: seeded.contactId,
    }, { first_name: 'Ana' }));

    expect(first).toMatchObject({
      success: true,
      canonical_data: {
        recorded: ['nombre'],
        still_missing: ['apellido', 'correo'],
      },
      idempotency_result: 'applied',
    });
    expect(duplicate).toMatchObject({
      success: true,
      preparation_id: first.preparation_id,
      canonical_data: first.canonical_data,
      idempotency_result: 'duplicate',
    });
    const [contact] = await db!<Array<{ name: string | null; email: string | null }>>`
      SELECT name, email FROM contacts WHERE id = ${seeded.contactId}::uuid
    `;
    expect(contact).toEqual({ name: null, email: null });
  });

  it('reserves a call without creating a call, decision, message, delivery, or outbox effect', async () => {
    const seeded = await seedFixture();
    const result = await asOrchestrator((transaction) => prepareCallRequestToolV1(
      {
        db: transaction,
        turn_id: seeded.turnId,
        conversation_id: seeded.conversationId,
        contact_id: seeded.contactId,
      },
      { reason: 'customer_request' },
    ));
    const duplicate = await asOrchestrator((transaction) => prepareCallRequestToolV1(
      {
        db: transaction,
        turn_id: seeded.turnId,
        conversation_id: seeded.conversationId,
        contact_id: seeded.contactId,
      },
      { reason: 'customer_request' },
    ));

    expect(result).toMatchObject({
      success: true,
      canonical_data: { status: 'reserved' },
      idempotency_result: 'applied',
    });
    expect(result.canonical_data?.call_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(duplicate).toMatchObject({
      success: true,
      preparation_id: result.preparation_id,
      canonical_data: result.canonical_data,
      idempotency_result: 'duplicate',
    });
    const [proof] = await db!<Array<{
      calls: number;
      call_events: number;
      decisions: number;
      outbound_messages: number;
      deliveries: number;
      outbox_events: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM call_sessions
          WHERE conversation_id = ${seeded.conversationId}::uuid) AS calls,
        (SELECT count(*)::int FROM call_events AS event
          JOIN call_sessions AS session ON session.id = event.call_id
          WHERE session.conversation_id = ${seeded.conversationId}::uuid) AS call_events,
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turnId}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turnId}::uuid AND direction = 'outbound') AS outbound_messages,
        (SELECT count(*)::int FROM outbound_deliveries AS delivery
          JOIN messages AS outbound ON outbound.id = delivery.message_id
          WHERE outbound.in_reply_to = ${seeded.turnId}::uuid) AS deliveries,
        (SELECT count(*)::int FROM outbox_events AS event
          JOIN outbound_deliveries AS delivery ON delivery.id = event.delivery_id
          JOIN messages AS outbound ON outbound.id = delivery.message_id
          WHERE outbound.in_reply_to = ${seeded.turnId}::uuid) AS outbox_events
    `;
    expect(proof).toEqual({
      calls: 0,
      call_events: 0,
      decisions: 0,
      outbound_messages: 0,
      deliveries: 0,
      outbox_events: 0,
    });
  });

  it('preserves accepted memory IDs and the exact supersedes relation across turns', async () => {
    const seeded = await seedFixture();
    const first = await asOrchestrator((transaction) => prepareMemoryToolV1(
      { db: transaction, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }] },
    ));
    expect(first.success).toBe(true);
    const firstId = first.canonical_data?.accepted[0]?.id;
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/u);

    const second = await asOrchestrator((transaction) => prepareMemoryToolV1(
      { db: transaction, turn_id: seeded.secondTurnId, conversation_id: seeded.conversationId },
      {
        candidates: [{
          text: 'En realidad quiere finanzas',
          type: 'study_goal',
          supersedes: [firstId!],
        }],
      },
    ));
    const duplicate = await asOrchestrator((transaction) => prepareMemoryToolV1(
      { db: transaction, turn_id: seeded.secondTurnId, conversation_id: seeded.conversationId },
      {
        candidates: [{
          text: 'En realidad quiere finanzas',
          type: 'study_goal',
          supersedes: [firstId!],
        }],
      },
    ));

    expect(second).toMatchObject({
      success: true,
      canonical_data: {
        accepted: [{ text: 'En realidad quiere finanzas', type: 'study_goal' }],
        rejected: [],
        supersedes: [firstId],
      },
      idempotency_result: 'applied',
    });
    expect(duplicate).toMatchObject({
      success: true,
      preparation_id: second.preparation_id,
      canonical_data: second.canonical_data,
      idempotency_result: 'duplicate',
    });
    expect(duplicate.canonical_data?.accepted[0]?.id).toBe(second.canonical_data?.accepted[0]?.id);

    const [jobs] = await db!<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_a_memory_projection_jobs
      WHERE turn_id = ANY(${[seeded.turnId, seeded.secondTurnId]}::uuid[])
    `;
    expect(jobs?.n).toBe(0);
  });

  it('keys memory by text, type, and supersedes and rejects foreign supersedes authority', async () => {
    const seeded = await seedFixture();
    const foreign = await seedFixture();
    const base = { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId };
    const foreignMemory = await prepareMemoryToolV1(
      { db: db!, turn_id: foreign.turnId, conversation_id: foreign.conversationId },
      { candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }] },
    );
    const textAndType = await prepareMemoryToolV1(base, {
      candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }],
    });
    const differentType = await prepareMemoryToolV1(base, {
      candidates: [{ text: 'Quiere marketing', type: 'preference', supersedes: [] }],
    });
    const differentSupersedes = await prepareMemoryToolV1(base, {
      candidates: [{
        text: 'Quiere marketing',
        type: 'study_goal',
        supersedes: [textAndType.canonical_data!.accepted[0]!.id],
      }],
    });
    const foreignSupersedes = await prepareMemoryToolV1(base, {
      candidates: [{
        text: 'Quiere marketing',
        type: 'study_goal',
        supersedes: [foreignMemory.canonical_data!.accepted[0]!.id],
      }],
    });

    expect(new Set([
      textAndType.preparation_id,
      differentType.preparation_id,
      differentSupersedes.preparation_id,
    ]).size).toBe(3);
    expect(foreignSupersedes).toMatchObject({
      success: false,
      error_code: 'MEMORY_SUPERSEDES_NOT_AUTHORIZED',
      recoverable: false,
      preparation_id: null,
    });
  });

  it('reserves the inert lead projection contract idempotently', async () => {
    const seeded = await seedFixture();
    const first = await asOrchestrator((transaction) => prepareLeadProjectionToolV1({
      db: transaction,
      turn_id: seeded.turnId,
      conversation_id: seeded.conversationId,
    }));
    const duplicate = await asOrchestrator((transaction) => prepareLeadProjectionToolV1({
      db: transaction,
      turn_id: seeded.turnId,
      conversation_id: seeded.conversationId,
    }));

    expect(first).toMatchObject({
      success: true,
      canonical_data: { queued: false },
      idempotency_result: 'applied',
    });
    expect(duplicate).toMatchObject({
      success: true,
      preparation_id: first.preparation_id,
      canonical_data: { queued: false },
      idempotency_result: 'duplicate',
    });
  });

  it('fails closed for every tool when the inbound turn belongs to another conversation', async () => {
    const owned = await seedFixture();
    const other = await seedFixture();
    const wrongBase = {
      db: db!,
      turn_id: other.turnId,
      conversation_id: owned.conversationId,
    };
    const attempts = await Promise.all([
      prepareContactDetailsToolV1(
        { ...wrongBase, contact_id: owned.contactId },
        { first_name: 'Ana' },
      ),
      prepareCallRequestToolV1(
        { ...wrongBase, contact_id: owned.contactId },
        { reason: 'customer_request' },
      ),
      prepareMemoryToolV1(wrongBase, {
        candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }],
      }),
      prepareLeadProjectionToolV1(wrongBase),
      prepareContactDetailsToolV1(
        {
          db: db!,
          turn_id: owned.turnId,
          conversation_id: owned.conversationId,
          contact_id: other.contactId,
        },
        { first_name: 'Ana' },
      ),
      prepareCallRequestToolV1(
        {
          db: db!,
          turn_id: owned.turnId,
          conversation_id: owned.conversationId,
          contact_id: other.contactId,
        },
        { reason: 'customer_request' },
      ),
    ]);

    for (const result of attempts) {
      expect(result).toMatchObject({
        success: false,
        error_code: 'PREPARATION_CONTEXT_INVALID',
        recoverable: false,
        preparation_id: null,
      });
    }
    const [stored] = await db!<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE conversation_id = ${owned.conversationId}::uuid
    `;
    expect(stored?.n).toBe(0);
  });

  it('fails closed for every tool when one conversation resolves to two active workspaces', async () => {
    const seeded = await seedFixture();
    await addAmbiguousWorkspace(seeded);
    const base = {
      db: db!,
      turn_id: seeded.turnId,
      conversation_id: seeded.conversationId,
    };
    const attempts = await Promise.all([
      prepareContactDetailsToolV1(
        { ...base, contact_id: seeded.contactId },
        { first_name: 'Ana' },
      ),
      prepareCallRequestToolV1(
        { ...base, contact_id: seeded.contactId },
        { reason: 'customer_request' },
      ),
      prepareMemoryToolV1(base, {
        candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }],
      }),
      prepareLeadProjectionToolV1(base),
    ]);

    expect(attempts).toHaveLength(4);
    for (const result of attempts) {
      expect(result).toMatchObject({
        success: false,
        error_code: 'PREPARATION_CONTEXT_INVALID',
        recoverable: false,
        preparation_id: null,
      });
    }
    const [stored] = await db!<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE conversation_id = ${seeded.conversationId}::uuid
    `;
    expect(stored?.n).toBe(0);
  });
});
