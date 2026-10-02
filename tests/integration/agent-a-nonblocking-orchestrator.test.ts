import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import {
  commitAgentDecision,
  type CommitDecisionInput,
} from '@/lib/services/decision.service';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'agent-a-nonblocking-orchestrator',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: '+5491112345678',
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Quiero que me llamen',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope;
}

run('Agent A nonblocking orchestrator diagnostics', () => {
  it('persists one immutable, structured action rejection without customer data', async () => {
    const inbound = await processInboundMessage(envelope());
    const diagnostics = {
      schema_version: 1 as const,
      generation_attempts: 1 as const,
      failure_stage: 'action_authorization' as const,
      failure_codes: ['ACTION_NOT_AUTHORIZED'],
      action_status: 'needs_input' as const,
    };
    const input = {
      turn_id: inbound.turn_id,
      trace_id: randomUUID(),
      turn_diagnostics: diagnostics,
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: 'Puedo seguir orientándote por aquí.',
        response_type: 'commercial_reply' as const,
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user' as const,
        reason_code: 'AGENT_A_PLANNERLESS_V2',
        confidence: 0.98,
        retrieval_used: null,
      },
      model: {
        provider: 'deepseek-direct' as const,
        model: 'deepseek-chat',
        prompt_version: 'agent-a-test',
      },
    } satisfies CommitDecisionInput & { turn_diagnostics: typeof diagnostics };

    const committed = await commitAgentDecision(input);
    const rows = await sql<Array<{ diagnostics: unknown }>>`
      SELECT diagnostics
      FROM agent_decisions
      WHERE turn_id = ${inbound.turn_id}::uuid
    `;

    expect(committed.status).toBe('committed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.diagnostics).toEqual(diagnostics);
    const serialized = JSON.stringify(rows[0]?.diagnostics);
    expect(serialized).not.toMatch(/Quiero que me llamen|5491112345678|@|token|secret/iu);

    await expect(sql`
      UPDATE agent_decisions
      SET diagnostics = ${sql.json({ ...diagnostics, action_status: 'authorized' })}
      WHERE turn_id = ${inbound.turn_id}::uuid
    `).rejects.toMatchObject({ code: '23514' });
  });
});
