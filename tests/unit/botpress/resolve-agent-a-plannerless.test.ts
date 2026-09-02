import { describe, expect, it, vi } from 'vitest';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import type {
  AgentAContextV1,
  AgentATurnProposalV1,
} from '../../../botpress-agent/src/schemas/agent-a-brain';

const NAME_FACT = 'offering:maquillaje-profesional:name:v1';
const DURATION_FACT = 'offering:maquillaje-profesional:duration:v1';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: {
      batch_messages: [{ id: 'm1', text: '¿Cuánto dura la formación?' }],
      recent_turns: [],
    },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'maquillaje-profesional', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 0, awaiting_reply: 'none', payment_reported: false,
    },
    catalog: {
      selected_offering: {
        code: 'maquillaje-profesional', display_name: 'Maquillaje Profesional',
        area_code: 'moda-belleza',
        facts: [
          { id: NAME_FACT, kind: 'offering_name', value: 'Maquillaje Profesional' },
          { id: DURATION_FACT, kind: 'offering_duration', value: '38 clases' },
        ],
      },
      areas: [], candidate_offerings: [], payment_plans: [],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: true,
      may_present_payment_options: true, may_send_payment_link: false,
      authorized_payment_plan: null, intake_missing: [],
    },
  };
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
      course_reference: 'Maquillaje Profesional', confidence: 1,
    },
    response: { messages: ['La formación tiene 38 clases.'], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: [NAME_FACT, DURATION_FACT],
    used_memory_ids: [], memory_candidates: [], repair_of: null,
    ...overrides,
  } as AgentATurnProposalV1;
}

function generated(value: AgentATurnProposalV1) {
  return {
    proposal: value,
    provider: 'deepseek-direct' as const,
    model: 'deepseek-v4-flash', latency_ms: 100, attempt_count: 1 as const,
  };
}

describe('resolveAgentAPlannerlessProposalV2', () => {
  it('accepts valid model-owned copy without invoking a planner or repair', async () => {
    const repair = vi.fn();
    const initial = generated(proposal());

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).not.toHaveBeenCalled();
    expect(result.effective).toBe(initial);
    expect(result.evidence).toEqual({
      rejection_codes: [], repair_attempted: false, repaired: false,
      proposal_generation_calls: 1,
    });
  });

  it('returns an uncited canonical value to DeepSeek once and accepts its cited rewrite', async () => {
    const initial = generated(proposal({ used_fact_ids: [NAME_FACT] }));
    const repaired = generated(proposal({
      response: { messages: ['Dura 38 clases.'], call_offer: null },
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(repaired);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0]?.[0]).toMatchObject({
      rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'duration' }],
      authorized_alternatives: { fact_ids: expect.arrayContaining([NAME_FACT, DURATION_FACT]) },
    });
    expect(result.effective).toBe(repaired);
    expect(result.evidence).toMatchObject({
      rejection_codes: ['FACT_VALUE_MISMATCH'], repair_attempted: true,
      repaired: true, proposal_generation_calls: 2,
    });
  });

  it('never requests a second rewrite when the only rewrite remains invalid', async () => {
    const initial = generated(proposal({ used_fact_ids: [NAME_FACT] }));
    const invalidRepair = generated(proposal({
      used_fact_ids: [NAME_FACT],
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    }));
    const repair = vi.fn().mockResolvedValue(invalidRepair);

    const result = await resolveAgentAPlannerlessProposalV2({
      initial, context: context(), repair_enabled: true, repair,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.effective).toBe(initial);
    expect(result.evidence).toMatchObject({ repair_attempted: true, repaired: false });
  });
});
