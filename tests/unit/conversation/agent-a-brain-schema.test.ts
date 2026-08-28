import { describe, expect, it } from 'vitest';
import { AgentATurnProposalV1Schema } from '@/features/conversation/adapters/agent-a-brain-schema';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    move: {
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.95,
    },
    response: { messages: ['Podés elegir el plan que te resulte más cómodo.'] },
    proposed_action: { type: 'none' },
    used_fact_ids: ['payment:monthly_6:label'],
    used_memory_ids: [],
    memory_candidates: [{
      type: 'constraint',
      key: 'availability',
      value: 'trabaja de noche',
      source_quote: 'Trabajo de noche',
      confidence: 0.9,
    }],
    ...overrides,
  };
}

describe('AgentATurnProposalV1Schema', () => {
  it('accepts one to three customer-facing messages', () => {
    for (const messages of [['uno'], ['uno', 'dos'], ['uno', 'dos', 'tres']]) {
      expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages } })).success).toBe(true);
    }
  });

  it('rejects zero or four customer-facing messages', () => {
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: [] } })).success).toBe(false);
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: ['1', '2', '3', '4'] } })).success).toBe(false);
  });

  it('rejects URLs from any proposed response message', () => {
    expect(AgentATurnProposalV1Schema.safeParse(proposal({
      response: { messages: ['Mirá http://example.test'] },
    })).success).toBe(false);
  });

  it('rejects duplicate evidence identifiers', () => {
    expect(AgentATurnProposalV1Schema.safeParse(proposal({
      used_fact_ids: ['fact-1', 'fact-1'],
    })).success).toBe(false);
    expect(AgentATurnProposalV1Schema.safeParse(proposal({
      used_memory_ids: ['memory-1', 'memory-1'],
    })).success).toBe(false);
  });
});
