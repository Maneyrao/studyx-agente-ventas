import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  buildSafeAgentABrainCompositionV1,
  parseAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'message-1', text: 'Dale, mandame el link' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: 'monthly_12',
      stage: 'plan_selected', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 1, awaiting_reply: 'payment_confirmation',
    },
    catalog: {
      selected_offering: {
        code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
      candidate_offerings: [],
      payment_plans: [{ code: 'monthly_12', fact_id: 'payment:redes-informaticas:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' }],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: true,
      authorized_payment_plan: 'monthly_12',
    },
  };
}

function proposal(messages: readonly string[]) {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
      payment_plan: 'monthly_12', confidence: 0.96,
    },
    response: { messages: [...messages], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: [],
    used_memory_ids: [],
    memory_candidates: [],
  };
}

function compose(responseGoal: Parameters<typeof buildSafeAgentABrainCompositionV1>[0]['response_goal'], messages: readonly string[]) {
  const ctx = context();
  return buildSafeAgentABrainCompositionV1({
    proposal: parseAgentATurnProposalV1(proposal(messages), ctx),
    context: ctx,
    response_goal: responseGoal,
    planned_fact_ids: [],
  });
}

describe('Agent A brain keeps the model as author of the copy', () => {
  it('keeps a value-free enrollment request instead of the canned confirmation', () => {
    const written = 'Para la inscripción necesito nombre completo, correo electrónico y ciudad con estado y zip code.';

    const composition = compose('confirm_payment_link', [written]);

    expect(composition.narrative.opening).toBe(written);
  });

  it('keeps a value-free deferral acknowledgement written for this customer', () => {
    const written = 'Tranquilo, no hay apuro. Te dejo la preinscripción cargada y retomamos cuando puedas.';

    const composition = compose('acknowledge_payment_deferral', [written]);

    expect(composition.narrative.opening).toBe(written);
  });

  it('keeps a value-free plan confirmation that actually answers the customer', () => {
    const written = 'Sí, ese es el plan que dejamos anotado para vos.';

    const composition = compose('confirm_selected_plan', [written]);

    expect(composition.narrative.opening).toBe(written);
  });

  it('falls back to the safe constant only when the model copy carries an unauthorized value', () => {
    const composition = compose('confirm_selected_plan', ['Perfecto, elegiste 12 cuotas de USD 30.']);

    expect(composition.narrative.opening).toBe('Queda registrada tu elección. Avisame cuando quieras avanzar.');
    expect(composition.narrative.opening).not.toMatch(/USD|30|cuotas/iu);
  });

  it('does not emit the same text for two different safe deferral wordings', () => {
    const first = compose('acknowledge_payment_deferral', ['Sin problema, lo dejamos para cuando estés listo.']);
    const second = compose('acknowledge_payment_deferral', ['De acuerdo, avisame cuando quieras retomarlo.']);

    expect(first.narrative.opening).not.toBe(second.narrative.opening);
  });
});
