import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  expireStalePreparationsV1,
  prepareCallRequestToolV1,
  prepareLeadProjectionToolV1,
  preparePaymentLinkToolV1,
} from '@/features/conversation/application/agent-tools-prepare';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const resolver = { resolve: () => 'https://buy.stripe.com/test_agent_loop_crash' };
const expirationAgeMs = 365 * 24 * 60 * 60 * 1_000;

run('crash between Agent Loop preparation and commit', () => {
  it('expires only the stale uncommitted reservation and leaves no commercial effect', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const stale = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    const committed = await prepareCallRequestToolV1(
      {
        db: sql,
        turn_id: seeded.turn_id,
        conversation_id: seeded.conversation_id,
        contact_id: seeded.contact_id,
      },
      { reason: 'customer_request' },
    );
    const fresh = await prepareLeadProjectionToolV1({
      db: sql,
      turn_id: seeded.second_turn_id,
      conversation_id: seeded.conversation_id,
    });
    expect([stale.success, committed.success, fresh.success]).toEqual([true, true, true]);

    await sql`
      UPDATE agent_turn_preparations
      SET created_at = now() - interval '2 years'
      WHERE id IN (${stale.preparation_id}::uuid, ${committed.preparation_id}::uuid)
    `;
    await sql`
      UPDATE agent_turn_preparations
      SET committed_at = now()
      WHERE id = ${committed.preparation_id}::uuid
    `;

    const [before] = await sql<Array<{
      decisions: number;
      outbounds: number;
      calls: number;
      payment_jobs: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT count(*)::int FROM messages
          WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT count(*)::int FROM call_sessions
          WHERE conversation_id = ${seeded.conversation_id}::uuid) AS calls,
        (SELECT count(*)::int FROM payment_projection_jobs AS job
          JOIN agent_decisions AS decision ON decision.id = job.decision_id
          WHERE decision.turn_id = ${seeded.turn_id}::uuid) AS payment_jobs
    `;
    expect(before).toEqual({ decisions: 0, outbounds: 0, calls: 0, payment_jobs: 0 });

    const expired = await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      return expireStalePreparationsV1(transaction, expirationAgeMs);
    });
    expect(Number(expired)).toBeGreaterThanOrEqual(1);

    const surviving = await sql<Array<{ id: string; committed: boolean }>>`
      SELECT id, committed_at IS NOT NULL AS committed
      FROM agent_turn_preparations
      WHERE id IN (
        ${stale.preparation_id}::uuid,
        ${committed.preparation_id}::uuid,
        ${fresh.preparation_id}::uuid
      )
      ORDER BY id
    `;
    expect(surviving).toEqual(expect.arrayContaining([
      { id: committed.preparation_id, committed: true },
      { id: fresh.preparation_id, committed: false },
    ]));
    expect(surviving).toHaveLength(2);
    expect(surviving.some((row) => row.id === stale.preparation_id)).toBe(false);

    const recovered = await preparePaymentLinkToolV1(
      {
        db: sql,
        turn_id: seeded.second_turn_id,
        conversation_id: seeded.conversation_id,
      },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver },
    );
    expect(recovered).toMatchObject({ success: true, idempotency_result: 'applied' });
    await commitAgentTurnV3(sql, {
      turn_id: seeded.second_turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [
          { type: 'narrative', text: 'Perfecto, podés completar el pago acá:' },
          { type: 'artifact', preparation_id: recovered.preparation_id! },
        ],
        commit_preparations: [recovered.preparation_id!],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { stage: 'payment_link_sent' },
        },
        response_type: 'commercial_reply',
      },
    });
    const [recoveryProof] = await sql<Array<{ jobs: number; decisions: number }>>`
      SELECT
        (SELECT count(*)::int FROM payment_projection_jobs AS job
          JOIN agent_decisions AS decision ON decision.id = job.decision_id
          WHERE decision.turn_id = ${seeded.second_turn_id}::uuid) AS jobs,
        (SELECT count(*)::int FROM agent_decisions
          WHERE turn_id = ${seeded.second_turn_id}::uuid) AS decisions
    `;
    expect(recoveryProof).toEqual({ jobs: 1, decisions: 1 });
    await sql`
      DELETE FROM agent_turn_preparations
      WHERE id IN (${committed.preparation_id}::uuid, ${fresh.preparation_id}::uuid)
    `;
  });
});
