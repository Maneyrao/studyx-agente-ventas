import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';

/**
 * Forma de la respuesta, no su contenido.
 *
 * El oráculo de calidad de superficie corta en seis líneas, y un mensaje se
 * arma uniendo segmentos con un renglón en blanco: seis líneas son tres
 * párrafos. Cada regla de acá abajo existe porque el ensamblador producía un
 * párrafo más de los que el turno necesitaba —uno por hecho canónico, uno por
 * la oferta de llamada, uno por un salto de línea que el modelo dejó suelto—
 * y ninguna de esas decisiones era del modelo: eran del backend.
 *
 * Ninguna de estas reglas toca qué hechos se pueden afirmar. Sólo cómo se
 * imprimen los que el turno ya autorizó.
 */

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

function refOf(fact: CanonicalFactV1): CanonicalFactRefV1 {
  return {
    id: fact.id,
    kind: fact.kind,
    ...(fact.offering_code ? { offering_code: fact.offering_code } : {}),
    ...(fact.payment_plan ? { payment_plan: fact.payment_plan } : {}),
  };
}

const name: CanonicalFactV1 = {
  id: 'offering:redes-informaticas:name:v1',
  kind: 'offering_name',
  source: 'business_snapshot',
  value: 'Redes Informáticas',
  offering_code: 'redes-informaticas',
};
const description: CanonicalFactV1 = {
  id: 'offering:redes-informaticas:description:v1',
  kind: 'offering_description',
  source: 'business_snapshot',
  value: 'Academia de Oficios. 16 clases. Este curso te permitirá conocer el funcionamiento'
    + ' de las redes informáticas, y cada uno de los elementos y dispositivos que la componen.',
  offering_code: 'redes-informaticas',
};
const modality: CanonicalFactV1 = {
  id: 'offering:redes-informaticas:modality:v1',
  kind: 'offering_modality',
  source: 'business_snapshot',
  value: 'online',
  offering_code: 'redes-informaticas',
};

function paragraphsOf(content: string): string[] {
  return content.split(/\n{2,}/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

describe('forma del mensaje ensamblado', () => {
  it('mantiene prosa, bloque canónico y pregunta dentro de tres párrafos', () => {
    // base_10_prerequisites: apertura + descripción + modalidad + pregunta.
    const composition: ComposedNarrativeV1 = {
      schema_version: 1,
      narrative: {
        opening: 'No, no necesitás conocimientos previos.',
        explanation: 'Está pensado para que partas desde cero.',
        next_question: '¿Querés que te cuente cómo se cursa?',
      },
      used_fact_ids: [description.id, modality.id],
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan(),
      fact_refs: [description, modality].map(refOf),
      facts: [description, modality],
      composition,
    });

    expect(paragraphsOf(result.content).length).toBeLessThanOrEqual(3);
    expect(result.content.split(/\r?\n/u).length).toBeLessThanOrEqual(6);
  });

  it('enumera una lista canónica en línea y no un párrafo por ítem', () => {
    const barista: CanonicalFactV1 = {
      id: 'offering:barista:name:v1',
      kind: 'offering_name',
      source: 'business_snapshot',
      value: 'Barista',
      offering_code: 'barista',
    };
    const marketing: CanonicalFactV1 = {
      id: 'offering:marketing:name:v1',
      kind: 'offering_name',
      source: 'business_snapshot',
      value: 'Marketing Digital',
      offering_code: 'marketing',
    };
    const options = [name, barista, marketing];

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ response_goal: 'guide_course_choice', selected_offering_code: null }),
      fact_refs: options.map(refOf),
      facts: options,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Estas son algunas opciones.',
          explanation: null,
          next_question: '¿Cuál querés conocer mejor?',
        },
        used_fact_ids: [],
      },
    });

    for (const option of options) expect(result.content).toContain(option.value);
    expect(result.content.split(/\r?\n/u).length).toBeLessThanOrEqual(6);
    expect(paragraphsOf(result.content).filter((part) => part.startsWith('•'))).toHaveLength(0);
  });

  it('no agrega la oferta de llamada como párrafo extra cuando ya hay una pregunta', () => {
    // base_02: el mensaje terminaba con pregunta Y con la oferta suelta debajo.
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({ should_offer_call: true }),
      fact_refs: [],
      facts: [],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Hola, bienvenido a StudyX.',
          explanation: null,
          next_question: '¿Ya tenías pensado estudiar redes o recién estás averiguando?',
        },
        used_fact_ids: [],
      },
    });

    // La oferta sigue siendo visible —el ledger la cuenta— pero no ocupa un
    // párrafo propio.
    expect(result.content).toMatch(/solicitar una llamada/iu);
    expect(paragraphsOf(result.content).length).toBeLessThanOrEqual(2);
  });

  it('deja lugar al bloque del link cuando el turno lo autoriza', () => {
    // El link se adjunta después del ensamblador con un renglón en blanco, así
    // que el presupuesto de este mensaje es de dos párrafos, no de tres.
    const link: CanonicalFactV1 = {
      id: 'payment:redes-informaticas:one_time:link:v1',
      kind: 'payment_link',
      source: 'payment_config',
      value: 'https://example.invalid/eval/contado',
      offering_code: 'redes-informaticas',
      payment_plan: 'one_time',
    };
    const label: CanonicalFactV1 = {
      id: 'payment:redes-informaticas:one_time:label:v1',
      kind: 'payment_plan_label',
      source: 'payment_config',
      value: 'Pago único de USD 360',
      offering_code: 'redes-informaticas',
      payment_plan: 'one_time',
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'confirm_payment_link',
        selected_payment_plan: 'one_time',
        allowed_business_action: {
          type: 'send_payment_link',
          offering_code: 'redes-informaticas',
          payment_plan: 'one_time',
        },
      }),
      fact_refs: [link, label].map(refOf),
      facts: [link, label],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Perfecto, Vera.',
          explanation: 'Te dejo todo listo para avanzar.',
          next_question: '¿Me confirmás cuando lo completes?',
        },
        used_fact_ids: [],
      },
    });

    expect(paragraphsOf(result.content).length).toBeLessThanOrEqual(2);
  });

  it('no repite una descripción canónica que la narrativa ya contó con sus palabras', () => {
    // base_11: el modelo parafrasea la descripción y el backend la volvía a
    // pegar textual justo debajo.
    const composition: ComposedNarrativeV1 = {
      schema_version: 1,
      narrative: {
        opening: 'En Redes Informáticas vas a conocer el funcionamiento de las redes'
          + ' informáticas y cada uno de los elementos y dispositivos que la componen.',
        explanation: null,
        next_question: '¿Querés que veamos cómo se cursa?',
      },
      used_fact_ids: [name.id, description.id],
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan(),
      fact_refs: [name, description].map(refOf),
      facts: [name, description],
      composition,
    });

    expect(result.content).not.toContain('Este curso te permitirá conocer el funcionamiento');
  });
});
