import { describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run('Agent Loop technical fallback recovery', () => {
  it('preserves commercial state, advances only technical health, and lets the next turn recover', async () => {
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: 'entrenamiento_funcional',
    });
    await sql`
      UPDATE conversation_sales_context_states_v1
      SET selected_payment_plan = 'monthly_6',
          stage = 'plan_selected',
          call_preference = 'chat',
          call_offer_status = 'declined',
          call_offer_count = 1,
          awaiting_reply = 'none'
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND conversation_id = ${seeded.conversation_id}::uuid
    `;
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(before).not.toBeNull();

    const rejection = {
      rejection_id: seeded.trace_id,
      attempt: 1 as const,
      violations: [{ code: 'EMPTY_RESPONSE', subject: 'blocks' }],
      authorized_alternatives: {
        fact_ids: [],
        preparations: [],
        missing_information: [],
      },
    };
    await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      release_manifest: seeded.release_manifest,
      fallback: {
        reason: 'AGENT_LOOP_INTEGRITY_FAILED',
        rejection,
        trace: {
          attempt_hashes: { first: '1'.repeat(64), second: '2'.repeat(64) },
          rejections: [rejection],
          tools_requested: [],
          tools_executed: [],
        },
      },
    });

    const afterFallback = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterFallback).toMatchObject({
      selected_offering_code: before!.selected_offering_code,
      selected_payment_plan: before!.selected_payment_plan,
      stage: before!.stage,
      call_preference: before!.call_preference,
      call_offer_status: before!.call_offer_status,
      call_offer_count: before!.call_offer_count,
      awaiting_reply: before!.awaiting_reply,
      payment_reported_at: before!.payment_reported_at,
      consecutive_technical_fallbacks: 1,
      version: before!.version + 1,
    });

    const [fallbackDecision] = await sql<Array<{
      reason_code: string;
      business_action: unknown;
      response: string;
      deferred_state_patch: unknown;
    }>>`
      SELECT
        decision.reason_code,
        decision.business_action,
        decision.response,
        delivery.deferred_state_patch
      FROM agent_decisions AS decision
      JOIN outbound_deliveries AS delivery
        ON delivery.message_id = decision.outbound_message_id
      WHERE decision.turn_id = ${seeded.turn_id}::uuid
    `;
    expect(fallbackDecision).toMatchObject({
      reason_code: 'AGENT_LOOP_INTEGRITY_FAILED',
      business_action: null,
      deferred_state_patch: null,
    });
    expect(fallbackDecision?.response.length).toBeGreaterThan(0);

    const recovered = await commitAgentTurnV3(sql, {
      turn_id: seeded.second_turn_id,
      trace_id: seeded.trace_id,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Retomamos. ¿Qué necesitás saber?' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: { expected_state_version: afterFallback!.version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    expect(recovered.outbound_id).toBeTruthy();

    const afterRecovery = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterRecovery).toMatchObject({
      selected_offering_code: before!.selected_offering_code,
      selected_payment_plan: before!.selected_payment_plan,
      stage: before!.stage,
      call_preference: before!.call_preference,
      call_offer_status: before!.call_offer_status,
      call_offer_count: before!.call_offer_count,
      awaiting_reply: before!.awaiting_reply,
      payment_reported_at: before!.payment_reported_at,
      consecutive_technical_fallbacks: 0,
      version: afterFallback!.version + 1,
    });
  });
});
