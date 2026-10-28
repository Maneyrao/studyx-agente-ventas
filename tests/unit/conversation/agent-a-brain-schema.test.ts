import { describe, expect, it } from 'vitest';
import { AgentATurnProposalV1Schema } from '@/features/conversation/adapters/agent-a-brain-schema';
import { AgentATurnProposalV1Schema as BotpressAgentATurnProposalV1Schema } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { DecisionBusinessActionSchema } from '../../../botpress-agent/src/schemas/contracts';

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
  const directAcceptance = {
    type: 'accept_promotion', promotion_code: 'PRM-1', interest_offering_code: 'redes',
    promotion_cycle_id: 'cycle-1', offer_version: 2,
  };
  const actions = [
    { type: 'offer_course_bonus', bonus_offering_code: 'ingles_1', interest_offering_code: 'redes' },
    directAcceptance,
    { type: 'accept_promotion' },
  ];

  it.each(actions)('preserves direct and legacy action payloads at every boundary: %j', (proposed_action) => {
    for (const schema of [AgentATurnProposalV1Schema, BotpressAgentATurnProposalV1Schema]) {
      expect(schema.parse(proposal({ proposed_action })).proposed_action).toEqual(proposed_action);
    }
    expect(DecisionBusinessActionSchema.parse(proposed_action)).toEqual(proposed_action);
  });

  it.each([
    ...['promotion_code', 'interest_offering_code', 'promotion_cycle_id', 'offer_version'].map((field) => ({
      ...directAcceptance, [field]: undefined,
    })),
    { ...directAcceptance, offer_version: 0 },
    { ...directAcceptance, offer_version: 1.5 },
    { ...directAcceptance, promotion_cycle_id: '' },
    { ...directAcceptance, url: 'https://example.test' },
    { type: 'offer_course_bonus', bonus_offering_codes: ['ingles_1', 'ingles_2'], interest_offering_code: 'redes' },
    { type: 'offer_course_bonus', bonus_offering_code: '', interest_offering_code: 'redes' },
  ])('rejects incomplete, invalid or operational direct actions: %j', (proposed_action) => {
    for (const schema of [AgentATurnProposalV1Schema, BotpressAgentATurnProposalV1Schema]) {
      expect(schema.safeParse(proposal({ proposed_action })).success).toBe(false);
    }
    expect(DecisionBusinessActionSchema.safeParse(proposed_action).success).toBe(false);
  });

  it('keeps the structured move and action contract for direct proposals', () => {
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ move: 'negotiate', proposed_action: actions[0] })).success).toBe(false);
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ proposed_action: 'offer_course_bonus' })).success).toBe(false);
  });

  it('accepts one or two customer-facing messages', () => {
    for (const messages of [['uno'], ['uno', 'dos']]) {
      expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages } })).success).toBe(true);
    }
  });

  it('rejects an empty answer and more than two authored bubbles', () => {
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: [] } })).success).toBe(false);
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: ['1', '2', '3'] } })).success).toBe(false);
  });

  it('accepts a separate call offer without making message count a validity rule', () => {
    const call_offer = 'Si querés, podemos coordinar una llamada.';
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: ['Información.'], call_offer } })).success).toBe(true);
    expect(AgentATurnProposalV1Schema.safeParse(proposal({ response: { messages: ['Información.', 'Más información.'], call_offer } })).success).toBe(true);
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

  it.each([
    { type: 'schedule_price_objection_checkin', reason: 'price_objection' },
    {
      type: 'request_promotion_review', reason: 'persistent_price_objection',
      bonus_offering_code: 'fotografia_celulares_tiendas_online',
    },
    { type: 'accept_promotion' },
    {
      type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: 'monthly_12',
      promotion_code: 'ingles_1_mas_ingles_2',
    },
  ])('keeps backend and Botpress promotion action schemas in parity: $type', (proposed_action) => {
    const input = proposal({ proposed_action });
    expect(AgentATurnProposalV1Schema.safeParse(input).success).toBe(true);
    expect(BotpressAgentATurnProposalV1Schema.safeParse(input).success).toBe(true);
  });

  it('accepts one canonical gift choice but rejects operational details on review actions', () => {
    const selected = proposal({
      proposed_action: {
        type: 'request_promotion_review', reason: 'persistent_price_objection',
        bonus_offering_code: 'fotografia_celulares_tiendas_online',
      },
    });
    expect(AgentATurnProposalV1Schema.safeParse(selected).success).toBe(true);
    expect(BotpressAgentATurnProposalV1Schema.safeParse(selected).success).toBe(true);

    for (const extra of [
      { bonus_offering_codes: ['ingles_2', 'ingles_3'] }, { delay_seconds: 60 }, { amount: 360 },
      { url: 'https://example.test' }, { contact_id: '00000000-0000-4000-8000-000000000001' },
    ]) {
      const input = proposal({
        proposed_action: { type: 'request_promotion_review', reason: 'persistent_price_objection', ...extra },
      });
      expect(AgentATurnProposalV1Schema.safeParse(input).success).toBe(false);
      expect(BotpressAgentATurnProposalV1Schema.safeParse(input).success).toBe(false);
    }
  });
});
