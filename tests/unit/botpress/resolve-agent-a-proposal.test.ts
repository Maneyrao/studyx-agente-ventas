import { describe, expect, it, vi } from 'vitest';
import { resolveAgentAProposalV1 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-proposal';
import type {
  AgentAContextV1,
  AgentATurnProposalV1,
} from '../../../botpress-agent/src/schemas/agent-a-brain';

const FACT_ID = 'offering:redes-informaticas:name:v1';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'm1', text: 'quiero avanzar' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false,
    },
    obligations: { stage: 'course_selected', owes: [], not_yet: [] },
    catalog: {
      available_offerings: [],
      selected_offering: {
        code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: FACT_ID, kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      areas: [], candidate_offerings: [], payment_plans: [],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false,
      authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
    },
  };
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
      course_reference: 'Redes Informáticas', confidence: 0.95,
    },
    response: { messages: ['Te cuento sobre Redes Informáticas.'], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: [FACT_ID],
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: null,
    ...overrides,
  } as AgentATurnProposalV1;
}

function generated(value: AgentATurnProposalV1) {
  return {
    proposal: value,
    provider: 'deepseek-direct' as const,
    model: 'deepseek-v4-flash',
    latency_ms: 120,
    attempt_count: 1 as const,
  };
}

describe('resolveAgentAProposalV1', () => {
  it('accepts a valid first proposal without spending a repair call', async () => {
    const repair = vi.fn();
    const result = await resolveAgentAProposalV1({
      initial: generated(proposal()),
      context: context(),
      response_goal: 'continue_course_advice',
      planned_fact_ids: [FACT_ID],
      repair_enabled: true,
      repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.evidence).toEqual({
      rejection_codes: [], repair_attempted: false, repaired: false,
      proposal_generation_calls: 1,
    });
    expect(result.composition.narrative.opening).toBe('Te cuento sobre Redes Informáticas.');
  });

  it('repairs once and revalidates the replacement against the same planned facts', async () => {
    const first = proposal({
      proposed_action: {
        type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_6',
      },
    });
    const repaired = proposal({
      response: { messages: ['Primero elegimos una opción de pago.'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    });
    const repair = vi.fn().mockResolvedValue(generated(repaired));

    const result = await resolveAgentAProposalV1({
      initial: generated(first), context: context(), response_goal: 'continue_course_advice',
      planned_fact_ids: [FACT_ID], repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0]?.[0]).toMatchObject({
      rejection_id: '00000000-0000-4000-8000-000000000001',
      authorized_alternatives: { fact_ids: [FACT_ID] },
    });
    expect(result.effective.proposal).toBe(repaired);
    expect(result.evidence).toMatchObject({
      repair_attempted: true, repaired: true, proposal_generation_calls: 2,
    });
  });

  it('never opens a second repair when the replacement is still invalid', async () => {
    const invalidAction = {
      type: 'send_payment_link' as const,
      offering_code: 'redes-informaticas',
      payment_plan: 'monthly_6' as const,
    };
    const invalid = proposal({ proposed_action: invalidAction });
    const repair = vi.fn().mockResolvedValue(generated(proposal({
      proposed_action: invalidAction,
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    })));

    const result = await resolveAgentAProposalV1({
      initial: generated(invalid), context: context(), response_goal: 'continue_course_advice',
      planned_fact_ids: [FACT_ID], repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.evidence).toMatchObject({
      repair_attempted: true, repaired: false, proposal_generation_calls: 2,
    });
    expect(result.effective.proposal).toBe(invalid);
  });

  it('does not retry a proposal that already declares a repair', async () => {
    const alreadyRepaired = proposal({
      proposed_action: {
        type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_6',
      },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000009', attempt: 1 },
    });
    const repair = vi.fn();

    const result = await resolveAgentAProposalV1({
      initial: generated(alreadyRepaired), context: context(), response_goal: 'continue_course_advice',
      planned_fact_ids: [FACT_ID], repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.evidence.proposal_generation_calls).toBe(1);
    expect(result.evidence.repaired).toBe(false);
  });
});
