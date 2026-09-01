import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1,
    next_stage: 'course_selected',
    response_goal: 'explain_selected_course',
    canonical_fact_requests: [],
    allowed_business_action: { type: 'none' },
    missing_information: [],
    should_offer_call: false,
    next_call_preference: 'unknown',
    next_call_offer_status: 'not_offered',
    next_call_offer_count: 0,
    next_awaiting_reply: 'none',
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null,
    ...overrides,
  };
}

const paymentFacts: CanonicalFactV1[] = [
  { id: 'payment:redes-informaticas:monthly_12:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: '12 pagos mensuales de USD 30', offering_code: 'redes-informaticas', payment_plan: 'monthly_12' },
  { id: 'payment:redes-informaticas:monthly_6:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: '6 pagos mensuales de USD 60', offering_code: 'redes-informaticas', payment_plan: 'monthly_6' },
  { id: 'payment:redes-informaticas:one_time:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: 'un pago único de USD 360', offering_code: 'redes-informaticas', payment_plan: 'one_time' },
];
const paymentRefs: CanonicalFactRefV1[] = paymentFacts.map(({ id, kind, offering_code, payment_plan }) => ({
  id, kind, offering_code, payment_plan,
}));

const courseFacts: CanonicalFactV1[] = [
  { id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Redes Informáticas', offering_code: 'redes-informaticas' },
  { id: 'offering:barista:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Barista', offering_code: 'barista' },
];
const courseRefs: CanonicalFactRefV1[] = courseFacts.map(({ id, kind, offering_code }) => ({ id, kind, offering_code }));

function composed(
  narrative: ComposedNarrativeV1['narrative'],
  usedFactIds: readonly string[],
): ComposedNarrativeV1 {
  return { schema_version: 1, narrative, used_fact_ids: [...usedFactIds] };
}

describe('canonical response assembler keeps the model as author of the copy', () => {
  it('keeps the model narrative when presenting payment options', () => {
    const narrative = {
      opening: 'Claro, te paso cómo podés abonar la formación de redes.',
      explanation: 'El total es el mismo en las tres, cambia solamente cómo lo repartís.',
      next_question: '¿Cuál te acomoda más para arrancar?',
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed(narrative, paymentRefs.map((ref) => ref.id)),
    });

    expect(result.content).toContain(narrative.opening);
    expect(result.content).toContain(narrative.explanation);
    expect(result.content).toContain(narrative.next_question);
    expect(result.content).not.toContain('Estas son las opciones de pago disponibles.');
    expect(result.content).toContain('• 12 pagos mensuales de USD 30');
  });

  it('keeps the model opening when guiding a course choice without losing the canonical list', () => {
    const narrative = {
      opening: 'Por lo que me contás, te dejo dos caminos posibles.',
      explanation: null,
      next_question: '¿Alguno te llama más la atención?',
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'guide_course_choice', selected_offering_code: null }),
      fact_refs: courseRefs,
      facts: courseFacts,
      composition: composed(narrative, courseRefs.map((ref) => ref.id)),
    });

    expect(result.content).toContain(narrative.opening);
    expect(result.content).not.toContain('Estas son algunas opciones disponibles.');
    expect(result.content).toContain('• Redes Informáticas');
    expect(result.content).toContain('• Barista');
  });

  it('produces different text for two different compositions with the same response goal', () => {
    const first = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed({
        opening: 'Te paso las tres formas de abonarlo.',
        explanation: null,
        next_question: '¿Con cuál te sentís más cómodo?',
      }, paymentRefs.map((ref) => ref.id)),
    });
    const second = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed({
        opening: 'Como te decía, el total es el mismo y cambia el reparto.',
        explanation: null,
        next_question: '¿Querés que avancemos con alguna?',
      }, paymentRefs.map((ref) => ref.id)),
    });

    expect(first.content).not.toBe(second.content);
  });

  it('confirms only the selected plan instead of dumping the whole payment catalog', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'confirm_selected_plan',
        next_stage: 'plan_selected',
        next_awaiting_reply: 'payment_confirmation',
        selected_payment_plan: 'monthly_6',
      }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed({
        opening: 'El que estás por tomar es el de 6 pagos mensuales de USD 60.',
        explanation: null,
        next_question: '¿Avanzamos con ese?',
      }, paymentRefs.map((ref) => ref.id)),
    });

    expect(result.content).toContain('6 pagos mensuales de USD 60');
    expect(result.content).not.toContain('12 pagos mensuales de USD 30');
    expect(result.content).not.toContain('un pago único de USD 360');
  });
});
