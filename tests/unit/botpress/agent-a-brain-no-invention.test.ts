import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  buildSafeAgentABrainCompositionV1,
  parseAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import {
  assembleCanonicalConversationResponseV1,
  CanonicalResponseAssemblyError,
} from '@/features/conversation/domain/canonical-response-assembler';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'message-1', text: '¿Cómo puedo pagar?' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 1, awaiting_reply: 'payment_plan',
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

function compose(
  responseGoal: Parameters<typeof buildSafeAgentABrainCompositionV1>[0]['response_goal'],
  messages: readonly string[],
) {
  const ctx = context();
  return buildSafeAgentABrainCompositionV1({
    proposal: parseAgentATurnProposalV1({
      schema_version: 1,
      move: {
        schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
        confidence: 0.95,
      },
      response: { messages: [...messages], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
      used_memory_ids: [],
      memory_candidates: [],
    }, ctx),
    context: ctx,
    response_goal: responseGoal,
    planned_fact_ids: [],
  });
}

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1, next_stage: 'course_selected', response_goal: 'present_payment_options',
    canonical_fact_requests: [], allowed_business_action: { type: 'none' }, missing_information: [],
    should_offer_call: false, next_call_preference: 'chat', next_call_offer_status: 'declined',
    next_call_offer_count: 1, next_awaiting_reply: 'payment_plan', payment_reported: false,
    selected_offering_code: 'redes-informaticas', selected_payment_plan: null, ...overrides,
  };
}

const labelFact: CanonicalFactV1 = {
  id: 'payment:redes-informaticas:monthly_12:label:v1',
  kind: 'payment_plan_label',
  source: 'business_snapshot',
  value: '12 pagos mensuales de USD 30',
  offering_code: 'redes-informaticas',
  payment_plan: 'monthly_12',
};
const labelRef: CanonicalFactRefV1 = {
  id: labelFact.id, kind: labelFact.kind,
  offering_code: labelFact.offering_code, payment_plan: labelFact.payment_plan,
};

describe('preserving model copy never becomes a route for invention', () => {
  it('drops an invented price from a preserved payment narrative', () => {
    const composition = compose('present_payment_options', [
      'Te puedo dejar un plan especial de 4 cuotas de USD 50.',
      'Contame cómo preferís avanzar.',
    ]);

    expect(JSON.stringify(composition)).not.toContain('USD 50');
    expect(composition.narrative.opening).toBe('Contame cómo preferís avanzar.');
  });

  it('drops an invented payment method from a preserved deferral narrative', () => {
    const composition = compose('acknowledge_payment_deferral', [
      'Si querés te lo tomo por transferencia a USD 300 y listo.',
    ]);

    expect(JSON.stringify(composition)).not.toContain('USD 300');
    expect(composition.narrative.opening).toBe('De acuerdo, lo dejamos para más adelante.');
  });

  it('refuses to assemble a narrative that writes its own link', () => {
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan(),
      fact_refs: [labelRef],
      facts: [labelFact],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Pagá acá: https://buy.stripe.com/inventado',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: [labelFact.id],
      },
    })).toThrowError(CanonicalResponseAssemblyError);
  });

  it('refuses a preserved opening that states a canonical value the plan never requested', () => {
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'explain_selected_course' }),
      fact_refs: [labelRef],
      facts: [labelFact],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Tenés 12 pagos mensuales de USD 30 disponibles.',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: [],
      },
    })).toThrowError(expect.objectContaining({ code: 'COMPOSER_UNCITED_CANONICAL_FACT' }));
  });
});
