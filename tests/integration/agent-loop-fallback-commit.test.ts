import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';
import type { IntegrityRejectionV1 } from '../../agent-core/src/domain/integrity-rejection';

const resolver = { resolve: () => 'https://buy.stripe.com/test_agent_loop' };
const alternate = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => alternate?.end());

function integrityTrace(rejection: IntegrityRejectionV1, promptSha256: string) {
  return {
    model_request_prompt_sha256s: ['0'.repeat(64), promptSha256],
    attempt_hashes: { first: '1'.repeat(64), second: '2'.repeat(64) },
    rejections: [rejection],
    tools_requested: [],
    tools_executed: [],
  } as const;
}

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
    const trace = integrityTrace(rejection, seeded.release_manifest.prompt_sha256);
    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      fallback: {
        reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection,
        prompt_sha256: seeded.release_manifest.prompt_sha256,
        trace,
      },
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
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
      ...trace,
    });
    expect(proof?.outbox_payload.agent_loop_fallback).toEqual({
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
      ...trace,
    });
    expect(JSON.stringify(proof)).not.toContain('USD 47');
  });

  it('resets the consecutive fallback counter after a healthy empty-patch reply', async () => {
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: 'entrenamiento_funcional',
    });
    const rejection = {
      rejection_id: `reject-${seeded.turn_id}`,
      attempt: 1 as const,
      violations: [{ code: 'EMPTY_RESPONSE', subject: 'blocks' }],
      authorized_alternatives: {
        fact_ids: [], preparations: [], missing_information: [],
      },
    };
    await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      fallback: {
        reason: 'AGENT_LOOP_INTEGRITY_FAILED',
        rejection,
        prompt_sha256: seeded.release_manifest.prompt_sha256,
        trace: integrityTrace(rejection, seeded.release_manifest.prompt_sha256),
      },
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
    });
    const store = new PostgresConversationStateStoreV1(sql);
    const afterFallback = await store.load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(afterFallback?.consecutive_technical_fallbacks).toBe(1);

    await commitAgentTurnV3(sql, {
      turn_id: seeded.second_turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Retomamos. ¿Qué necesitás saber?' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: { expected_state_version: afterFallback!.version, set: {} },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });
    const afterHealthy = await store.load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(afterHealthy).toMatchObject({
      version: afterFallback!.version + 1,
      selected_offering_code: 'entrenamiento_funcional',
      stage: afterFallback!.stage,
      awaiting_reply: afterFallback!.awaiting_reply,
      consecutive_technical_fallbacks: 0,
    });
  });

  it('rolls back fallback state and evidence after a late failure on another Sql client', async () => {
    const seeded = await seedConversationForAgentTurn();
    await alternate!`
      UPDATE contacts
      SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'integration-test'
      WHERE id = ${seeded.contact_id}::uuid
    `;
    const trace = {
      model_request_prompt_sha256s: [seeded.release_manifest.prompt_sha256],
      attempt_hashes: { first: '3'.repeat(64), second: null },
      rejections: [],
      tools_requested: [],
      tools_executed: [],
    } as const;

    await expect(commitAgentTurnV3(alternate!, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      fallback: {
        reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
        rejection: null,
        prompt_sha256: seeded.release_manifest.prompt_sha256,
        trace,
      },
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
    })).rejects.toThrow('Contact is blocked or deleted');

    const [proof] = await alternate!<Array<{
      consecutive_technical_fallbacks: number;
      version: number;
      decisions: number;
      outbounds: number;
      state_events: number;
    }>>`
      SELECT
        state.consecutive_technical_fallbacks,
        state.version,
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT count(*)::int FROM conversation_sales_context_state_events_v1
          WHERE source_turn_id = ${seeded.turn_id}::uuid) AS state_events
      FROM conversation_sales_context_states_v1 AS state
      WHERE state.conversation_id = ${seeded.conversation_id}::uuid
    `;
    expect(proof).toMatchObject({
      consecutive_technical_fallbacks: 0,
      version: seeded.state_version,
      decisions: 0,
      outbounds: 0,
      state_events: 0,
    });
  });
});
