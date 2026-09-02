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
    payment_reported: false,
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
const priceFacts: CanonicalFactV1[] = [
  { id: 'payment:redes-informaticas:monthly_12:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'monthly_12' },
  { id: 'payment:redes-informaticas:monthly_6:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'monthly_6' },
  { id: 'payment:redes-informaticas:one_time:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'one_time' },
];
const allPaymentFacts = [...paymentFacts, ...priceFacts];
const paymentRefs: CanonicalFactRefV1[] = paymentFacts.map(({ id, kind, offering_code, payment_plan }) => ({
  id, kind, offering_code, payment_plan,
}));
const allPaymentRefs: CanonicalFactRefV1[] = allPaymentFacts.map(({ id, kind, offering_code, payment_plan }) => ({
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
    expect(result.content).toContain('12 pagos mensuales de USD 30');
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
    expect(result.content).toContain('Redes Informáticas');
    expect(result.content).toContain('Barista');
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

  it('treats a cited plan as citing that plan price too', () => {
    // El modelo cita el label del plan y escribe "USD 360" en su narrativa. Ese
    // importe también es el hecho `payment_plan_price` del mismo plan: citar el
    // plan autoriza sus hechos canónicos, no sólo la etiqueta.
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: allPaymentRefs,
      facts: allPaymentFacts,
      composition: composed({
        opening: 'El valor total del programa es USD 360.',
        explanation: 'Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360.',
        next_question: '¿Cuál te resulta más conveniente?',
      }, [
        'payment:redes-informaticas:monthly_12:label:v1',
        'payment:redes-informaticas:monthly_6:label:v1',
        'payment:redes-informaticas:one_time:label:v1',
      ]),
    });

    expect(result.content).toContain('El valor total del programa es USD 360.');
    expect(result.content).not.toContain('Total: USD 360.00');
  });

  it('does not re-append a plan the model already named in its own words', () => {
    // DeepSeek cita el plan y lo nombra parafraseado ("6 pagos de USD 60").
    // El match literal no lo reconoce y lo volvía a pegar como bullet suelto
    // debajo de la narrativa. Un plan citado es del modelo: no se duplica.
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: allPaymentRefs,
      facts: allPaymentFacts,
      composition: composed({
        opening: 'La de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60.',
        explanation: null,
        next_question: '¿Cuál preferís?',
      }, [
        'payment:redes-informaticas:monthly_12:label:v1',
        'payment:redes-informaticas:monthly_6:label:v1',
      ]),
    });

    // La lista canónica ya no lleva glifo, así que mirar el bullet no probaría
    // nada: lo que importa es que el plan aparezca una sola vez, el que escribió
    // el modelo, y que la etiqueta canónica no se pegue además debajo.
    expect(result.content).not.toContain('6 pagos mensuales de USD 60');
    expect(result.content.match(/12 pagos mensuales de USD 30/gu)).toHaveLength(1);
    expect(result.content).toContain('6 pagos de USD 60');
  });

  it('does not reject a value that another authorized fact carries identically', () => {
    // Los tres planes comparten el mismo total canónico. Escribir "USD 360"
    // marca los tres hechos de precio como mencionados aunque el modelo haya
    // citado uno: el texto es indistinguible, y el importe está autorizado.
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'confirm_selected_plan',
        next_stage: 'plan_selected',
        next_awaiting_reply: 'payment_confirmation',
        selected_payment_plan: 'one_time',
      }),
      fact_refs: allPaymentRefs,
      facts: allPaymentFacts,
      composition: composed({
        opening: 'Perfecto, queda el pago único de USD 360.',
        explanation: null,
        next_question: '¿Avanzamos?',
      }, ['payment:redes-informaticas:one_time:label:v1']),
    });

    expect(result.content).toContain('Perfecto, queda el pago único de USD 360.');
  });

  it('answers with the one plan the model cited instead of listing all three', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed({
        opening: 'La más baja es 12 pagos mensuales de USD 30.',
        explanation: null,
        next_question: '¿Arrancamos con esa?',
      }, ['payment:redes-informaticas:monthly_12:label:v1']),
    });

    expect(result.content).toContain('12 pagos mensuales de USD 30');
    expect(result.content).not.toContain('6 pagos mensuales de USD 60');
    expect(result.content).not.toContain('un pago único de USD 360');
  });

  it('still lists every plan when the model cited none of them', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: composed({
        opening: 'Te paso cómo podés abonarlo.',
        explanation: null,
        next_question: '¿Cuál te conviene?',
      }, []),
    });

    for (const label of ['12 pagos mensuales de USD 30', '6 pagos mensuales de USD 60', 'un pago único de USD 360']) {
      expect(result.content).toContain(label);
    }
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
