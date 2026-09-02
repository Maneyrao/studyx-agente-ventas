import { describe, expect, it } from 'vitest';
import { AgentATurnCommitV2Schema } from '@/features/conversation/adapters/agent-turn-v2-schema';
import { AgentATurnCommitV2Schema as BotpressAgentATurnCommitV2Schema } from '../../../botpress-agent/src/schemas/agent-turn-v2';
import { CommitDecisionInputSchema } from '../../../botpress-agent/src/schemas/contracts';

const proposal = {
  schema_version: 1,
  move: {
    schema_version: 1,
    move: 'greeting',
    secondary_moves: [],
    vetoes: [],
    confidence: 0.98,
  },
  response: {
    messages: ['¡Hola! ¿Qué te gustaría aprender?'],
    call_offer: 'Si te resulta más cómodo, podemos coordinar una llamada.',
  },
  proposed_action: { type: 'none' },
  used_fact_ids: [],
  used_memory_ids: [],
  repair_of: null,
  memory_candidates: [],
};

describe('AgentATurnCommitV2 contract', () => {
  it('carries the model-owned turn without a conversational plan', () => {
    const payload = { schema_version: 2, proposal };

    expect(AgentATurnCommitV2Schema.parse(payload)).toEqual(
      BotpressAgentATurnCommitV2Schema.parse(payload),
    );
  });

  it.each(['plan', 'response_goal', 'canonical_fact_requests', 'allowed_business_action'])(
    'rejects planner-owned field %s',
    (field) => {
      const payload = { schema_version: 2, proposal, [field]: {} };

      expect(AgentATurnCommitV2Schema.safeParse(payload).success).toBe(false);
      expect(BotpressAgentATurnCommitV2Schema.safeParse(payload).success).toBe(false);
    },
  );

  it('is accepted by the Botpress commit boundary as an alternative to pipeline v1', () => {
    const parsed = CommitDecisionInputSchema.parse({
      turn_id: '10000000-0000-4000-8000-000000000004',
      trace_id: '10000000-0000-4000-8000-000000000005',
      agent_turn_v2: { schema_version: 2, proposal },
      conversation_pipeline_v1: null,
      decision: {
        schema_version: 4,
        intent: 'social', kind: 'reply', response: proposal.response.messages[0],
        response_type: 'social_reply', confidence: 0.98, reason_code: 'AGENT_A_BRAIN_V1',
        business_action: null, memory_candidates: [], missing_information: [],
        next_state: 'waiting_user', retrieval_used: null,
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-chat', prompt_version: 'test' },
    });

    expect(parsed.agent_turn_v2).toEqual({ schema_version: 2, proposal });
  });
});
