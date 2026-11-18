import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { paymentRequirementsQuestionDecision } from '../../botpress-agent/src/utils/decision-policy';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const LEVELS = ['Inglés 1', 'Inglés 2', 'Inglés 3', 'Inglés IV'].map((display_name, at) => ({ code: `ingles_${at + 1}`, display_name }));
const claim = (over: Record<string, unknown>) => ({ policy: { allowed_response_types: ['commercial_reply'] },
  contact_intake_missing: [], ...over }) as never;
const requirement = (missing: string[]) => [{ action: 'send_payment_link', ready: false, missing,
  options: { course_selection_kind: 'levels', course_selection: LEVELS, payment_plan: ['monthly_12', 'monthly_6', 'one_time'] } }];

// Owner D2 2026-11-18: the questions are produced by the real bot function and the backend must
// deliver each one verbatim (egress guard neither trims nor replaces it) in a plannerless turn.
run('exhausted link recovery question commit', () => {
  it.each([
    ['level', claim({ action_requirements: requirement(['course_selection', 'payment_plan']) }),
      'Desde qué nivel arrancas: Inglés 1, Inglés 2, Inglés 3 o Inglés IV?'],
    ['plan', claim({ action_requirements: requirement(['payment_plan']) }),
      'Cómo prefieres pagar: en cuotas mensuales o en un solo pago?'],
    ['contact', claim({ contact_intake_missing: ['correo', 'telefono'] }),
      'Para preparar el enlace me falta tu correo y tu teléfono con código de país. Me lo compartes?'],
  ])('delivers the %s question as built by paymentRequirementsQuestionDecision', async (_name, claimed, expected) => {
    const decision = paymentRequirementsQuestionDecision(claimed)!;
    expect(decision.response).toBe(expected);
    const f = await seedConversationForAgentTurn({ selected_offering_code: null, intake_complete: true });
    const result = await commitAgentDecision({
      turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      agent_turn_v2: null, conversation_pipeline_v1: null, decision: decision as never,
      model: { provider: 'botpress', model: 'policy:payment-requirements-question', prompt_version: 'studyx-agent-a-sales-v17' } as never,
    } as never);
    expect(result.status).toBe('committed');
    const out = await db!`SELECT content FROM messages WHERE in_reply_to=${f.turn_id} AND direction='outbound'`;
    expect(out.map((row) => row.content)).toEqual([expected]);
  });
});
