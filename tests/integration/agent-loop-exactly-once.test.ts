import { describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const resolver = { resolve: () => 'https://buy.stripe.com/test_agent_loop' };

describe('agent loop exactly once commit', () => {
  it('renders a cited course fact from the authoritative catalog', async () => {
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: 'entrenamiento_funcional',
    });

    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      decision: {
        schema_version: 3,
        blocks: [
          { type: 'narrative', text: 'El valor vigente es:' },
          { type: 'fact', fact_id: 'offering:entrenamiento_funcional:price:v1' },
        ],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });

    const [decision] = await sql<Array<{ response: string }>>`
      SELECT response FROM agent_decisions WHERE id = ${committed.decision_id}::uuid
    `;
    expect(decision?.response).toBe('El valor vigente es:\n\nUSD 360.00');
  });

  it('commits and enqueues one payment link when the same turn is replayed', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    expect(prepared.success).toBe(true);

    const decision = {
      schema_version: 3 as const,
      blocks: [
        { type: 'narrative' as const, text: 'Perfecto, ahí va.' },
        { type: 'artifact' as const, preparation_id: prepared.preparation_id! },
      ],
      commit_preparations: [prepared.preparation_id!],
      used_memory_ids: [],
      state_patch: {
        expected_state_version: seeded.state_version,
        set: { stage: 'payment_link_sent' as const },
      },
      response_type: 'commercial_reply',
    };

    const first = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      decision,
      release_manifest: seeded.release_manifest,
    });
    const second = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      decision,
      release_manifest: seeded.release_manifest,
    });

    expect(second).toEqual(first);
    const [proof] = await sql<Array<{
      decisions: number;
      committed_preparations: number;
      outbounds: number;
      outbox_events: number;
      business_action: unknown;
      response: string;
    }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM agent_turn_preparations
          WHERE id = ${prepared.preparation_id}::uuid AND committed_at IS NOT NULL) AS committed_preparations,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT count(*)::int FROM outbox_events AS event
          JOIN outbound_deliveries AS delivery ON delivery.id = event.delivery_id
          JOIN messages AS message ON message.id = delivery.message_id
          WHERE message.in_reply_to = ${seeded.turn_id}::uuid) AS outbox_events,
        (SELECT business_action FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid) AS business_action,
        (SELECT response FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid) AS response
    `;
    expect(proof).toMatchObject({
      decisions: 1,
      committed_preparations: 1,
      outbounds: 1,
      outbox_events: 1,
      business_action: {
        type: 'send_payment_link',
        plan_code: 'one_time',
        offering_sku: 'entrenamiento_funcional',
      },
    });
    expect(proof?.response).toBe(
      'Perfecto, ahí va.\n\nPago único de USD 360: https://buy.stripe.com/test_agent_loop',
    );
  });

  it('rolls back the decision, message, state and preparation when enqueue fails', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    await sql`
      UPDATE contacts
      SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'integration-test'
      WHERE id = ${seeded.contact_id}::uuid
    `;

    await expect(commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
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

    const [proof] = await sql<Array<{
      decisions: number;
      outbounds: number;
      committed_at: Date | null;
      version: number;
      stage: string;
    }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT committed_at FROM agent_turn_preparations
          WHERE id = ${prepared.preparation_id}::uuid) AS committed_at,
        state.version,
        state.stage
      FROM conversation_sales_context_states_v1 AS state
      WHERE state.conversation_id = ${seeded.conversation_id}::uuid
    `;
    expect(proof).toMatchObject({
      decisions: 0,
      outbounds: 0,
      committed_at: null,
      version: seeded.state_version,
      stage: 'exploring',
    });
  });

  it('leaves an unlisted preparation inert', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    expect(prepared.success).toBe(true);

    await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Mejor lo vemos con calma.' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });

    const [row] = await sql<Array<{ committed_at: Date | null }>>`
      SELECT committed_at FROM agent_turn_preparations
      WHERE id = ${prepared.preparation_id}::uuid
    `;
    expect(row?.committed_at).toBeNull();
  });
});
