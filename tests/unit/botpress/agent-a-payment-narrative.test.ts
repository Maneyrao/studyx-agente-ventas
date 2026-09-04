import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  buildSafeAgentABrainCompositionV1,
  parseAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

const OFFERING = 'redes-informaticas';
const LABEL_12 = `payment:${OFFERING}:monthly_12:label:v1`;
const LABEL_6 = `payment:${OFFERING}:monthly_6:label:v1`;
const LABEL_ONCE = `payment:${OFFERING}:one_time:label:v1`;

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'message-1', text: '¿Cuál es la cuota más baja?' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: OFFERING, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 1, awaiting_reply: 'payment_plan', payment_reported: false,
    },
    obligations: { stage: 'course_selected', owes: [], not_yet: [] },
    catalog: {
      selected_offering: {
        code: OFFERING, display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: `offering:${OFFERING}:name:v1`, kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
      candidate_offerings: [],
      payment_plans: [
        { code: 'monthly_12', fact_id: LABEL_12, label: '12 pagos mensuales de USD 30' },
        { code: 'monthly_6', fact_id: LABEL_6, label: '6 pagos mensuales de USD 60' },
        { code: 'one_time', fact_id: LABEL_ONCE, label: 'un pago único de USD 360' },
      ],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false,
      authorized_payment_plan: null,
      intake_status: 'known' as const,
      intake_missing: [],
    },
  };
}

function compose(
  responseGoal: Parameters<typeof buildSafeAgentABrainCompositionV1>[0]['response_goal'],
  messages: readonly string[],
  usedFactIds: readonly string[],
) {
  const ctx = context();
  const plannedFactIds = [LABEL_12, LABEL_6, LABEL_ONCE, `offering:${OFFERING}:name:v1`];
  return buildSafeAgentABrainCompositionV1({
    proposal: parseAgentATurnProposalV1({
      schema_version: 1,
      move: {
        schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
        confidence: 0.96,
      },
      response: { messages: [...messages], call_offer: null },
      proposed_action: { type: 'none' },
      used_fact_ids: [...usedFactIds],
      used_memory_ids: [],
      memory_candidates: [],
    }, ctx),
    context: ctx,
    response_goal: responseGoal,
    planned_fact_ids: plannedFactIds,
  });
}

describe('payment narrative keeps the model as author', () => {
  it('keeps a narrative that states a canonical value it actually cited', () => {
    const written = 'La cuota más baja es la de 12 pagos mensuales de USD 30.';

    const composition = compose('present_payment_options', [written], [LABEL_12]);

    expect(composition.narrative.opening).toBe(written);
    expect(composition.used_fact_ids).toContain(LABEL_12);
  });

  it('answers the lowest instalment without dragging in the other two plans', () => {
    const composition = compose(
      'present_payment_options',
      ['La más baja es 12 pagos mensuales de USD 30, si te sirve arrancamos por ahí.'],
      [LABEL_12],
    );

    expect(composition.used_fact_ids).toEqual([LABEL_12]);
    expect(composition.narrative.opening).not.toContain('6 pagos mensuales de USD 60');
    expect(composition.narrative.opening).not.toContain('un pago único de USD 360');
  });

  it('accepts the model paraphrasing a cited plan as long as the value is canonical', () => {
    // Lo que DeepSeek escribe de verdad: acorta "6 pagos mensuales de USD 60"
    // a "6 pagos de USD 60". El precio sigue siendo el canónico y está citado;
    // comparar cadenas enteras lo rechazaría, comparar hechos no.
    const written = 'La de menor cuota es la de 12 pagos mensuales de USD 30. '
      + 'También tenés 6 pagos de USD 60 o un pago único de USD 360.';

    const composition = compose('present_payment_options', [written], [LABEL_12, LABEL_6, LABEL_ONCE]);

    expect(composition.narrative.opening).toBe(written);
  });

  it('produces different text for two differently worded price answers', () => {
    const first = compose('present_payment_options',
      ['Son 12 pagos mensuales de USD 30.'], [LABEL_12]);
    const second = compose('present_payment_options',
      ['Como te decía, quedan 12 pagos mensuales de USD 30.'], [LABEL_12]);

    expect(first.narrative.opening).not.toBe(second.narrative.opening);
  });

  it('still drops an invented price the model never had', () => {
    const composition = compose('present_payment_options',
      ['Te puedo hacer 4 cuotas de USD 50.', 'Contame qué preferís.'], [LABEL_12]);

    expect(JSON.stringify(composition)).not.toContain('USD 50');
    expect(composition.narrative.opening).toBe('Contame qué preferís.');
  });

  it('still drops a canonical value the model did not cite', () => {
    const composition = compose('present_payment_options',
      ['Tenés un pago único de USD 360.', 'Decime cómo seguimos.'], [LABEL_12]);

    expect(JSON.stringify(composition)).not.toContain('un pago único de USD 360');
    expect(composition.narrative.opening).toBe('Decime cómo seguimos.');
  });

  it('still drops a model-authored URL', () => {
    const composition = compose('confirm_payment_link',
      ['Pagá acá: https://buy.stripe.com/inventado', 'Te espero.'], [LABEL_12]);

    expect(JSON.stringify(composition)).not.toContain('https://');
    expect(composition.narrative.opening).toBe('Te espero.');
  });

  it('answers a question about an existing link without restating any value', () => {
    const written = 'Sí, ese mismo es el link para pagar. No hace falta que te mande otro.';

    const composition = compose('confirm_payment_link', [written], []);

    expect(composition.narrative.opening).toBe(written);
  });
});
