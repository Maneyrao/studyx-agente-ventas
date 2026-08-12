import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, DecisionPolicyError } from '@/lib/services/decision.service';
import { sql } from '@/lib/db/orchestrator';

/**
 * Fase 6 against a real database: v3 is accepted, persisted and constrained,
 * v2 keeps working unchanged, and the two things this product must never do —
 * hand off to a human, take an outward commercial action — are refused by the
 * backend even when the agent asks for them.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(text: string): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-v3',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope;
}

async function seedTurn(text = 'Me parece caro el curso') {
  const context = await processInboundMessage(envelope(text));
  return context.turn_id;
}

function v3Decision(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 3 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response: 'Entiendo, te muestro las opciones de pago disponibles.',
    response_type: 'commercial_reply' as const,
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed' as const,
    reason_code: 'ANSWER_OBJECTION',
    confidence: 0.88,
    retrieval_used: { kb: true, long_term_memory: false, summary_version: 0 },
    ...overrides,
  };
}

run('decision v3 persistence', () => {
  it('commits a v3 decision with retrieval_used', async () => {
    const turnId = await seedTurn();
    const result = await commitAgentDecision({
      turn_id: turnId,
      trace_id: randomUUID(),
      decision: v3Decision(),
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v3' },
    });

    expect(result.status).toBe('committed');
    const rows = await sql<Array<{
      schema_version: number;
      business_action: unknown;
      retrieval_used: { kb: boolean; long_term_memory: boolean; summary_version: number | null };
    }>>`
      SELECT schema_version, business_action, retrieval_used
      FROM agent_decisions WHERE id = ${result.decision_id}::uuid
    `;
    expect(rows[0].schema_version).toBe(3);
    expect(rows[0].business_action).toBeNull();
    // Stored as a jsonb object, not a JSON string: the canonical-persistence
    // rule from BUG-01 applies to the new column too.
    expect(rows[0].retrieval_used).toEqual({
      kb: true,
      long_term_memory: false,
      summary_version: 0,
    });
  });

  it('stores a permitted, observational business action', async () => {
    const turnId = await seedTurn();
    const result = await commitAgentDecision({
      turn_id: turnId,
      trace_id: randomUUID(),
      decision: v3Decision({
        business_action: { type: 'log_objection', objection_key: 'precio', quote: 'Me parece caro el curso' },
      }),
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v3' },
    });

    const rows = await sql<Array<{ business_action: { type: string; objection_key: string } }>>`
      SELECT business_action FROM agent_decisions WHERE id = ${result.decision_id}::uuid
    `;
    expect(rows[0].business_action).toMatchObject({ type: 'log_objection', objection_key: 'precio' });
  });

  it('refuses to commit a human handoff', async () => {
    const turnId = await seedTurn('Quiero hablar con una persona');
    await expect(
      commitAgentDecision({
        turn_id: turnId,
        trace_id: randomUUID(),
        decision: v3Decision({
          intent: 'human_request',
          response_type: 'automation_only',
          next_state: 'waiting_user',
          business_action: { type: 'escalate_to_human', reason: 'el cliente lo pidió' },
        }),
        model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v3' },
      })
    ).rejects.toMatchObject({ reason: 'HUMAN_HANDOFF_FORBIDDEN' });

    const rows = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM agent_decisions WHERE turn_id = ${turnId}::uuid
    `;
    expect(rows[0].count).toBe('0');
  });

  it.each([
    ['send_pricing_info', { type: 'send_pricing_info', sku: 'PY-8' }],
    ['schedule_followup', { type: 'schedule_followup', when_iso: '2026-09-01T10:00:00.000Z' }],
  ])('refuses the outward-facing action %s', async (_label, action) => {
    const turnId = await seedTurn();
    await expect(
      commitAgentDecision({
        turn_id: turnId,
        trace_id: randomUUID(),
        decision: v3Decision({ business_action: action }),
        model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v3' },
      })
    ).rejects.toBeInstanceOf(DecisionPolicyError);
  });

  it('keeps the database as the last line of defence against a forbidden action', async () => {
    const turnId = await seedTurn();
    const result = await commitAgentDecision({
      turn_id: turnId,
      trace_id: randomUUID(),
      decision: v3Decision(),
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v3' },
    });

    // Bypassing the application entirely still cannot produce an escalation.
    await expect(
      sql`
        UPDATE agent_decisions
        SET business_action = ${sql.json({ type: 'escalate_to_human', reason: 'x' })}
        WHERE id = ${result.decision_id}::uuid
      `
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('still accepts a v2 decision unchanged', async () => {
    const turnId = await seedTurn();
    const result = await commitAgentDecision({
      turn_id: turnId,
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'social',
        kind: 'reply',
        response: 'Hola, ¿en qué te ayudo?',
        response_type: 'social_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'GREETING',
        confidence: 0.95,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'studyx-decision-v2' },
    });

    const rows = await sql<Array<{ schema_version: number; retrieval_used: unknown }>>`
      SELECT schema_version, retrieval_used FROM agent_decisions WHERE id = ${result.decision_id}::uuid
    `;
    expect(rows[0]).toMatchObject({ schema_version: 2, retrieval_used: null });
  });
});
