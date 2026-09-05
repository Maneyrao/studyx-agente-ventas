import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const touchedConversations: string[] = [];
const resolver = { resolve: () => 'https://example.test/pay' };

afterEach(async () => {
  for (const conversationId of touchedConversations.splice(0)) {
    await sql`
      DELETE FROM agent_turn_preparations
      WHERE conversation_id = ${conversationId}::uuid
    `;
  }
});

describe('prepare_payment_link', () => {
  it('reserves an artifact without producing any committed effect', async () => {
    const seeded = await seedConversationForAgentTurn();
    touchedConversations.push(seeded.conversation_id);
    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );

    expect(result.success).toBe(true);
    expect(result.preparation_id).toBeTruthy();
    expect(result.canonical_data).toEqual({
      label: 'Pago único de USD 360',
      url: 'https://example.test/pay',
      offering_code: 'entrenamiento_funcional',
      payment_plan: 'one_time',
    });

    const [preparation] = await sql<Array<{ committed_at: Date | null }>>`
      SELECT committed_at FROM agent_turn_preparations
      WHERE id = ${result.preparation_id}::uuid
    `;
    expect(preparation?.committed_at).toBeNull();

    const [decision] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_decisions
      WHERE business_action ->> 'type' = 'send_payment_link'
        AND turn_id = ${seeded.turn_id}::uuid
    `;
    expect(decision?.n).toBe(0);
  });

  it('returns one reservation under sequential and concurrent duplicates', async () => {
    const seeded = await seedConversationForAgentTurn();
    touchedConversations.push(seeded.conversation_id);
    const deps = { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id };
    const args = { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' as const };

    const [first, second] = await Promise.all([
      preparePaymentLinkToolV1(deps, args, { resolver }),
      preparePaymentLinkToolV1(deps, args, { resolver }),
    ]);
    const third = await preparePaymentLinkToolV1(deps, args, { resolver });

    expect(new Set([first.preparation_id, second.preparation_id, third.preparation_id]).size).toBe(1);
    expect([first, second].filter((result) => result.idempotency_result === 'applied')).toHaveLength(1);
    expect(third.idempotency_result).toBe('duplicate');
    expect(third.canonical_data).toEqual(first.canonical_data);
  });

  it('fails recoverably when the configured link is absent', async () => {
    const seeded = await seedConversationForAgentTurn();
    touchedConversations.push(seeded.conversation_id);
    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'monthly_12' },
      { resolver: { resolve: () => null } },
    );
    expect(result).toMatchObject({
      success: false,
      error_code: 'LINK_CONFIG_MISSING',
      recoverable: true,
      preparation_id: null,
    });
  });

  it('rejects an unknown plan before consulting configuration', async () => {
    const seeded = await seedConversationForAgentTurn();
    touchedConversations.push(seeded.conversation_id);
    const resolve = vi.fn(() => 'https://example.test/pay');
    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'unknown' },
      { resolver: { resolve } },
    );
    expect(result).toMatchObject({ success: false, error_code: 'INVALID_PAYMENT_PLAN' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('cannot reserve an artifact for a turn from another conversation', async () => {
    const first = await seedConversationForAgentTurn();
    const second = await seedConversationForAgentTurn();
    touchedConversations.push(first.conversation_id, second.conversation_id);

    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: first.turn_id, conversation_id: second.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );

    expect(result).toMatchObject({
      success: false,
      error_code: 'PREPARATION_STORE_UNAVAILABLE',
      preparation_id: null,
    });
    const [row] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
      FROM agent_turn_preparations
      WHERE turn_id = ${first.turn_id}::uuid
        AND conversation_id = ${second.conversation_id}::uuid
    `;
    expect(row?.n).toBe(0);
  });
});
