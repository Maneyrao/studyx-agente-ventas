import { describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const resolver = { resolve: () => 'https://buy.stripe.com/test_agent_loop' };

describe('agent loop technical fallback commit', () => {
  it('persists one complete fallback without commercial effects or prepared effects', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    expect(prepared.success).toBe(true);

    const rejection = {
      rejection_id: `reject-${seeded.turn_id}`,
      attempt: 1 as const,
      violations: [{ code: 'NARRATIVE_CONTAINS_AMOUNT', subject: 'blocks.0' }],
      authorized_alternatives: {
        fact_ids: ['fact:payment_plan:one_time'],
        preparations: [prepared.preparation_id!],
        missing_information: [],
      },
    };
    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      fallback: { reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection },
      release_manifest: seeded.release_manifest,
    });

    const [proof] = await sql<Array<{
      response: string;
      response_type: string;
      reason_code: string;
      business_action: unknown;
      memory_candidates: unknown;
      release_manifest: unknown;
      message_content: string;
      message_metadata: Record<string, unknown>;
      outbox_payload: Record<string, unknown>;
      deferred_state_patch: unknown;
      committed_at: Date | null;
      selected_offering_code: string | null;
      stage: string;
      consecutive_technical_fallbacks: number;
      human_review_requested_at: Date | null;
      state_events: number;
    }>>`
      SELECT
        decision.response,
        decision.response_type,
        decision.reason_code,
        decision.business_action,
        decision.memory_candidates,
        decision.release_manifest,
        message.content AS message_content,
        message.metadata AS message_metadata,
        outbox.payload AS outbox_payload,
        delivery.deferred_state_patch,
        preparation.committed_at,
        state.selected_offering_code,
        state.stage,
        state.consecutive_technical_fallbacks,
        state.human_review_requested_at,
        (SELECT count(*)::int
          FROM conversation_sales_context_state_events_v1 AS event
          WHERE event.source_turn_id = ${seeded.turn_id}::uuid) AS state_events
      FROM agent_decisions AS decision
      JOIN messages AS message ON message.id = decision.outbound_message_id
      JOIN outbound_deliveries AS delivery ON delivery.message_id = message.id
      JOIN outbox_events AS outbox ON outbox.delivery_id = delivery.id
      JOIN agent_turn_preparations AS preparation ON preparation.id = ${prepared.preparation_id}::uuid
      JOIN conversation_sales_context_states_v1 AS state
        ON state.conversation_id = message.conversation_id
       AND state.contact_id = message.contact_id
      WHERE decision.id = ${committed.decision_id}::uuid
    `;

    expect(proof).toMatchObject({
      response_type: 'clarification',
      reason_code: 'AGENT_LOOP_INTEGRITY_FAILED',
      business_action: null,
      memory_candidates: [],
      release_manifest: seeded.release_manifest,
      selected_offering_code: 'entrenamiento_funcional',
      stage: 'exploring',
      consecutive_technical_fallbacks: 1,
      human_review_requested_at: null,
      state_events: 1,
      committed_at: null,
      deferred_state_patch: null,
    });
    expect(proof?.response).toBe(
      'Recibí tu mensaje, pero tuve una demora para procesarlo. Probá nuevamente en unos segundos.',
    );
    expect(proof?.message_content).toBe(proof?.response);
    expect(proof?.message_metadata.agent_loop_fallback).toEqual({
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
    expect(proof?.outbox_payload.agent_loop_fallback).toEqual({
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
    expect(JSON.stringify(proof)).not.toContain('USD 47');
  });
});
