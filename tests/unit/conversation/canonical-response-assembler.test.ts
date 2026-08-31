import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import {
  assembleCanonicalConversationResponseV1,
  CanonicalResponseAssemblyError,
} from '@/features/conversation/domain/canonical-response-assembler';

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1, next_stage: 'course_selected', response_goal: 'explain_selected_course',
    canonical_fact_requests: [], allowed_business_action: { type: 'none' }, missing_information: [],
    should_offer_call: false, next_call_preference: 'unknown', next_call_offer_status: 'not_offered',
    next_call_offer_count: 0,
    next_awaiting_reply: 'none', selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null, ...overrides,
  };
}

const facts: CanonicalFactV1[] = [
  { id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Redes Informáticas', offering_code: 'redes-informaticas' },
  { id: 'offering:redes-informaticas:duration:v1', kind: 'offering_duration', source: 'business_snapshot', value: '24 clases', offering_code: 'redes-informaticas' },
  { id: 'offering:redes-informaticas:modality:v1', kind: 'offering_modality', source: 'business_snapshot', value: 'online', offering_code: 'redes-informaticas' },
];
const refs: CanonicalFactRefV1[] = facts.map((fact) => ({
  id: fact.id,
  kind: fact.kind,
  ...(fact.offering_code ? { offering_code: fact.offering_code } : {}),
  ...(fact.payment_plan ? { payment_plan: fact.payment_plan } : {}),
}));
const composition: ComposedNarrativeV1 = {
  schema_version: 1,
  narrative: { opening: 'Te cuento lo principal.', explanation: null, next_question: '¿Qué querés profundizar?' },
  used_fact_ids: refs.map((fact) => fact.id),
};

describe('canonical response assembler V1', () => {
  it('renders names, duration and modality from backend facts exactly once', () => {
    const result = assembleCanonicalConversationResponseV1({ plan: plan(), fact_refs: refs, facts, composition });
    expect(result.content).toContain('Redes Informáticas');
    expect(result.content).toContain('24 clases');
    expect(result.content).toContain('online');
    expect(result.used_fact_ids).toEqual(composition.used_fact_ids);
  });

  it('keeps cited canonical facts inside natural prose without duplicating rigid blocks', () => {
    const naturalComposition: ComposedNarrativeV1 = {
      schema_version: 1,
      narrative: {
        opening: 'Redes Informáticas tiene 24 clases y se cursa online.',
        explanation: 'Podemos ir viendo juntos si coincide con lo que buscás.',
        next_question: '¿Querés que te cuente qué vas a aprender?',
      },
      used_fact_ids: refs.map((fact) => fact.id),
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts, composition: naturalComposition,
    });

    expect(result.content).toBe([
      naturalComposition.narrative.opening,
      naturalComposition.narrative.explanation,
      naturalComposition.narrative.next_question,
    ].join('\n\n'));
    expect(result.content.match(/Redes Informáticas/gu)).toHaveLength(1);
    expect(result.content.match(/24 clases/gu)).toHaveLength(1);
    expect(result.content.match(/online/gu)).toHaveLength(1);
  });

  it('treats an exact prerequisite clause as evidence from its cited canonical description', () => {
    const description: CanonicalFactV1 = {
      id: 'offering:criptomonedas:description:v1',
      kind: 'offering_description',
      source: 'business_snapshot',
      value: 'Es un curso introductorio, que no requiere conocimientos previos, y explica las bases.',
      offering_code: 'criptomonedas',
    };
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ selected_offering_code: 'criptomonedas' }),
      fact_refs: [{
        id: description.id,
        kind: description.kind,
        offering_code: description.offering_code,
      }],
      facts: [description],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'No requiere conocimientos previos.',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: [description.id],
      },
    });

    expect(result.content).toBe('No requiere conocimientos previos.');
    expect(result.used_fact_ids).toEqual([description.id]);
  });

  it('completes an authorized area-choice response with its options and one brief question', () => {
    const areaFacts: CanonicalFactV1[] = [
      { id: 'area:oficios:name:v1', kind: 'area_name', source: 'business_snapshot', value: 'Academia de Oficios' },
      { id: 'area:diseno:name:v1', kind: 'area_name', source: 'business_snapshot', value: 'Academia de Diseño Informático' },
      { id: 'area:negocios:name:v1', kind: 'area_name', source: 'business_snapshot', value: 'Academia de Negocios' },
    ];
    const areaRefs: CanonicalFactRefV1[] = areaFacts.map(({ id, kind }) => ({ id, kind }));

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'guide_area_choice',
        selected_offering_code: null,
        next_awaiting_reply: 'area_choice',
      }),
      fact_refs: areaRefs,
      facts: areaFacts,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Claro, te ayudo a orientarte.',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: [],
      },
    });

    expect(result.content).toContain('Academia de Oficios');
    expect(result.content).toContain('Academia de Diseño Informático');
    expect(result.content).toContain('Academia de Negocios');
    expect(result.content.match(/\?/gu)).toHaveLength(1);
    expect(result.used_fact_ids).toEqual(areaRefs.map((fact) => fact.id));
  });

  it('keeps course-choice options deterministic when model prose already names every course', () => {
    const optionFacts: CanonicalFactV1[] = [
      { id: 'offering:coaching:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Coaching y Liderazgo', offering_code: 'coaching' },
      { id: 'offering:comunicacion:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Comunicación Interna en Empresas', offering_code: 'comunicacion' },
      { id: 'offering:ventas:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Especialista en Ventas', offering_code: 'ventas' },
    ];
    const optionRefs: CanonicalFactRefV1[] = optionFacts.map(({ id, kind, offering_code }) => ({
      id, kind, offering_code,
    }));

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'guide_course_choice',
        selected_offering_code: null,
        next_awaiting_reply: 'course_choice',
      }),
      fact_refs: optionRefs,
      facts: optionFacts,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Tenemos Coaching y Liderazgo, Comunicación Interna en Empresas y Especialista en Ventas.',
          explanation: null,
          next_question: '¿Cuál te gustaría conocer en detalle?',
        },
        used_fact_ids: optionRefs.map((fact) => fact.id),
      },
    });

    expect(result.content.match(/^• /gmu)).toHaveLength(3);
    expect(result.content).toContain('• Coaching y Liderazgo');
    expect(result.content).toContain('• Comunicación Interna en Empresas');
    expect(result.content).toContain('• Especialista en Ventas');
    expect(result.content.match(/\?/gu)).toHaveLength(1);
  });

  it('renders authorized payment labels once without repeated total amount blocks', () => {
    const paymentFacts: CanonicalFactV1[] = [
      { id: 'payment:redes-informaticas:monthly_12:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: '12 pagos mensuales de USD 30', offering_code: 'redes-informaticas', payment_plan: 'monthly_12' },
      { id: 'payment:redes-informaticas:monthly_12:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'monthly_12' },
      { id: 'payment:redes-informaticas:monthly_6:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: '6 pagos mensuales de USD 60', offering_code: 'redes-informaticas', payment_plan: 'monthly_6' },
      { id: 'payment:redes-informaticas:monthly_6:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'monthly_6' },
      { id: 'payment:redes-informaticas:one_time:label:v1', kind: 'payment_plan_label', source: 'business_snapshot', value: 'un pago único de USD 360', offering_code: 'redes-informaticas', payment_plan: 'one_time' },
      { id: 'payment:redes-informaticas:one_time:price:v1', kind: 'payment_plan_price', source: 'business_snapshot', value: 'USD 360.00', offering_code: 'redes-informaticas', payment_plan: 'one_time' },
    ];
    const paymentRefs: CanonicalFactRefV1[] = paymentFacts.map(({ id, kind, offering_code, payment_plan }) => ({ id, kind, offering_code, payment_plan }));

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'present_payment_options', next_awaiting_reply: 'payment_plan' }),
      fact_refs: paymentRefs,
      facts: paymentFacts,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'El valor total del programa es USD 360.',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: paymentRefs.map((fact) => fact.id),
      },
    });

    expect(result.content.match(/12 pagos mensuales de USD 30/gu)).toHaveLength(1);
    expect(result.content.match(/6 pagos mensuales de USD 60/gu)).toHaveLength(1);
    expect(result.content.match(/un pago único de USD 360/gu)).toHaveLength(1);
    expect(result.content).not.toContain('Importe:');
    expect(result.content.match(/USD 360/gu)).toHaveLength(1);
    expect(result.content.match(/\?/gu)).toHaveLength(1);
    expect(result.content).toContain('Estas son las opciones de pago disponibles.');
  });

  it('uses natural model call copy only when the authoritative plan allows the offer', () => {
    const naturalOffer = 'Si te sirve, podemos coordinar una llamada breve; si no, seguimos por acá.';
    const withOffer = assembleCanonicalConversationResponseV1({
      plan: plan({ should_offer_call: true, next_call_offer_status: 'offered', next_call_offer_count: 1 }),
      fact_refs: [],
      facts: [],
      composition: {
        schema_version: 1,
        narrative: { opening: 'Te ayudo a revisar esta opción.', explanation: null, next_question: null },
        call_offer: naturalOffer,
        used_fact_ids: [],
      },
    });
    const withoutOffer = assembleCanonicalConversationResponseV1({
      plan: plan({ should_offer_call: false }),
      fact_refs: [],
      facts: [],
      composition: {
        schema_version: 1,
        narrative: { opening: 'Te ayudo a revisar esta opción.', explanation: null, next_question: null },
        call_offer: naturalOffer,
        used_fact_ids: [],
      },
    });

    expect(withOffer.content).toContain(naturalOffer);
    expect(withOffer.content).not.toContain('¿Preferís que sigamos por chat');
    expect(withoutOffer.content).not.toContain(naturalOffer);
  });

  it('keeps a payment choice and a simultaneous call offer to one principal question', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'present_payment_options',
        next_awaiting_reply: 'payment_plan',
        should_offer_call: true,
        next_call_offer_status: 'offered',
        next_call_offer_count: 1,
      }),
      fact_refs: [],
      facts: [],
      composition: {
        schema_version: 1,
        narrative: { opening: 'Te cuento las opciones.', explanation: null, next_question: null },
        call_offer: '¿Querés una llamada?',
        used_fact_ids: [],
      },
    });

    expect(result.content).toContain('solicitar una llamada');
    expect(result.content).toContain('¿Cuál de estas opciones te resulta más conveniente?');
    expect(result.content.match(/\?/gu)).toHaveLength(1);
  });

  it('does not repeat the canonical description when natural copy already answers with course facts', () => {
    const courseFacts: CanonicalFactV1[] = [
      { id: 'offering:coaching:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Coaching y Liderazgo', offering_code: 'coaching' },
      { id: 'offering:coaching:description:v1', kind: 'offering_description', source: 'business_snapshot', value: 'Academia de Negocios. 16 clases. Formación para desarrollar habilidades gerenciales.', offering_code: 'coaching' },
      { id: 'offering:coaching:duration:v1', kind: 'offering_duration', source: 'business_snapshot', value: '16 clases', offering_code: 'coaching' },
      { id: 'offering:coaching:modality:v1', kind: 'offering_modality', source: 'business_snapshot', value: 'online', offering_code: 'coaching' },
    ];
    const courseRefs: CanonicalFactRefV1[] = courseFacts.map(({ id, kind, offering_code }) => ({
      id, kind, offering_code,
    }));
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        selected_offering_code: 'coaching',
        should_offer_call: true,
        next_call_offer_status: 'offered',
        next_call_offer_count: 1,
      }),
      fact_refs: courseRefs,
      facts: courseFacts,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Coaching y Liderazgo tiene 16 clases online y te ayuda a desarrollar habilidades gerenciales.',
          explanation: null,
          next_question: '¿Qué parte querés conocer mejor?',
        },
        call_offer: '¿Preferís que sigamos por chat o querés solicitar una llamada?',
        used_fact_ids: courseRefs.map((fact) => fact.id),
      },
    });

    expect(result.content.match(/16 clases/gu)).toHaveLength(1);
    expect(result.content).not.toContain('Academia de Negocios. 16 clases.');
    expect(result.content).toContain('también podés solicitar una llamada');
    expect(result.content.match(/\?/gu)).toHaveLength(1);
  });

  it('rejects unknown IDs and commercial values that were not cited', () => {
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts,
      composition: { ...composition, used_fact_ids: ['unknown'] },
    })).toThrowError(CanonicalResponseAssemblyError);
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts,
      composition: {
        ...composition,
        used_fact_ids: [facts[0].id, facts[2].id],
        narrative: { ...composition.narrative, explanation: 'Dura 24 clases.' },
      },
    })).toThrow('COMPOSER_UNCITED_CANONICAL_FACT');
  });

  it('materializes exactly one canonical link once the authoritative plan authorizes it', () => {
    const linkFact: CanonicalFactV1 = {
      id: 'payment:redes-informaticas:monthly_12:link:v1', kind: 'payment_link',
      source: 'payment_config', value: 'https://buy.stripe.com/test_only',
      offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
    };
    const linkRef: CanonicalFactRefV1 = {
      id: linkFact.id, kind: linkFact.kind,
      offering_code: linkFact.offering_code, payment_plan: linkFact.payment_plan,
    };
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        next_stage: 'payment_link_sent', response_goal: 'confirm_payment_link',
        allowed_business_action: {
          type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        },
        selected_payment_plan: 'monthly_12',
      }),
      fact_refs: [linkRef], facts: [linkFact],
      composition: {
        schema_version: 1,
        narrative: { opening: 'Perfecto, podés avanzar.', explanation: null, next_question: null },
        used_fact_ids: [linkFact.id],
      },
    });
    expect(result.content.split(linkFact.value)).toHaveLength(2);

    const completed = assembleCanonicalConversationResponseV1({
      plan: plan({
        allowed_business_action: {
          type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        },
      }),
      fact_refs: [linkRef], facts: [linkFact],
      composition: { ...composition, used_fact_ids: [] },
    });
    expect(completed.content.split(linkFact.value)).toHaveLength(2);
    expect(completed.used_fact_ids).toContain(linkFact.id);

    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan({
        allowed_business_action: {
          type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        },
      }),
      fact_refs: [], facts: [],
      composition: { ...composition, used_fact_ids: [] },
    })).toThrow('PAYMENT_LINK_FACT_REQUIRED');
  });

  it('keeps fallback copy contextual when facts are unavailable', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'catalog_temporarily_unavailable',
        selected_offering_code: null,
        missing_information: ['catalog_snapshot'],
      }),
      fact_refs: [], facts: [],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'No puedo consultar el catálogo en este momento.',
          explanation: 'Podemos retomar tu objetivo sin perder el hilo.',
          next_question: '¿Qué te gustaría aprender?',
        },
        used_fact_ids: [],
      },
    });
    expect(result.content).toContain('catálogo');
    expect(result.content).toContain('objetivo');
  });
});
