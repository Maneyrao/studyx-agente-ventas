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
const ownerPriceProbe = owner(67, 68, 'nueva objeción de precio dispara la oferta');
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
        must: ['Responder al objetivo de vender en su tienda online.'],
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
      (() => {
        const bonus = bonusTurn('first_price_objection', 'Me parece muy caro.', 1);
        return { ...bonus,
          authority: [ownerPriceProbe, ...bonus.authority],
          must: ['Registrar la objeción literal. Como el agente ya hizo la pregunta de la Regla C, esta nueva objeción dispara el primer bonificado exacto de la tabla.'],
          hard: [...bonus.hard, { type: 'current_price_objection_recorded' } as const],
        };
      })(),
      bonusTurn('price_only_first_bonus', 'Sí, sólo el precio me frena; sigue siendo caro.', 2),
      bonusTurn('second_bonus', 'Me suma, pero el precio me sigue pareciendo caro.', 3),
      turn('third_bonus', 'El curso me interesa, pero todavía no me alcanza por el precio.', {
        must: ['Conservar el paquete de tres bonificados, mantener el precio y seguir cerrando sin prometer un cuarto curso.'],
        mustNot: ['No ofrecer, insinuar ni materializar un cuarto curso bonificado.'],
        authority: [ruleA, gabi(121, 127, 'Máximo de cursos bonificados')],
        expected: { move: moves, action: ['none'], state: {
          promotion: { status: ['offer_available'], bonusCount: [3], paidCourse: ['introduccion_ecommerce'] },
        } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }],
      }),
      turn('no_fourth', 'Y otro curso gratuito más también?', {
        must: ['Conservar los tres bonificados existentes, mantener el precio y proponer avanzar o dejar la puerta abierta.'],
        mustNot: ['No ofrecer, insinuar ni materializar un cuarto curso bonificado.'],
        authority: [ruleA, gabi(121, 127, 'Máximo de cursos bonificados')],
        expected: { move: [...moves, 'ask_current_state'], action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [3], paidCourse: ['introduccion_ecommerce'] } } },
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

/** Owner conversation of 2026-11-02 17:30–17:34 (-03:00), customer inputs only,
 * read from the owner's own test contact. Live failures: the escalation turn
 * fell into the technical contingency and the next objection never escalated. */
const noContingency = [{ type: 'not_contains', value: 'no te entendí bien' } as const,
  { type: 'not_contains', value: 'Qué dos cursos comparamos' } as const];
const promotionMode = owner(66, 66, 'Promo instantánea');
// The customer says "quiero directamente pagar": checkout moves are valid here.
const replayMoves = [...moves, 'request_payment_link', 'provide_contact_details'];
const englishTurn = (id: string, customer: string, override: Partial<GoldenTurnV1> = {}) => turn(id, customer, {
  must: ['Responder sin silencio ni contingencia al mensaje real de este turno, conservando la intención y los hechos.'],
  expected: { move: replayMoves, action: allActions, state: {} },
  hard: [{ type: 'workflow_committed' }, ...noContingency],
  ...override,
});
const OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE: GoldenCaseV1[] = [{
  id: '20_owner_promotion_mode_replay_20261102_1730',
  title: 'Replay 2/11 17:30–17:34: Inglés desde cero → pedido de promo por precio → escalada con recapitulación, sin contingencia',
  turns: [
    englishTurn('greeting_marketing_or_english', 'buenas\nquiero info\nrespecto a los cursos de marketing o ingles'),
    englishTurn('english_from_zero', 'para aprender idioma de cero'),
    englishTurn('wants_to_pay', 'nono, quiero directamente pagar'),
    englishTurn('course_and_payment', 'como son los cursos y el tema del pago'),
    englishTurn('promo_because_expensive', 'hay bonificaciones?\no algun tipo de promocion\nporque me parece caro', {
      must: ['Modo promoción, primera oferta: reconocer el freno del precio, decir que se lo puede resolver, presentar una promoción exclusiva (si avanza con Inglés 1, le bonifica Inglés 2) explicando por qué le suma a aprender desde cero, y cerrar con la alternativa de 12 cuotas de USD 30 o 6 de USD 60.'],
      mustNot: ['No abrir con el precio ni con «el precio no cambia», no volver sólo a las cuotas, no comparar con gastos (comida, salidas, café), no usar frases defensivas, no más de 2 mensajes ni más de una pregunta.'],
      authority: [promotionMode, ruleA],
      expected: { move: moves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' }, { type: 'action_bonus_in', values: ['ingles_2'] },
        { type: 'question_count_at_most', value: 1 }, ...noContingency],
    }),
    englishTurn('still_expensive_escalation', 'nono me parece caro', {
      must: ['Modo promoción, escalada: sin repetir la pregunta del precio ni volver sólo a cuotas, sumar Inglés 3 además de Inglés 2 explicando qué le agrega, recapitular Inglés 1 + Inglés 2 + Inglés 3 por el mismo valor y cerrar con alternativa de plan.'],
      mustNot: ['No caer en una respuesta de contingencia, no comparar con gastos, no más de una pregunta.'],
      authority: [promotionMode, ruleA],
      expected: { move: moves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [2], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' }, { type: 'action_bonus_in', values: ['ingles_3'] },
        { type: 'response_mentions_all_promotions' }, { type: 'question_count_at_most', value: 1 }, ...noContingency],
    }),
    englishTurn('english_again', 'ignles\ningles'),
    englishTurn('but_expensive', 'pero es caro', {
      must: ['Responder a la nueva objeción conservando el paquete vigente; si el backend decide otra escalada, presentarla con recapitulación.'],
      hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noContingency],
    }),
  ],
}];

/** Owner conversation of 2026-11-02 18:43–18:45 (-03:00), after the reset:
 * "ingles" without a level, then a promo request with a price objection. */
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '21_owner_promotion_mode_replay_20261102_1843',
  title: 'Replay 2/11 18:43: «ingles» sin nivel → pedido de promo por precio → oferta Inglés 1 + Inglés 2, sin contingencia',
  turns: [
    englishTurn('greeting', 'buenas\ncomo estas?'),
    englishTurn('english_price', 'ingles\nquiero saber el precio'),
    englishTurn('promo_because_expensive', 'noo\nquiero saber si hay alguna promo\nme parece caro el precio', {
      must: ['Modo promoción, primera oferta: reconocer el freno del precio, decir que se lo puede resolver, presentar una promoción exclusiva (si avanza con Inglés 1, le bonifica Inglés 2) y cerrar con la alternativa de 12 cuotas de USD 30 o 6 de USD 60.'],
      mustNot: ['No volver sólo a las cuotas, no preguntar de nuevo si el precio es lo único que lo frena, no comparar con gastos, no más de una pregunta.'],
      authority: [promotionMode, ruleA],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'rule_outcomes_recorded' }, { type: 'action_bonus_in', values: ['ingles_2'] },
        { type: 'question_count_at_most', value: 1 }, ...noContingency],
    }),
    englishTurn('only_price', 'solo el precio', {
      must: ['Responder conservando el paquete vigente y avanzar al cierre; si el backend decide una escalada, presentarla con recapitulación.'],
      hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noContingency],
    }),
  ],
});

/** Owner conversation of 2026-11-02 19:20–19:24: the offer worked; asking for
 * the syllabus right after it fell into the contingency (unsupported "desde cero"). */
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '22_owner_promotion_mode_replay_20261102_1920',
  title: 'Replay 2/11 19:20: promo confirmada → «y el programa?» responde el temario sin contingencia',
  turns: [
    englishTurn('promo_first', 'no hay ningna promo\nque me puedas ofrecer?'),
    englishTurn('english', 'ingles'),
    englishTurn('from_zero_price', 'seria de 0\ncual es el precio'),
    englishTurn('price_only_confirmed', 'si\nes el un inconveniente', {
      must: ['Confirmó que el precio es el único inconveniente: presentar la promoción exclusiva (Inglés 1 con Inglés 2 bonificado) y cerrar con alternativa de plan.'],
      authority: [promotionMode, ruleA],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['ingles_2'] }, ...noContingency],
    }),
    englishTurn('syllabus', 'y el programa?', {
      must: ['Responder qué incluye Inglés 1 con hechos autorizados, conservando el paquete vigente, sin contingencia.'],
      hard: [{ type: 'workflow_committed' }, ...noContingency],
    }),
  ],
});

/** Owner live test of 2026-11-03 07:31–07:42 (-03:00), "Emma vende". The first two
 * turns fell into the contingency (DeepSeek 503/timeout); the bonus choice was
 * answered with an administrative register. The setup turn reproduces the
 * live package (Inglés 1 + Inglés 2) the contact already had. */
const valueRegister = [
  { type: 'not_contains', value: 'compra aparte' } as const, { type: 'not_contains', value: 'No es un cambio' } as const,
  { type: 'not_contains', value: 'sigue siendo USD' } as const, { type: 'not_contains', value: 'precio no cambia' } as const,
  { type: 'not_contains', value: 'Qué dato o qué curso' } as const, ...noContingency];
const emmaSells = owner(114, 114, 'Emma vende');
const setupPackage = englishTurn('setup_live_package', 'me interesa ingles 1, desde cero\ntenés alguna promo? me parece caro', {
  must: ['Presentar la promoción exclusiva: Inglés 1 con Inglés 2 bonificado, con valor y cierre de plan.'],
  authority: [promotionMode, ruleA],
  expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
    promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
  hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['ingles_2'] }, ...valueRegister],
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '23_owner_emma_vende_replay_20261103_0731',
  title: 'Replay 3/11 07:31: pago sin curso → precio real; «me bonificas uno de los dos?» → se suma con registro de valor',
  turns: [
    englishTurn('payment_without_course', 'quiero saber como es el tema del pago\npuede ser?\nbuenas', {
      must: ['Dar el valor real (USD 360) con los planes reales y preguntar qué curso le interesa.'],
      authority: [emmaSells],
      hard: [{ type: 'workflow_committed' }, { type: 'contains', value: '360' }, ...valueRegister],
    }),
    englishTurn('not_defined_yet', 'no lo he definido aun', { authority: [emmaSells],
      hard: [{ type: 'workflow_committed' }, ...valueRegister] }),
    setupPackage,
    englishTurn('bonify_one_of_two', 'y si yo tengo el curso de ingles 1 y armado y reparacion de pc, me bonificas uno de los dos?', {
      must: ['Decir que sí: sumar Armado y Reparación de PC de regalo y recapitular el paquete como ganancia (tres cursos al precio de uno), cerrando con una sola pregunta con energía.'],
      mustNot: ['No usar «compra aparte», «no es un cambio», «el precio sigue siendo» ni abrir con «la bonificación ya está aplicada».'],
      authority: [emmaSells, ruleA],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [2], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['armado_reparacion_pc'] },
        { type: 'question_count_at_most', value: 1 }, ...valueRegister],
    }),
  ],
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '24_owner_emma_vende_swap_20261103_0741',
  title: 'Replay 3/11 07:41: «no puedo cambiar Inglés 2 por Reparación de PC?» → se cambia el único bonificado',
  turns: [
    setupPackage,
    englishTurn('swap_only_bonus', 'osea no puedo cambiar ingles 2 por armado y reparacion de pc?', {
      must: ['Decir que sí y cambiarlo: Inglés 1 + Armado y Reparación de PC de regalo, dos cursos al precio de uno, con cierre de una sola pregunta.'],
      mustNot: ['No negar el cambio ni usar tono administrativo.'],
      authority: [emmaSells, ruleA],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['armado_reparacion_pc'] },
        { type: 'question_count_at_most', value: 1 }, ...valueRegister],
    }),
  ],
});

export const OWNER_PROMOTION_MODE_REPLAY_CASES: readonly GoldenCaseV1[] = OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE;
