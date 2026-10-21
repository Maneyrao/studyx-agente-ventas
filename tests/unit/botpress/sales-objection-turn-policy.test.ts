import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  evaluateSalesObjectionTurnV1,
  responseAvoidsDisallowedPriceReframingV1,
  responseProgressesRepeatedPriceObjectionV1,
} from '../../../botpress-agent/src/lib/conversation/sales-objection-turn-policy';

function contextWithCurrentMessage(text: string, priorInbound: readonly string[] = []): AgentAContextV1 {
  return {
    turn: {
      batch_messages: [{ id: 'current-message', text }],
      recent_turns: priorInbound.map((content, index) => ({
        id: `prior-${index}`,
        direction: 'inbound' as const,
        content,
      })),
    },
  } as AgentAContextV1;
}

describe('evaluateSalesObjectionTurnV1', () => {
  it.each([
    ['Cual es el costo?', 'price_question', null],
    ['Cuanto sale el curso?', 'price_question', null],
    ['Me parece caro, cuánto sería en 12 cuotas?', 'price_question_with_objection', null],
    ['Me parece caro, cuánto cuesta por mes?', 'price_question_with_objection', null],
    ['Me parece caro, hay que pagar todo junto para empezar?', 'price_question_with_objection', null],
    ['Me sigue pareciendo caro', 'repeated_price_objection', ['Está fuera de mi presupuesto']],
    ['Si pago en 12 meses, el diploma tarda 12 meses?', 'payment_terms_question', null],
    ['Si pago en 12 meses, puedo terminar antes?', 'payment_terms_question', null],
    ['Hay que pagar todo junto para empezar?', 'payment_terms_question', null],
    ['Hay que pagar todo junto para inscribirme?', 'payment_terms_question', null],
    ['Trabajo mucho, no sé si voy a tener tiempo', 'time_or_schedule_objection', null],
    ['No puedo en ese horario', 'time_or_schedule_objection', null],
    ['Las clases son de lunes a viernes?', 'time_or_schedule_objection', null],
    ['Prefiero estudiar de mañana', 'time_or_schedule_objection', null],
    ['Estoy desde cero', 'readiness_or_requirements_objection', null],
    ['No tengo computadora', 'readiness_or_requirements_objection', null],
    ['El certificado sirve?', 'trust_objection', null],
    ['Es una escuela real?', 'trust_objection', null],
    ['Pensé que las clases eran con un profesor en vivo, no un video', 'trust_objection', null],
    ['Pensé que eran clases en vivo, no videos', 'trust_objection', null],
    ['El banco no me deja hacer el pago', 'payment_friction', null],
    ['El banco rechazó el pago', 'payment_friction', null],
    ['La tarjeta fue rechazada', 'payment_friction', null],
    ['La tarjeta está bloqueada', 'payment_friction', null],
    ['Se me quedó la tarjeta en el cajero', 'payment_friction', null],
    ['Ahorita recargo la tarjeta', 'payment_friction', null],
    ['Hasta cuándo es válida la oferta?', 'offer_timing_question', null],
  ] satisfies ReadonlyArray<readonly [string, string, readonly string[] | null]>)('classifies %s as %s', (text, expected, priorInbound) => {
    expect(evaluateSalesObjectionTurnV1(contextWithCurrentMessage(text, priorInbound ?? []))).toEqual({
      kind: expected,
    });
  });

  it.each([
    'Cuánto dura?',
    'Quiero tiempo para pensarlo',
    'Hoy sí o sí hago el pago',
    'Me interesa Inglés 1',
  ])('does not force an objection category for %s', (text) => {
    expect(evaluateSalesObjectionTurnV1(contextWithCurrentMessage(text))).toEqual({ kind: 'none' });
  });
});

describe('responseProgressesRepeatedPriceObjectionV1', () => {
  it.each([
    'Son 12 cuotas de USD 30. Te parece?',
    'Puedes pagar 12 cuotas de USD 30.',
    'Incluye 16 clases para tu trabajo.',
  ])('rejects pseudo-progress that only repackages price or course facts: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(false);
  });

  it('does not let a call invitation replace handling the objection in chat', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Son 12 cuotas de USD 30.'],
      call_offer: 'Si quieres, te llamo y lo vemos.',
    })).toBe(false);
  });

  it.each([
    'Para saber si te conviene, qué quieres poder hacer con Marketing Digital?',
    'Si buscas mover tu propio negocio, lo aprendido te puede ayudar a ordenar cómo lo comunicas.',
    'Lo que te frena es la cuota mensual o no estar seguro de aprovecharlo?',
    'Es un tema de presupuesto o de confianza en la formación?',
    'Es presupuesto o confianza?',
    'Qué te hace dudar?',
  ])('accepts a diagnostic or conditional value advance: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(true);
  });

  it.each([
    'Si hoy el presupuesto realmente no te lo permite, está bien; no quiero presionarte.',
    'Claro, lo dejamos para cuando te resulte posible. No hace falta que decidas ahora.',
    'Entiendo. Podemos retomarlo más adelante, sin problema.',
  ])('accepts a natural response after the customer states a real budget limit: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
      customer_expressed_real_budget_limit: true,
    })).toBe(true);
  });

  it('rejects a vague conditional phrase that adds no customer-specific value', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Podrías usar lo aprendido para lo que quieras.'],
      call_offer: null,
    })).toBe(false);
  });

  it('rejects a payment-plan reoffer disguised as a question', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Prefieres pagar las 12 cuotas de USD 30?'],
      call_offer: null,
    })).toBe(false);
  });

  it.each([
    'Son 12 cuotas de USD 30. Qué te parece?',
    'Cuál plan quieres?',
  ])('rejects a generic closing or plan selector as diagnostic progress: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(false);
  });
});

describe('responseAvoidsDisallowedPriceReframingV1', () => {
  it.each([
    'Para tu negocio, lo aprendido te puede ayudar a vender y puedes pagarlo en 12 cuotas de USD 30.',
    'Para tu trabajo, te puede ayudar a crecer y es menos de un dólar por día.',
    'Te puede ayudar a emprender y puedo incluir Marketing sin costo por el mismo precio.',
    'Es una inversión parecida a lo que gastas en un café por día.',
    'Para tu negocio, te puede ayudar a vender. Son solo USD 30 al mes.',
    'Para tu negocio, te puede ayudar a vender. Son solo USD 30 mensuales.',
    'Para tu negocio, te puede ayudar a vender. Puedes abonarlo en mensualidades de USD 30.',
    'Para tu negocio, te puede ayudar a vender. La opción mensual es más accesible.',
  ])('rejects forbidden price persuasion even when it also sounds contextual: %s', (message) => {
    expect(responseAvoidsDisallowedPriceReframingV1({ messages: [message] })).toBe(false);
  });

  it.each([
    'Si lo que buscas es conseguir clientes para tu negocio, puedes aplicar lo aprendido para ordenar cómo lo comunicas.',
    'Si hoy el presupuesto realmente no te lo permite, está bien; no quiero presionarte.',
  ])('allows contextual value or an honest budget limit without changing the price: %s', (message) => {
    expect(responseAvoidsDisallowedPriceReframingV1({ messages: [message] })).toBe(true);
  });

  it('allows an exact requested installment answer in a mixed price question and objection', () => {
    expect(responseAvoidsDisallowedPriceReframingV1({
      messages: ['El plan tiene 12 pagos de USD 30.'],
      allow_requested_payment_terms: true,
    })).toBe(true);
  });

  it('still rejects a promotional price tactic after an exact answer was requested', () => {
    expect(responseAvoidsDisallowedPriceReframingV1({
      messages: ['El plan tiene 12 pagos de USD 30, menos de un dólar por día.'],
      allow_requested_payment_terms: true,
    })).toBe(false);
  });

  it.each([
    'El plan es de USD 30 al mes durante 12 meses.',
    'No, puedes empezar con el plan de 12 pagos de USD 30.',
  ])('allows neutral requested payment facts without treating them as persuasion: %s', (message) => {
    expect(responseAvoidsDisallowedPriceReframingV1({
      messages: [message],
      allow_requested_payment_terms: true,
    })).toBe(true);
  });

  it('rejects recommendation and affordability language even when payment facts were requested', () => {
    expect(responseAvoidsDisallowedPriceReframingV1({
      messages: ['Te recomiendo la cuota más baja: 12 pagos de USD 30, así resulta más accesible.'],
      allow_requested_payment_terms: true,
    })).toBe(false);
  });
});
