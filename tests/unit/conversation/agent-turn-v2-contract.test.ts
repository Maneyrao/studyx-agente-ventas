import { describe, expect, it } from 'vitest';
import { AgentATurnCommitV2Schema } from '@/features/conversation/adapters/agent-turn-v2-schema';
import { AgentATurnCommitV2Schema as BotpressAgentATurnCommitV2Schema } from '../../../botpress-agent/src/schemas/agent-turn-v2';

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
});
