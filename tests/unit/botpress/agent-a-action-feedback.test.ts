import { describe, expect, it, vi } from 'vitest';
import { continueAgentAAfterActionFeedbackV1, plannerlessActionFeedbackV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

function context(): AgentAContextV1 {
  return { schema_version: 1, identity: null,
    turn: { batch_messages: [{ id: 'm1', text: 'Dale, me llamas?' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    commercial_state: { selected_offering_code: null, selected_payment_plan: null, stage: 'course_selected',
      call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 1, awaiting_reply: 'call_or_chat', payment_reported: false },
    catalog: { available_offerings: [], selected_offering: null, areas: [], candidate_offerings: [], payment_plans: [] },
    capabilities: { may_reply: true, may_offer_call: false, may_request_call_now: false, may_present_payment_options: false,
      may_send_payment_link: false, authorized_payment_plan: null, intake_status: 'unknown', intake_missing: ['nombre', 'apellido'] },
  };
}

function reply(text: string) {
  return { proposal: { schema_version: 1 as const,
    move: { schema_version: 1 as const, move: 'unknown' as const, secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text], call_offer: null }, proposed_action: { type: 'none' as const },
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null },
    provider: 'deepseek-direct' as const, model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 as const };
}

describe('Agent A conversation from action feedback', () => {
  it('passes exact structural missing fields and preserves the original customer messages', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:nombre,MISSING_INTAKE:apellido',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const text = 'Antes de coordinarla, me dices tu nombre y apellido?';
    const generate = vi.fn(async () => reply(text));
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ conversation_only: true,
      context: expect.objectContaining({ turn: current.turn,
        turn_rejection: expect.objectContaining({ authorized_alternatives: {
          fact_ids: [], actions: ['none'], missing_information: ['nombre', 'apellido'],
        } }) }) }));
    expect(result.proposal.response.messages).toEqual([text]);
    expect(current.turn_rejection).toBeUndefined();
  });

  it('cannot repeat an effect or let a payment-intent move materialize a link implicitly', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current, failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:send_payment_link', rejection_id: '00000000-0000-4000-8000-000000000001' });
    const generated = reply('Me confirmas el plan que prefieres?');
    const generate = vi.fn(async () => ({ ...generated, proposal: { ...generated.proposal,
      move: { ...generated.proposal.move, move: 'request_payment_link' as const, payment_plan: 'one_time' as const } } }));
    await expect(continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate })).rejects.toThrow('ACTION_NOT_AUTHORIZED:continuation');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('never delivers an unsupported call promise or invents a second repair', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current, failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:apellido', rejection_id: '00000000-0000-4000-8000-000000000001' });
    const generate = vi.fn(async () => reply('Te llamo ahora.'));
    await expect(continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('preserves the first Agent A interpretation while the continuation owns its wording and citations', async () => {
    const current = context();
    const original = { ...reply('Te llamo ahora.').proposal,
      move: { schema_version: 1 as const, move: 'request_call' as const, secondary_moves: [], vetoes: [], confidence: 1 },
      proposed_action: { type: 'request_call_now' as const, reason: 'direct_request' as const },
      confirmed_phone: '+15551234567',
      used_fact_ids: ['initial-unused-fact'] };
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:apellido',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      original_proposal: original, apiKey: 'fixture', signal: new AbortController().signal,
      model: 'deepseek-v4-flash', generate: vi.fn(async () => reply('Me dices tu apellido para coordinarla?')) });
    expect(result.proposal.move).toEqual(original.move);
    expect(result.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.proposal.confirmed_phone).toBe('+15551234567');
    expect(result.proposal.response.messages).toEqual(['Me dices tu apellido para coordinarla?']);
    expect(result.proposal.used_fact_ids).toEqual([]);
  });
});
