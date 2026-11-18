import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

// Owner D2 2026-11-18: the last-resort question the bot commits as a plain decision
// (commercial_reply, no agent_turn_v2) in a plannerless turn must be accepted by the backend.
run('exhausted link recovery question commit', () => {
  it.each([
    ['course_selection', 'PAYMENT_COURSE_REQUIRED', 'Desde qué nivel arrancas: Inglés 1, Inglés 2, Inglés 3 o Inglés IV?'],
    ['payment_plan', 'PAYMENT_PLAN_REQUIRED', 'Cómo prefieres pagar, en cuotas o en un solo pago?'],
  ])('commits the %s question with agent_turn_v2 null', async (missing, reason_code, response) => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: null, intake_complete: true });
    const result = await commitAgentDecision({
      turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      agent_turn_v2: null, conversation_pipeline_v1: null,
      decision: {
        schema_version: 4, intent: 'commercial', kind: 'reply', response, response_type: 'commercial_reply',
        business_action: null, memory_candidates: [], missing_information: [missing], next_state: 'waiting_user',
        reason_code, confidence: 1, retrieval_used: null,
      } as never,
      model: { provider: 'botpress', model: 'policy:payment-requirements-question', prompt_version: 'studyx-agent-a-sales-v17' } as never,
    } as never);
    expect(result.status).toBe('committed');
    const out = await db!`SELECT content FROM messages WHERE in_reply_to=${f.turn_id} AND direction='outbound'`;
    expect(out.map((row) => row.content)).toEqual([response]);
  });
});
