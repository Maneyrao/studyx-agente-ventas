import type { AuthorityReference, GoldenCaseV1, GoldenTurnV1 } from './scenarios';
import { OWNER_REPLAY_CUSTOMER_TURNS_V1 } from './owner-conversation-2026-11-02';

// Supplemental campaign: never included in the unchanged formal 16-case/48-turn gate.
const gabi = (start: number, end: number, contains: string): AuthorityReference => ({
  file: 'docs/authority/prompt-agente-a-studyx-v2.md', start, end, contains,
});
const owner = (start: number, end: number, contains: string): AuthorityReference => ({
  file: 'AGENTS.md', start, end, contains,
});
const ruleA = owner(45, 54, '2.ª objeción');
const ruleB = owner(56, 62, '2.ª o 3.ª respuesta');
const ownerPromo = owner(66, 66, 'Promo instantánea');
const baseAuthority = [gabi(38, 44, 'Una recomendación no es elección'), gabi(68, 89, 'price_objection')];
const moves = ['greeting', 'browse_catalog', 'select_course', 'ask_course_information', 'ask_payment_options',
  'unknown', 'continue_by_chat', 'defer_payment', 'request_call', 'decline_purchase'];
const allActions = ['none', 'offer_course_bonus', 'accept_promotion'];
const bonusCodes = ['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores'];
function turn(id: string, customer: string, override: Partial<GoldenTurnV1> = {}): GoldenTurnV1 {
  return {
    id, customer,
    must: ['Responder al mensaje actual con hechos autorizados y un próximo paso apropiado.'],
    mustNot: ['No inventar datos del catálogo, descuentos, acciones ejecutadas ni bonificaciones sin efecto autorizado.'],
    authority: [...baseAuthority, ruleA, ruleB],
    expected: { move: moves, action: ['none'], state: {} },
    hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' }],
    ...override,
  };
}
const noBonus = { promotion: { status: [null, 'none'], bonusCount: [0] } } as const;
function bonusTurn(id: string, customer: string, count: number): GoldenTurnV1 {
  return turn(id, customer, {
    must: ['Ofrecer el siguiente bonificado exacto de la tabla para Ecommerce, mantener el precio del principal y cerrar en el mismo turno. Al escalar, recapitular el paquete completo.'],
    mustNot: ['No cambiar el curso pago, repetir un bonificado, añadir dos nuevos ni supeditar la oferta a una llamada.'],
    authority: [ruleA, gabi(121, 129, 'recuerda en pocas palabras el paquete completo'), gabi(159, 164, 'Introducción al e-commerce')],
    expected: { move: moves, action: ['offer_course_bonus'], state: {
      promotion: { status: ['offer_available'], bonusCount: [count], paidCourse: ['introduccion_ecommerce'] },
    } },
    hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' },
      { type: 'course_bonus_preconditions' }, { type: 'action_bonus_in', values: [bonusCodes[count - 1]!] },
      ...(count > 1 ? [{ type: 'response_mentions_all_promotions' } as const] : [])],
  });
}

export const OWNER_GOLDEN_CASES: readonly GoldenCaseV1[] = [
  {
    id: '17_owner_marketing_ecommerce_ladder',
    title: 'Presupuesto/marketing → Ecommerce con hechos del turno → escalera de la Regla A',
    turns: [
      turn('greeting', 'Hola'),
      turn('recommendation', 'Qué me podés recomendar para seguir estudiando?'),
      turn('marketing_budget', 'Tengo poco presupuesto y quiero algo de marketing para vender los productos de mi tienda online.', {
        must: ['Responder al objetivo de vender en su tienda online. La historia debe acreditar una invitación autorizada y entregada en la segunda o tercera respuesta con interés expresado; si ya fue ofrecida antes, no repetirla.'],
        mustNot: ['No convertir poco presupuesto en autorización para regalar un curso ni prometer una llamada inmediata.'],
        expected: { move: moves, action: ['none'], state: noBonus },
        hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' }, { type: 'early_call_previously_recorded' }],
      }),
      turn('ecommerce_facts_now', 'Ecommerce me gusta. Cuánto es el total y cuántas clases son?', {
        must: ['Responder el precio total autorizado y la duración de Ecommerce con hechos de ese mismo turno: 8 clases en el fixture local.'],
        mustNot: ['No usar duración o temario de Marketing Digital ni inventar 16 clases para Ecommerce.'],
        authority: [...baseAuthority, gabi(48, 54, 'duración'), gabi(91, 98, 'USD 360'), ruleB],
        hard: [{ type: 'workflow_committed' }, { type: 'current_course_facts_present', value: 'introduccion_ecommerce' }],
      }),
      turn('first_price_objection', 'Me parece muy caro.', {
        must: ['Registrar la objeción literal, trabajar el valor y la forma de pago sin bonificación en esta primera objeción.'],
        expected: { move: moves, action: ['none'], state: noBonus },
        hard: [{ type: 'workflow_committed' }, { type: 'current_price_objection_recorded' }],
      }),
      bonusTurn('price_only_first_bonus', 'Sí, sólo el precio me frena; sigue siendo caro.', 1),
      bonusTurn('second_bonus', 'Me suma, pero el precio me sigue pareciendo caro.', 2),
      bonusTurn('third_bonus', 'El curso me interesa, pero todavía no me alcanza por el precio.', 3),
      turn('no_fourth', 'Y otro curso gratuito más también?', {
        must: ['Conservar los tres bonificados existentes, mantener el precio y proponer avanzar o dejar la puerta abierta.'],
        mustNot: ['No ofrecer, insinuar ni materializar un cuarto curso bonificado.'],
        authority: [ruleA, gabi(121, 127, 'Máximo de cursos bonificados')],
        expected: { move: moves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [3], paidCourse: ['introduccion_ecommerce'] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }],
      }),
    ],
  },
  {
    id: '18_explicit_promotion_request',
    title: 'Pedido de promoción: oferta instantánea de la tabla, escalada por pedido u objeción, sin descuento de precio',
    turns: [
      (() => {
        const bonus = bonusTurn('request_without_objection', 'Me interesa Introducción al Ecommerce para vender los productos de mi tienda online. Tenés alguna promoción para sumar un curso gratuito?', 1);
        return { ...bonus, authority: [ownerPromo, ...bonus.authority],
          must: ['Regla del dueño (segunda revisión): el pedido de promoción habilita la oferta en este turno sin objeción previa. Ofrecer el primer bonificado de la tabla para Ecommerce, mantener el precio y cerrar.'],
          mustNot: [...bonus.mustNot, 'No inventar un descuento de precio.'] };
      })(),
      (() => {
        const bonus = bonusTurn('price_only_and_early_call', 'Sólo el precio me frena, me parece caro. Ofreceme esa promoción para sumar un curso sin costo.', 2);
        return { ...bonus, authority: [ownerPromo, ...bonus.authority],
          must: [...bonus.must, 'Al coincidir la escalada y la Regla B en la segunda respuesta, presentar el paquete y conservar la invitación de llamada en response.call_offer, sin duplicarla.'],
          hard: [...(bonus.hard ?? []), { type: 'call_offer_recorded' } as const],
        };
      })(),
      turn('negated_price', 'Prefiero seguir por chat. No es caro y no necesito otra promo, sólo quería saber cómo sigue.', {
        must: ['Respetar chat y conservar el paquete con dos bonificados: una negación no es objeción ni pedido de promoción.'],
        mustNot: ['No usar las palabras aisladas caro o promo, negadas, como evidencia para escalar.'],
        authority: [ownerPromo, ruleA, owner(40, 43, 'Las preguntas'), ruleB],
        expected: { move: moves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [2] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 2 }],
      }),
      turn('price_question', 'Es caro? Te pregunto, no estoy diciendo que me parezca caro.', {
        must: ['Responder a la pregunta sin convertirla en una nueva objeción de precio ni ampliar el paquete.'],
        mustNot: ['No ofrecer un tercer bonificado por una pregunta o por una cita parcial de caro.'],
        authority: [ownerPromo, ruleA, owner(40, 43, 'Las preguntas')],
        expected: { move: moves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [2] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 2 }],
      }),
      bonusTurn('new_objection_after_offer', 'Ahora sí, el precio me sigue pareciendo caro y no me alcanza.', 3),
    ],
  },
];

export const OWNER_REPLAY_CASES: readonly GoldenCaseV1[] = [{
  id: '19_owner_conversation_replay_20261102',
  title: 'Replay de los 11 mensajes del dueño del 2/11, con respuestas nuevas de DeepSeek real',
  turns: OWNER_REPLAY_CUSTOMER_TURNS_V1.map((source, index) => {
    if (index === 6) return bonusTurn(source.id, source.customer, 1);
    return turn(source.id, source.customer, {
      must: ['Responder sin silencio al mensaje real de este turno, conservando la intención y los hechos de la conversación.'],
      expected: { move: moves, action: allActions, state: {} },
      ...(index === 3 ? {
        must: ['Responder sobre marketing y presupuesto. Acreditar la invitación temprana de llamada autorizada por la Regla B, con motivo concreto, o conservar la que ya fue entregada antes sin repetirla.'],
        hard: [{ type: 'workflow_committed' }, { type: 'early_call_previously_recorded' }],
      } : index === 4 ? {
        must: ['Dar el total de USD 360 y, si menciona duración, usar las 8 clases de Ecommerce verificadas en el turno actual.'],
        hard: [{ type: 'workflow_committed' }, { type: 'current_course_facts_present', value: 'introduccion_ecommerce' }],
      } : {}),
    });
  }),
}];
