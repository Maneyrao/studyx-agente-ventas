import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import {
  openIndependentLocalTestDatabases,
  openLocalTestDatabase,
} from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const canonicalUrl = 'https://buy.stripe.com/test_task_2_8';
const resolver = { resolve: () => canonicalUrl };

interface Fixture {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly offeringCode: string;
  readonly extraWorkspaceIds: string[];
}

const fixtures: Fixture[] = [];

async function seedFixture(options: {
  readonly createOffering?: boolean;
  readonly offeringStatus?: 'active' | 'inactive';
  readonly offeringCode?: string;
} = {}): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '');
  const offeringCode = options.offeringCode ?? `course_${suffix}`;
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`task-2-8-${suffix}`}, 'Task 2.8 fixture', 'sandbox', 'active')
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
  const [turn] = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversation!.id}::uuid, ${contact!.id}::uuid, 'inbound', 'Task 2.8 fixture')
    RETURNING id
  `;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspace!.id}::uuid, ${contact!.id}::uuid)
  `;
  if (options.createOffering !== false) {
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status,
        description, price_type, price_amount, currency, billing_interval
      ) VALUES (
        ${workspace!.id}::uuid, ${offeringCode}, 'Curso Task 2.8', 'course',
        ${options.offeringStatus ?? 'active'}, 'Fixture aislado', 'fixed', 360, 'USD', 'one_time'
      )
    `;
  }
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id
    ) VALUES (${workspace!.id}::uuid, ${conversation!.id}::uuid, ${contact!.id}::uuid)
  `;

  const fixture = {
    workspaceId: workspace!.id,
    contactId: contact!.id,
    conversationId: conversation!.id,
    turnId: turn!.id,
    offeringCode,
    extraWorkspaceIds: [],
  };
  fixtures.push(fixture);
  return fixture;
}

async function addWorkspaceOffering(
  fixture: Fixture,
  offeringCode: string,
  options: { readonly attachConversationState?: boolean } = {},
): Promise<string> {
  const suffix = randomUUID().replaceAll('-', '');
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`task-2-8-other-${suffix}`}, 'Task 2.8 other workspace', 'sandbox', 'active')
    RETURNING id
  `;
  fixture.extraWorkspaceIds.push(workspace!.id);
  await db!`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status,
      description, price_type, price_amount, currency, billing_interval
    ) VALUES (
      ${workspace!.id}::uuid, ${offeringCode}, 'Curso de otro workspace', 'course',
      'active', 'Fixture aislado', 'fixed', 360, 'USD', 'one_time'
    )
  `;
  if (options.attachConversationState) {
    await db!`
      INSERT INTO workspace_contacts (workspace_id, contact_id)
      VALUES (${workspace!.id}::uuid, ${fixture.contactId}::uuid)
    `;
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id
      ) VALUES (
        ${workspace!.id}::uuid, ${fixture.conversationId}::uuid, ${fixture.contactId}::uuid
      )
    `;
  }
  return workspace!.id;
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  const workspaceIds = [fixture.workspaceId, ...fixture.extraWorkspaceIds];
  await db!`DELETE FROM agent_turn_preparations WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversation_sales_context_state_events_v1 WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversation_sales_context_states_v1 WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM messages WHERE conversation_id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM conversations WHERE id = ${fixture.conversationId}::uuid`;
  await db!`DELETE FROM offerings WHERE workspace_id = ANY(${workspaceIds}::uuid[])`;
  await db!`DELETE FROM workspace_contacts WHERE workspace_id = ANY(${workspaceIds}::uuid[])`;
  await db!`DELETE FROM contacts WHERE id = ${fixture.contactId}::uuid`;
  await db!`DELETE FROM workspaces WHERE id = ANY(${workspaceIds}::uuid[])`;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await cleanFixture(fixture);
});

afterAll(async () => db?.end());

run('prepare_payment_link', () => {
  it('reserves a canonical artifact without producing any committed or delivery effect', async () => {
    const seeded = await seedFixture();
    const result = await db!.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      return preparePaymentLinkToolV1(
        { db: transaction, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
        { offering_code: seeded.offeringCode, payment_plan: 'one_time' },
        { resolver },
      );
    });

    expect(result.success).toBe(true);
    expect(result.preparation_id).toBeTruthy();
    expect(result.canonical_data).toEqual({
      label: 'Pago único de USD 360',
      url: canonicalUrl,
      offering_code: seeded.offeringCode,
      payment_plan: 'one_time',
    });

    const [proof] = await db!<Array<{
      committed_at: Date | null;
      decisions: number;
      outbound_messages: number;
      deliveries: number;
      outbox_events: number;
    }>>`
      SELECT
        preparation.committed_at,
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
      FROM agent_turn_preparations AS preparation
      WHERE preparation.id = ${result.preparation_id}::uuid
    `;
    expect(proof).toEqual({
      committed_at: null,
      decisions: 0,
      outbound_messages: 0,
      deliveries: 0,
      outbox_events: 0,
    });
  });

  it('returns one reservation under a real race between independent connections', async () => {
    const seeded = await seedFixture();
    const connections = openIndependentLocalTestDatabases(2);
    try {
      const args = { offering_code: seeded.offeringCode, payment_plan: 'one_time' as const };
      const [first, second] = await Promise.all([
        connections[0].begin(async (transaction) => {
          await transaction`SET LOCAL ROLE orchestrator_role`;
          return preparePaymentLinkToolV1(
            { db: transaction, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
            args,
            { resolver },
          );
        }),
        connections[1].begin(async (transaction) => {
          await transaction`SET LOCAL ROLE orchestrator_role`;
          return preparePaymentLinkToolV1(
            { db: transaction, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
            args,
            { resolver },
          );
        }),
      ]);
      const third = await preparePaymentLinkToolV1(
        { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
        args,
        { resolver },
      );

      expect(new Set([first.preparation_id, second.preparation_id, third.preparation_id]).size).toBe(1);
      expect([first, second].filter((result) => result.idempotency_result === 'applied')).toHaveLength(1);
      expect([first, second].filter((result) => result.idempotency_result === 'duplicate')).toHaveLength(1);
      expect(third.idempotency_result).toBe('duplicate');
      expect(third.canonical_data).toEqual(first.canonical_data);
      const [stored] = await db!<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM agent_turn_preparations
        WHERE conversation_id = ${seeded.conversationId}::uuid
          AND tool = 'prepare_payment_link'
      `;
      expect(stored?.n).toBe(1);
    } finally {
      await Promise.all(connections.map((connection) => connection.end()));
    }
  });

  it('rejects a course that exists only in another workspace', async () => {
    const seeded = await seedFixture({ createOffering: false });
    await addWorkspaceOffering(seeded, seeded.offeringCode);
    const resolve = vi.fn(() => canonicalUrl);

    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: seeded.offeringCode, payment_plan: 'one_time' },
      { resolver: { resolve } },
    );

    expect(result).toMatchObject({
      success: false,
      error_code: 'OFFERING_NOT_FOUND',
      recoverable: false,
      preparation_id: null,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails closed when one conversation is associated with two workspaces', async () => {
    const seeded = await seedFixture();
    await addWorkspaceOffering(seeded, seeded.offeringCode, { attachConversationState: true });

    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: seeded.offeringCode, payment_plan: 'one_time' },
      { resolver },
    );

    expect(result).toMatchObject({
      success: false,
      error_code: 'PREPARATION_CONTEXT_INVALID',
      preparation_id: null,
    });
  });

  it('rejects inactive and non-existent offerings in the authoritative workspace', async () => {
    const inactive = await seedFixture({ offeringStatus: 'inactive' });
    const missing = await seedFixture({ createOffering: false });

    for (const seeded of [inactive, missing]) {
      await expect(preparePaymentLinkToolV1(
        { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
        { offering_code: seeded.offeringCode, payment_plan: 'one_time' },
        { resolver },
      )).resolves.toMatchObject({
        success: false,
        error_code: 'OFFERING_NOT_FOUND',
        preparation_id: null,
      });
    }
  });

  it('rejects a runtime non-string offering before consulting the database or resolver', async () => {
    const seeded = await seedFixture();
    const resolve = vi.fn(() => canonicalUrl);
    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: 7, payment_plan: 'one_time' } as unknown as {
        offering_code: string;
        payment_plan: string;
      },
      { resolver: { resolve } },
    );

    expect(result).toMatchObject({ success: false, error_code: 'INVALID_OFFERING_CODE' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical URL returned by an injected resolver', async () => {
    const seeded = await seedFixture();
    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: seeded.offeringCode, payment_plan: 'one_time' },
      { resolver: { resolve: () => 'https://payments.example.test/not-canonical' } },
    );

    expect(result).toMatchObject({
      success: false,
      error_code: 'INVALID_PAYMENT_LINK',
      recoverable: false,
      preparation_id: null,
    });
  });

  it('fails recoverably when the configured link is absent', async () => {
    const seeded = await seedFixture();
    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: seeded.offeringCode, payment_plan: 'monthly_12' },
      { resolver: { resolve: () => null } },
    );
    expect(result).toMatchObject({
      success: false,
      error_code: 'LINK_CONFIG_MISSING',
      recoverable: true,
      preparation_id: null,
    });
  });

  it('rejects an unknown plan before consulting the database or resolver', async () => {
    const seeded = await seedFixture();
    const resolve = vi.fn(() => canonicalUrl);
    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: seeded.turnId, conversation_id: seeded.conversationId },
      { offering_code: seeded.offeringCode, payment_plan: 'unknown' },
      { resolver: { resolve } },
    );
    expect(result).toMatchObject({ success: false, error_code: 'INVALID_PAYMENT_PLAN' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('cannot reserve an artifact for a turn from another conversation', async () => {
    const first = await seedFixture();
    const second = await seedFixture();

    const result = await preparePaymentLinkToolV1(
      { db: db!, turn_id: first.turnId, conversation_id: second.conversationId },
      { offering_code: second.offeringCode, payment_plan: 'one_time' },
      { resolver },
    );

    expect(result).toMatchObject({
      success: false,
      error_code: 'PREPARATION_CONTEXT_INVALID',
      preparation_id: null,
    });
  });

  it('expires only stale uncommitted reservations in the requested workspace', async () => {
    const first = await seedFixture();
    const second = await seedFixture();
    const firstPending = await preparePaymentLinkToolV1(
      { db: db!, turn_id: first.turnId, conversation_id: first.conversationId },
      { offering_code: first.offeringCode, payment_plan: 'one_time' },
      { resolver },
    );
    const firstCommitted = await preparePaymentLinkToolV1(
      { db: db!, turn_id: first.turnId, conversation_id: first.conversationId },
      { offering_code: first.offeringCode, payment_plan: 'monthly_6' },
      { resolver },
    );
    const secondPending = await preparePaymentLinkToolV1(
      { db: db!, turn_id: second.turnId, conversation_id: second.conversationId },
      { offering_code: second.offeringCode, payment_plan: 'one_time' },
      { resolver },
    );
    await db!`
      UPDATE agent_turn_preparations
      SET created_at = now() - interval '1 hour',
          committed_at = CASE
            WHEN id = ${firstCommitted.preparation_id}::uuid THEN now()
            ELSE committed_at
          END
      WHERE id = ANY(${[
        firstPending.preparation_id,
        firstCommitted.preparation_id,
        secondPending.preparation_id,
      ]}::uuid[])
    `;

    const [privileges] = await db!<Array<{
      can_delete: boolean;
      can_update_table: boolean;
      can_update_key: boolean;
      can_update_committed_at: boolean;
      can_update_canonical_data: boolean;
      can_expire: boolean;
    }>>`
      SELECT
        has_table_privilege('orchestrator_role', 'agent_turn_preparations', 'DELETE') AS can_delete,
        has_table_privilege('orchestrator_role', 'agent_turn_preparations', 'UPDATE') AS can_update_table,
        has_column_privilege(
          'orchestrator_role', 'agent_turn_preparations', 'canonical_key', 'UPDATE'
        ) AS can_update_key,
        has_column_privilege(
          'orchestrator_role', 'agent_turn_preparations', 'committed_at', 'UPDATE'
        ) AS can_update_committed_at,
        has_column_privilege(
          'orchestrator_role', 'agent_turn_preparations', 'canonical_data', 'UPDATE'
        ) AS can_update_canonical_data,
        has_function_privilege(
          'orchestrator_role',
          'public.expire_agent_turn_preparations_v1(uuid,bigint)',
          'EXECUTE'
        ) AS can_expire
    `;
    expect(privileges).toEqual({
      can_delete: false,
      can_update_table: false,
      can_update_key: true,
      can_update_committed_at: true,
      can_update_canonical_data: false,
      can_expire: true,
    });

    const [expired] = await db!.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      return transaction<Array<{ expired: number }>>`
        SELECT public.expire_agent_turn_preparations_v1(
          ${first.workspaceId}::uuid,
          ${15 * 60 * 1000}::bigint
        ) AS expired
      `;
    });
    expect(expired?.expired).toBe(1);

    const surviving = await db!<Array<{ id: string }>>`
      SELECT id FROM agent_turn_preparations
      WHERE id = ANY(${[
        firstPending.preparation_id,
        firstCommitted.preparation_id,
        secondPending.preparation_id,
      ]}::uuid[])
      ORDER BY id
    `;
    expect(surviving.map((row) => row.id).sort()).toEqual([
      firstCommitted.preparation_id,
      secondPending.preparation_id,
    ].sort());
  });
});
