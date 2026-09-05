import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { sql } from '@/lib/db/orchestrator';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';

const alternate = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const resolver = { resolve: () => 'https://buy.stripe.com/test_agent_loop' };

afterAll(async () => alternate?.end());

describe('agent loop atomic commit regressions', () => {
  it('rejects an invalid release manifest before creating any durable effect', async () => {
    const seeded = await seedConversationForAgentTurn();
    await expect(commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Seguimos.' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
      release_manifest: {
        ...seeded.release_manifest,
        prompt_sha256: 'synthetic',
      } as never,
    })).rejects.toThrow('INVALID_AGENT_LOOP_RELEASE_MANIFEST');

    const [proof] = await sql<Array<{ decisions: number; outbounds: number }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds
    `;
    expect(proof).toEqual({ decisions: 0, outbounds: 0 });
  });

  it('rolls back a late failure when called with another real Sql client', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: alternate!, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    await alternate!`
      UPDATE contacts
      SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'integration-test'
      WHERE id = ${seeded.contact_id}::uuid
    `;

    await expect(commitAgentTurnV3(alternate!, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [
          { type: 'narrative', text: 'Perfecto, ahí va.' },
          { type: 'artifact', preparation_id: prepared.preparation_id! },
        ],
        commit_preparations: [prepared.preparation_id!],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { stage: 'payment_link_sent' },
        },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    })).rejects.toThrow('Contact is blocked or deleted');

    const [proof] = await alternate!<Array<{
      decisions: number;
      outbounds: number;
      committed_at: Date | null;
      version: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT committed_at FROM agent_turn_preparations
          WHERE id = ${prepared.preparation_id}::uuid) AS committed_at,
        state.version
      FROM conversation_sales_context_states_v1 AS state
      WHERE state.conversation_id = ${seeded.conversation_id}::uuid
    `;
    expect(proof).toMatchObject({
      decisions: 0,
      outbounds: 0,
      committed_at: null,
      version: seeded.state_version,
    });
  });

  it('records both versions of a mixed immediate and accepted patch', async () => {
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: null,
      call_offer_count: 0,
    });
    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: '¿Te sirve que te llamemos?' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: {
            selected_offering_code: 'entrenamiento_funcional',
            stage: 'course_selected',
            call_offer_delta: 1,
            call_offer_status: 'offered',
            awaiting_reply: 'call_or_chat',
          },
        },
        response_type: 'call_offer',
      },
      release_manifest: seeded.release_manifest,
    });
    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: seeded.trace_id,
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });

    const [state] = await sql<Array<{ version: number }>>`
      SELECT version FROM conversation_sales_context_states_v1
      WHERE conversation_id = ${seeded.conversation_id}::uuid
    `;
    const events = await sql<Array<{ state_version: number; source_turn_id: string | null }>>`
      SELECT state_version, source_turn_id
      FROM conversation_sales_context_state_events_v1
      WHERE conversation_id = ${seeded.conversation_id}::uuid
      ORDER BY state_version
    `;
    expect(state?.version).toBe(seeded.state_version + 2);
    expect(events).toEqual([
      { state_version: seeded.state_version + 1, source_turn_id: seeded.turn_id },
      { state_version: seeded.state_version + 2, source_turn_id: seeded.turn_id },
    ]);
  });

  it('creates one durable payment projection and activates it on acceptance', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'artifact', preparation_id: prepared.preparation_id! }],
        commit_preparations: [prepared.preparation_id!],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { stage: 'payment_link_sent' },
        },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });

    const before = await sql<Array<{ state: string; delivered_at: Date | null }>>`
      SELECT state, delivered_at FROM payment_projection_jobs
      WHERE decision_id = ${committed.decision_id}::uuid
    `;
    expect(before).toEqual([{ state: 'waiting_delivery', delivered_at: null }]);

    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: seeded.trace_id,
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });
    const after = await sql<Array<{ state: string; delivered: boolean }>>`
      SELECT state, delivered_at IS NOT NULL AS delivered
      FROM payment_projection_jobs
      WHERE decision_id = ${committed.decision_id}::uuid
    `;
    expect(after).toEqual([{ state: 'pending', delivered: true }]);
  });

  it('rejects a decision that tries to commit more than one payment link', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const first = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    const second = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'monthly_6' },
      { resolver },
    );

    await expect(commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [
          { type: 'artifact', preparation_id: first.preparation_id! },
          { type: 'artifact', preparation_id: second.preparation_id! },
        ],
        commit_preparations: [first.preparation_id!, second.preparation_id!],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { stage: 'payment_link_sent' },
        },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    })).rejects.toMatchObject({
      code: 'AGENT_TURN_V3_REJECTED',
      rejection: {
        violations: [{ code: 'MULTIPLE_PAYMENT_PREPARATIONS' }],
      },
    });
    const [effects] = await sql<Array<{
      decisions: number;
      outbounds: number;
      committed_preparations: number;
      projection_jobs: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT count(*)::int FROM agent_turn_preparations
          WHERE id IN (${first.preparation_id}::uuid, ${second.preparation_id}::uuid)
            AND committed_at IS NOT NULL) AS committed_preparations,
        (SELECT count(*)::int FROM payment_projection_jobs AS job
          JOIN agent_decisions AS decision ON decision.id = job.decision_id
          WHERE decision.turn_id = ${seeded.turn_id}::uuid) AS projection_jobs
    `;
    expect(effects).toEqual({
      decisions: 0,
      outbounds: 0,
      committed_preparations: 0,
      projection_jobs: 0,
    });
  });

  it('persists the memory and canonical-reference provenance declared by the agent', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [
          { type: 'narrative', text: 'El valor vigente es:' },
          { type: 'fact', fact_id: 'offering:entrenamiento_funcional:price:v1' },
          { type: 'artifact', preparation_id: prepared.preparation_id! },
        ],
        commit_preparations: [prepared.preparation_id!],
        used_memory_ids: ['memory-123'],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { stage: 'payment_link_sent' },
        },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });

    const [proof] = await sql<Array<{
      used_memory_ids: string[];
      message_provenance: unknown;
      outbox_provenance: unknown;
    }>>`
      SELECT
        decision.used_memory_ids,
        message.metadata -> 'agent_loop_provenance' AS message_provenance,
        outbox.payload -> 'agent_loop_provenance' AS outbox_provenance
      FROM agent_decisions AS decision
      JOIN messages AS message ON message.id = decision.outbound_message_id
      JOIN outbound_deliveries AS delivery ON delivery.message_id = message.id
      JOIN outbox_events AS outbox ON outbox.delivery_id = delivery.id
      WHERE decision.id = ${committed.decision_id}::uuid
    `;
    const expected = {
      used_memory_ids: ['memory-123'],
      fact_ids: ['offering:entrenamiento_funcional:price:v1'],
      preparation_ids: [prepared.preparation_id!],
    };
    expect(proof?.used_memory_ids).toEqual(['memory-123']);
    expect(proof?.message_provenance).toEqual(expected);
    expect(proof?.outbox_provenance).toEqual(expected);

    await expect(sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      await transaction`
        UPDATE agent_decisions
        SET used_memory_ids = ARRAY['tampered']::text[]
        WHERE id = ${committed.decision_id}::uuid
      `;
    })).rejects.toMatchObject({ code: '23514' });
    const [immutable] = await sql<Array<{ used_memory_ids: string[] }>>`
      SELECT used_memory_ids FROM agent_decisions
      WHERE id = ${committed.decision_id}::uuid
    `;
    expect(immutable?.used_memory_ids).toEqual(['memory-123']);
  });
});
