import { describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { sql } from '@/lib/db/orchestrator';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

function callOfferDecision(stateVersion: number) {
  return {
    schema_version: 3 as const,
    blocks: [{ type: 'narrative' as const, text: '¿Te sirve que te llamemos?' }],
    commit_preparations: [],
    used_memory_ids: [],
    state_patch: {
      expected_state_version: stateVersion,
      set: {
        call_offer_delta: 1 as const,
        call_offer_status: 'offered' as const,
        awaiting_reply: 'call_or_chat' as const,
      },
    },
    response_type: 'call_offer',
  };
}

describe('agent loop deferred state patch', () => {
  it('does not advance visibility-gated state when delivery fails', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(before).not.toBeNull();

    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: callOfferDecision(before!.version),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
    });

    const afterCommit = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterCommit).toMatchObject({
      version: before!.version,
      call_offer_count: 0,
      call_offer_status: before!.call_offer_status,
      awaiting_reply: before!.awaiting_reply,
    });

    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: seeded.trace_id,
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'CHANNEL_REJECTED',
      delivery_attempt: 1,
    });

    const afterFailure = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterFailure).toMatchObject({
      version: before!.version,
      call_offer_count: 0,
      call_offer_status: before!.call_offer_status,
      awaiting_reply: before!.awaiting_reply,
    });
    const [delivery] = await sql<Array<{
      deferred_state_patch: unknown;
      deferred_patch_applied_on: string | null;
    }>>`
      SELECT deferred_state_patch, deferred_patch_applied_on
      FROM outbound_deliveries
      WHERE message_id = ${committed.outbound_id}::uuid
    `;
    expect(delivery?.deferred_state_patch).toMatchObject({
      set: { call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
    expect(delivery?.deferred_patch_applied_on).toBeNull();
  });

  it('applies the deferred patch exactly once when Botpress accepts the outbound', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(before).not.toBeNull();

    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: callOfferDecision(before!.version),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
    });
    const report = {
      outbound_id: committed.outbound_id!,
      trace_id: seeded.trace_id,
      status: 'submitted_to_botpress' as const,
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    };

    expect((await recordDeliveryReport(report)).status).toBe('recorded');
    expect((await recordDeliveryReport(report)).status).toBe('duplicate');

    const after = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(after).toMatchObject({
      version: before!.version + 1,
      call_offer_count: 1,
      call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat',
    });
    const [proof] = await sql<Array<{
      deferred_patch_applied_on: string | null;
      source_turn_id: string | null;
    }>>`
      SELECT delivery.deferred_patch_applied_on, event.source_turn_id
      FROM outbound_deliveries AS delivery
      JOIN messages AS message ON message.id = delivery.message_id
      JOIN conversation_sales_context_state_events_v1 AS event
        ON event.conversation_id = message.conversation_id
       AND event.state_version = ${before!.version + 1}
      WHERE delivery.message_id = ${committed.outbound_id}::uuid
    `;
    expect(proof?.deferred_patch_applied_on).toBe('accepted');
    expect(proof?.source_turn_id).toBe(seeded.turn_id);
  });
});
