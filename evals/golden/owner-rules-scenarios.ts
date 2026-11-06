import type { AuthorityReference, GoldenCaseV1, GoldenTurnV1 } from './scenarios';
import { OWNER_REPLAY_CUSTOMER_TURNS_V1 } from './owner-conversation-2026-11-02';
import { authorizedBonusCodesV1 } from '../../src/shared/conversation/deterministic-sales-rules';
import { fichaOfferingCodes } from '../../src/shared/catalog/gabi-fichas';

// Supplemental campaign: never included in the unchanged formal 16-case/48-turn gate.
// Authority since 2026-11-03 (AGENTS.md «Venta interpretada por el modelo», lines 148-190): the backend validates
// PERMISSIONS and facts; the model decides strategy, call timing, promotion timing and wording. Nothing here is
// required by a backend rule: expectations are the prompt's guidance judged on REAL model output, plus hard
// facts/effects (prices, max 3, one per turn, checkout, link, enrollment).
const gabi = (start: number, end: number, contains: string): AuthorityReference => ({
  file: 'docs/authority/prompt-agente-a-studyx-v2.md', start, end, contains,
});
const owner = (start: number, end: number, contains: string): AuthorityReference => ({
  file: 'AGENTS.md', start, end, contains,
});
const permission = owner(154, 154, 'motivo del mensaje actual');
const limits = owner(157, 157, 'máximo 3, uno por turno');
const affinity = owner(161, 161, 'afinidad como pertenencia');
const yesIsGuide = owner(163, 163, 'autoriza sólo si el turno anterior');
const retention = owner(164, 164, 'Retención');
const effectsApart = owner(165, 165, 'Respuesta y efectos independientes');
const noForcedRules = owner(168, 168, 'fuerce llamadas o preguntas de precio');
const singleFallback = owner(169, 169, 'Respaldos fijos');
const noInvasion = owner(183, 183, 'Nunca dos turnos seguidos pidiendo inscripción');
const baseAuthority = [gabi(38, 46, 'Una recomendación no es elección'), gabi(104, 125, 'price_objection')];
const moves = ['greeting', 'browse_catalog', 'select_course', 'ask_course_information', 'ask_payment_options',
  'unknown', 'continue_by_chat', 'defer_payment', 'request_call', 'decline_purchase'];
const allActions = ['none', 'offer_course_bonus', 'accept_promotion'];
/** Bonus candidates are set membership (AGENTS.md:161): the same function the backend uses for the permission
 * (ficha «Combinalo con» + career routes, affinity row, universal bridges) over the courses with a ficha. */
const affinitySet = (paid: string): string[] => authorizedBonusCodesV1({ paid_code: paid, active_codes: fichaOfferingCodes() });
const ecommerceSet = affinitySet('introduccion_ecommerce');
const noBeca = [{ type: 'not_contains', value: 'beca' } as const, { type: 'not_contains', value: '699' } as const];
function turn(id: string, customer: string, override: Partial<GoldenTurnV1> = {}): GoldenTurnV1 {
  return {
    id, customer,
    must: ['Responder al mensaje actual con hechos autorizados y un próximo paso apropiado.'],
    mustNot: ['No inventar datos del catálogo, descuentos, acciones ejecutadas ni bonificaciones sin efecto autorizado.'],
    authority: [...baseAuthority, noForcedRules],
    expected: { move: moves, action: ['none'], state: {} },
    hard: [{ type: 'workflow_committed' }],
    ...override,
  };
}
const noBonus = { promotion: { status: [null, 'none'], bonusCount: [0] } } as const;
/** A bonus turn: the model decides whether to offer (permission is the backend's). `required` marks the turns
 * where the authority prompt itself says to offer (e.g. the customer's explicit «sí, sólo el precio»). */
function bonusTurn(id: string, customer: string, counts: readonly number[], options: {
  readonly required?: boolean; readonly set?: readonly string[]; readonly paid?: string; readonly extra?: Partial<GoldenTurnV1>;
} = {}): GoldenTurnV1 {
  const { required = false, set = ecommerceSet, paid = 'introduccion_ecommerce', extra = {} } = options;
  return turn(id, customer, {
    must: [required
      ? 'La guía del prompt pide presentar un bonificado afín del conjunto autorizado, mantener el precio del principal y cerrar con una sola pregunta. Si es el 2.º o 3.º, recapitular el paquete completo.'
      : 'Responder a la objeción con valor conectado a su objetivo. El modelo decide si ofrece ya un bonificado afín o primero pregunta una vez si el precio es lo único que lo frena; no es obligatorio ofrecer. Si suma uno, recapitular el paquete.'],
    mustNot: ['No cambiar el curso pago, repetir un bonificado, añadir dos nuevos en el mismo turno ni supeditar la oferta a una llamada.',
      'No mencionar beca ni el precio de 699.'],
    authority: [permission, affinity, limits, gabi(141, 149, 'recuerda en pocas palabras el paquete completo'), gabi(160, 165, 'Mapa de afinidades')],
    expected: { move: moves, action: required ? ['offer_course_bonus'] : ['none', 'offer_course_bonus'], state: {
      promotion: { status: ['offer_available', ...(required ? [] : [null, 'none'])], bonusCount: counts, paidCourse: [paid, ...(required ? [] : [null])] },
    } },
    hard: [{ type: 'workflow_committed' }, { type: 'course_bonus_preconditions' },
      required ? { type: 'action_bonus_in', values: set } : { type: 'bonus_in_when_offered', values: set },
      { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    ...extra,
  });
}

export const OWNER_GOLDEN_CASES: readonly GoldenCaseV1[] = [
  {
    id: '17_owner_marketing_ecommerce_ladder',
    title: 'Presupuesto/marketing → Ecommerce con hechos del turno → objeciones de precio: el modelo decide el bonificado dentro del permiso',
    turns: [
      turn('greeting', 'Hola'),
      turn('recommendation', 'Qué me podés recomendar para seguir estudiando?'),
      turn('marketing_budget', 'Tengo poco presupuesto y quiero algo de marketing para vender los productos de mi tienda online.', {
        must: ['Responder al objetivo de vender en su tienda online.'],
        mustNot: ['No convertir poco presupuesto en autorización para regalar un curso.',
          'No ofrecer una llamada: el cliente no la pidió ni hay una duda compleja (el modelo decide la llamada, no el backend).'],
        authority: [noForcedRules, noInvasion],
        expected: { move: moves, action: ['none'], state: noBonus },
        hard: [{ type: 'workflow_committed' }],
      }),
      turn('ecommerce_facts_now', 'Ecommerce me gusta. Cuánto es el total y cuántas clases son?', {
        must: ['Responder el precio total autorizado y la duración de Ecommerce con hechos de ese mismo turno: 8 clases en el fixture local.'],
        mustNot: ['No usar duración o temario de Marketing Digital ni inventar 16 clases para Ecommerce.'],
        authority: [...baseAuthority, gabi(54, 60, 'duración'), gabi(110, 117, 'USD 360'), noForcedRules],
        hard: [{ type: 'workflow_committed' }, { type: 'current_course_facts_present', value: 'introduccion_ecommerce' }],
      }),
      bonusTurn('first_price_objection', 'Me parece muy caro.', [0, 1], {
        extra: { hard: [{ type: 'workflow_committed' }, { type: 'course_bonus_preconditions' }, { type: 'bonus_in_when_offered', values: ecommerceSet },
          { type: 'current_price_objection_recorded' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca] },
      }),
      bonusTurn('price_only_first_bonus', 'Sí, sólo el precio me frena; sigue siendo caro.', [1, 2], { required: true }),
      bonusTurn('second_bonus', 'Me suma, pero el precio me sigue pareciendo caro.', [1, 2, 3]),
      turn('third_bonus', 'El curso me interesa, pero todavía no me alcanza por el precio.', {
        must: ['Mantener el precio y el paquete vigente. Con el permiso concedido puede sumar el 3.º bonificado (un curso pago + tres bonificados es el paquete máximo y es válido: no es un cuarto bonificado); si lo suma, recapitula el paquete completo.'],
        mustNot: ['No ofrecer, insinuar ni materializar un CUARTO bonificado (más de tres bonificados además del curso pago); «cuatro cursos al precio de uno» para 1 pago + 3 bonificados es el registro autorizado.', 'No mencionar beca ni el precio de 699.'],
        authority: [limits, permission, gabi(138, 144, 'Máximo de cursos bonificados')],
        expected: { move: moves, action: ['none', 'offer_course_bonus'], state: {
          promotion: { status: ['offer_available'], bonusCount: [1, 2, 3], paidCourse: ['introduccion_ecommerce'] },
        } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
      }),
      turn('no_fourth', 'Y otro curso gratuito más también?', {
        must: ['Mantener el precio y el paquete. Si aún no hay tres bonificados, puede sumar el 3.º en este turno o en el anterior (no se exige un turno concreto); con tres ya entregados, conserva el paquete y propone avanzar o deja la puerta abierta.'],
        mustNot: ['No ofrecer, insinuar ni materializar un CUARTO bonificado (más de tres además del curso pago). Decir «cuatro cursos al precio de uno» para 1 pago + 3 bonificados es el registro de valor autorizado: no es una violación.'],
        authority: [limits, gabi(138, 144, 'Máximo de cursos bonificados')],
        expected: { move: [...moves, 'ask_current_state'], action: ['none', 'offer_course_bonus'], state: { promotion: { status: ['offer_available'], bonusCount: [1, 2, 3], paidCourse: ['introduccion_ecommerce'] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 3 }],
      }),
    ],
  },
  {
    id: '18_explicit_promotion_request',
    title: 'Pedido de promoción: sin evidencia de precio no hay permiso (se pregunta una vez por el precio); con objeción citada el modelo puede bonificar; sin descuento de precio',
    turns: [
      turn('request_without_objection', 'Me interesa Introducción al Ecommerce para vender los productos de mi tienda online. Tenés alguna promoción para sumar un curso gratuito?', {
        must: ['Responder con entusiasmo y volver con naturalidad, una sola vez, a si el precio es lo único que lo frena (guía del prompt). El pedido de promoción sin evidencia de precio no habilita todavía la bonificación.'],
        mustNot: ['No afirmar que ya le bonifica un curso ni inventar un descuento de precio.'],
        authority: [yesIsGuide, permission, effectsApart],
        expected: { move: moves, action: ['none'], state: noBonus },
        hard: [{ type: 'workflow_committed' }, { type: 'question_count_at_most', value: 1 }, ...noBeca],
      }),
      bonusTurn('price_only_with_promo_request', 'Sólo el precio me frena, me parece caro. Ofreceme esa promoción para sumar un curso sin costo.', [1], {
        required: true,
        extra: { mustNot: ['No supeditar la oferta a una llamada ni ofrecer una llamada sin que el cliente la pida.',
          'No mencionar beca ni el precio de 699.'] },
      }),
      turn('negated_price', 'Prefiero seguir por chat. No es caro y no necesito otra promo, sólo quería saber cómo sigue.', {
        must: ['Respetar chat y conservar el paquete vigente: una negación no es objeción ni pedido de promoción.'],
        mustNot: ['No usar las palabras aisladas caro o promo, negadas, como evidencia para escalar.', 'No ofrecer una llamada.'],
        authority: [permission, owner(40, 43, 'Las preguntas'), noForcedRules],
        expected: { move: moves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [1] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 1 }],
      }),
      turn('price_question', 'Es caro? Te pregunto, no estoy diciendo que me parezca caro.', {
        must: ['Responder a la pregunta con valor/inversión por resultado, sin convertirla en una nueva objeción de precio ni ampliar el paquete.'],
        mustNot: ['No ofrecer un segundo bonificado por una pregunta o por una cita parcial de caro.', 'No mencionar beca ni el precio de 699.'],
        authority: [permission, owner(40, 43, 'Las preguntas'), noForcedRules],
        expected: { move: moves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [1] } } },
        hard: [{ type: 'workflow_committed' }, { type: 'promotion_bonus_count_at_most', value: 1 }, ...noBeca],
      }),
      bonusTurn('new_objection_after_offer', 'Ahora sí, el precio me sigue pareciendo caro y no me alcanza.', [1, 2]),
    ],
  },
];

export const OWNER_REPLAY_CASES: readonly GoldenCaseV1[] = [{
  id: '19_owner_conversation_replay_20261102',
  title: 'Replay de los 11 mensajes del dueño del 2/11, con respuestas nuevas de DeepSeek real',
  turns: OWNER_REPLAY_CUSTOMER_TURNS_V1.map((source, index) => {
    if (index === 6) return bonusTurn(source.id, source.customer, [1, 2], { required: true });
    return turn(source.id, source.customer, {
      must: ['Responder sin silencio al mensaje real de este turno, conservando la intención y los hechos de la conversación.'],
      expected: { move: moves, action: allActions, state: {} },
      ...(index === 3 ? {
        must: ['Responder sobre marketing y presupuesto, descubriendo lo que necesita.'],
        mustNot: ['No ofrecer una llamada antes de que el cliente la pida o haya una duda compleja.'],
        authority: [noForcedRules, noInvasion],
        hard: [{ type: 'workflow_committed' }],
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
/** Inglés 1 affinity row + universal bridges + the course the customer names literally in case 23/24. */
const englishSet = [...affinitySet('ingles_1'), 'armado_reparacion_pc'];
const noContingency = [{ type: 'not_contains', value: 'no te entendí bien' } as const,
  { type: 'not_contains', value: 'Qué dos cursos comparamos' } as const];
const promotionMode = permission;
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
      must: ['Reconocer el freno del precio. La objeción está citada, así que el modelo puede bonificar; si decide hacerlo, presentar la promoción (Inglés 1 con un bonificado afín del conjunto autorizado) explicando por qué le suma a aprender desde cero y cerrar con una sola pregunta; si decide preguntar primero por el precio, hacerlo una sola vez. No es obligatorio ofrecer en este turno.'],
      mustNot: ['No abrir con el precio ni con «el precio no cambia», no volver sólo a las cuotas, no comparar con gastos (comida, salidas, café), no usar frases defensivas, no más de 2 mensajes ni más de una pregunta, no mencionar beca ni 699.'],
      authority: [permission, affinity, limits],
      expected: { move: moves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['ingles_1', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'bonus_in_when_offered', values: englishSet },
        { type: 'question_count_at_most', value: 1 }, ...noBeca, ...noContingency],
    }),
    englishTurn('still_expensive_escalation', 'nono me parece caro', {
      must: ['Nueva queja de precio tras la oferta: sin repetir la pregunta del precio ni volver sólo a cuotas. El modelo decide si suma otro bonificado afín (explicando qué le agrega y recapitulando el paquete completo) o si refuerza el valor del paquete vigente; en ambos casos cierra con una sola pregunta.'],
      mustNot: ['No caer en una respuesta de contingencia, no comparar con gastos, no más de una pregunta, no mencionar beca ni 699.'],
      authority: [permission, affinity, limits],
      expected: { move: moves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1, 2], paidCourse: ['ingles_1', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'bonus_in_when_offered', values: englishSet },
        { type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'question_count_at_most', value: 1 }, ...noBeca, ...noContingency],
    }),
    englishTurn('english_again', 'ignles\ningles'),
    englishTurn('but_expensive', 'pero es caro', {
      must: ['Responder a la nueva objeción conservando el paquete vigente; si el modelo decide otra escalada dentro del permiso, presentarla con recapitulación.'],
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
      must: ['Reconocer el freno del precio (objeción citada). El modelo decide si presenta ya la promoción (Inglés 1 con un bonificado afín) o si pregunta primero, una sola vez, si el precio es lo único que lo frena; no es obligatorio ofrecer.'],
      mustNot: ['No volver sólo a las cuotas, no preguntar dos veces si el precio es lo único que lo frena, no comparar con gastos, no más de una pregunta, no mencionar beca ni 699.'],
      authority: [permission, affinity, limits, yesIsGuide],
      expected: { move: replayMoves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['ingles_1', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'bonus_in_when_offered', values: englishSet },
        { type: 'question_count_at_most', value: 1 }, ...noBeca, ...noContingency],
    }),
    englishTurn('only_price', 'solo el precio', {
      must: ['Responder conservando el paquete vigente y avanzar sin invadir; si el modelo decide una escalada dentro del permiso, presentarla con recapitulación.'],
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
      must: ['Confirmó que el precio es el único inconveniente: la guía del prompt pide presentar la promoción (Inglés 1 con un bonificado afín del conjunto autorizado) y cerrar con una sola pregunta.'],
      authority: [permission, affinity, limits, yesIsGuide],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: englishSet }, ...noBeca, ...noContingency],
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
  must: ['Quiere Inglés 1 desde cero, pide promo y dice que le parece caro (objeción citada). Presentar la promoción (Inglés 1 con un bonificado afín del conjunto autorizado) con registro de valor, o preguntar primero una sola vez por el precio; el modelo decide.'],
  authority: [permission, affinity, limits, yesIsGuide],
  expected: { move: replayMoves, action: ['none', 'offer_course_bonus'], state: {
    promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['ingles_1', null] } } },
  hard: [{ type: 'workflow_committed' }, { type: 'bonus_in_when_offered', values: englishSet }, ...noBeca, ...valueRegister],
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
      must: ['Elección del regalo por el cliente (nombró el curso literal, queda dentro del conjunto autorizado): decir que sí, sumar Armado y Reparación de PC de regalo y recapitular el paquete como ganancia (tres cursos al precio de uno), cerrando con una sola pregunta con energía.'],
      mustNot: ['No usar «compra aparte», «no es un cambio», «el precio sigue siendo» ni abrir con «la bonificación ya está aplicada».'],
      authority: [emmaSells, permission, affinity, limits],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1, 2], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['armado_reparacion_pc'] },
        { type: 'question_count_at_most', value: 1 }, ...noBeca, ...valueRegister],
    }),
  ],
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '24_owner_emma_vende_swap_20261103_0741',
  title: 'Replay 3/11 07:41: «no puedo cambiar Inglés 2 por Reparación de PC?» → se cambia el único bonificado',
  turns: [
    setupPackage,
    englishTurn('swap_only_bonus', 'osea no puedo cambiar ingles 2 por armado y reparacion de pc?', {
      must: ['Decir que sí y cambiarlo (con un solo bonificado el cambio por un curso nombrado literalmente no necesita nueva evidencia de precio): Inglés 1 + Armado y Reparación de PC de regalo, dos cursos al precio de uno, con cierre de una sola pregunta.'],
      mustNot: ['No negar el cambio ni usar tono administrativo.'],
      authority: [emmaSells, permission, affinity, limits],
      expected: { move: replayMoves, action: ['offer_course_bonus'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['ingles_1'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'action_bonus_in', values: ['armado_reparacion_pc'] },
        { type: 'question_count_at_most', value: 1 }, ...valueRegister],
    }),
  ],
});

/** Gabi's live test of 2026-11-03 12:28 (-00:00): a course outside the catalog,
 * the agent proposes the closest one and the customer answers "sí, ese curso".
 * Live it fell into "Perdón, no te entendí bien" (COURSE_NOT_RESOLVED during the
 * audit_log permission outage). Real Estate is not in the eval catalog, so the
 * same pattern uses Aires Acondicionados. */
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '25_gabi_ese_curso_replay_20261103_1228',
  title: 'Replay 3/11 12:28 (Gabi): curso inexistente → propuesta cercana → «sí, ese curso» sin contingencia',
  turns: [
    englishTurn('course_outside_catalog', 'hola buen dia.\ncomo estan ?\nestoy interesado en informacion sobre el curso de tecnico en refrigeracion', {
      must: ['Saludar, aclarar con naturalidad que ese curso puntual no está y proponer el más cercano del catálogo (Aires Acondicionados), con una pregunta de avance.'],
      authority: [emmaSells], hard: [{ type: 'workflow_committed' }, ...valueRegister],
    }),
    englishTurn('that_course', 'si, ese curso es el que me interesa', {
      must: ['Entender que «ese curso» es el único que acaba de proponer (Aires Acondicionados) y seguir con ese curso (valor, contenido o siguiente paso), sin pedir aclaración ni afirmar datos que no estén en la ficha.'],
      authority: [emmaSells, singleFallback], hard: [{ type: 'workflow_committed' },
        { type: 'selected_course_equals', value: 'aires_acondicionados' }, ...valueRegister],
    }),
    englishTurn('what_dont_you_get', 'que no entendes ?', {
      must: ['Responder con naturalidad, sin contingencia, retomando el curso elegido y avanzando.'],
      authority: [emmaSells], hard: [{ type: 'workflow_committed' }, ...valueRegister],
    }),
  ],
});

/** Owner live test of 2026-11-03 13:21 (yes-only promo): the price question
 * appeared twice (model paraphrase + fixed bubble) and "si me sirve el precio si"
 * next to a promo request was not read as the yes. */
const onePriceQuestion = { type: 'not_contains', value: 'Te puedo buscar una promoción que se adapte si es el caso' } as const;
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '26_owner_yes_only_promo_20261103_1321',
  title: 'Replay 3/11 13:21: pedido de promo → una sola pregunta del precio → «sí» junto al pedido → promo',
  turns: [
    englishTurn('course_and_price', 'me interesa decoracion de interiores para ambientar propiedades\ncuanto sale?', {
      authority: [emmaSells], hard: [{ type: 'workflow_committed' }, ...valueRegister],
    }),
    englishTurn('promo_request', 'y la promo, cuál me podes ofrecer?', {
      must: ['Sin evidencia de precio el backend no permite bonificar: volver con naturalidad a la pregunta de si el precio es lo único que lo frena (guía del prompt, una sola vez en el turno).'],
      authority: [emmaSells, yesIsGuide, permission], hard: [{ type: 'workflow_committed' }, { type: 'question_count_at_most', value: 1 }, onePriceQuestion, ...valueRegister],
    }),
    englishTurn('yes_with_promo_request', 'quiero ver, qué me podes ofrecer\nsi me sirve el precio si', {
      must: ['Tomarlo como el «sí» (guía del prompt): si el permiso del backend lo habilita, presentar la promoción en este turno (Decoración de Interiores con un bonificado afín), con valor y una sola pregunta de cierre, sin muletillas ni repetir la descripción del curso. Si el backend no lo permite (sin evidencia de precio persistida), responder con valor sin afirmar un bonificado.'],
      authority: [emmaSells, yesIsGuide, permission, affinity, limits],
      expected: { move: replayMoves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['decoracion_de_interiores', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'bonus_in_when_offered', values: affinitySet('decoracion_de_interiores') },
        { type: 'question_count_at_most', value: 1 }, onePriceQuestion, ...noBeca, ...valueRegister],
    }),
  ],
});


/** Case 27: the owner's live "Marketing 03/11" conversation. The exact transcript is NOT available: the customer
 * side is a faithful reconstruction from the owner's description. The owner's observation of the run at 12d564b
 * (baseline for this case) is recorded in docs/reports/2026-11-03-model-owned-sales/05-golden-plan.md.
 * Everything below is judged on REAL model output; nothing here is a backend rule. */
const marketingMoves = [...moves, 'request_payment_link', 'provide_contact_details'];
const marketingSet = affinitySet('marketing_digital');
const marketingTurn = (id: string, customer: string, override: Partial<GoldenTurnV1> = {}) => turn(id, customer, {
  expected: { move: marketingMoves, action: ['none'], state: {} },
  ...override,
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '27_owner_marketing_20261103',
  title: 'Marketing 03/11 (reconstruida): descubrimiento → precio informativo → objeción de valor con promo afín → retomar conversación → compra',
  reconstructed: true,
  note: 'transcripción exacta pendiente del dueño',
  turns: [
    marketingTurn('asks_marketing', 'Hola, buenas tardes. Quiero información del curso de Marketing Digital', {
      must: ['Identificar Marketing Digital y empezar por el descubrimiento: una sola pregunta sobre lo que quiere lograr o su situación, sin precio ni cierre todavía.'],
      mustNot: ['No ofrecer una llamada, no pedir inscripción ni plan, no abrir con el precio, no cerrar con «?!».'],
      authority: [noForcedRules, noInvasion, gabi(36, 46, 'Descubre sólo lo que te sirve para vender')],
      hard: [{ type: 'workflow_committed' }, { type: 'contains', value: 'Marketing Digital' },
        { type: 'no_call_offer' }, { type: 'no_enrollment_ask' }, { type: 'question_count_at_most', value: 1 },
        { type: 'not_contains', value: '?!' }, ...noBeca],
    }),
    marketingTurn('goal_brands', 'Me gustaría trabajar con marcas, llevarles las redes y la publicidad', {
      must: ['Usar el objetivo «trabajar con marcas» para conectar el curso con lo que vería y cómo lo aplicaría; seguir descubriendo o dar valor sin presionar. El modelo registra el objetivo con su cita literal.'],
      mustNot: ['No ofrecer una llamada, no pedir inscripción ni plan, no prometer empleo ni ingresos.'],
      authority: [noForcedRules, noInvasion, gabi(36, 46, 'Lo que descubres es tu munición')],
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, { type: 'no_enrollment_ask' },
        { type: 'question_count_at_most', value: 1 }, { type: 'not_contains', value: '?!' }, ...noBeca],
    }),
    marketingTurn('informative_price', 'qué precio tiene?', {
      must: ['Responder el precio con los planes reales (USD 360; 12 cuotas de USD 30, 6 de USD 60 o un pago) conectando el valor con trabajar con marcas. Es una pregunta informativa: la respuesta es corta y natural.'],
      mustNot: ['No tratarla como objeción: no decir que el precio es el único inconveniente ni preguntar si lo es, no ofrecer promoción ni bonificado, no ofrecer una llamada, no pedir inscripción ni plan, no cerrar con «?!», no mencionar beca ni 699.'],
      authority: [noForcedRules, noInvasion, effectsApart, gabi(110, 117, 'USD 360')],
      hard: [{ type: 'workflow_committed' }, { type: 'contains', value: '360' }, { type: 'no_call_offer' },
        { type: 'no_enrollment_ask' }, { type: 'not_contains', value: 'único inconveniente' },
        { type: 'not_contains', value: 'unico inconveniente' }, { type: 'not_contains', value: '?!' }, ...noBeca],
    }),
    marketingTurn('value_objection', 'mmm, es bastante para mí ahora', {
      must: ['Objeción de valor/presupuesto citada: el permiso del backend está concedido. Trabajar el valor ligado a trabajar con marcas; el modelo decide: o presenta un bonificado afín del conjunto autorizado (p. ej. Publicidad en Redes Sociales o Community Manager), o aísla una sola vez la objeción preguntando o invitando a confirmar si el precio es lo único que lo frena (cualquier formulación natural vale; sin ofrecer aún el curso). No es obligatorio bonificar en este turno.'],
      mustNot: ['No ofrecer descuento de precio, no mencionar beca ni 699, no ofrecer una llamada, no cerrar con «?!» salvo en la oferta de la promo.'],
      authority: [permission, affinity, limits, yesIsGuide, retention],
      expected: { move: marketingMoves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['marketing_digital', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'course_bonus_preconditions' },
        { type: 'bonus_in_when_offered', values: marketingSet }, { type: 'no_call_offer' }, ...noBeca],
    }),
    marketingTurn('price_only_yes', 'sí, es solo el precio lo que me frena', {
      must: ['Confirmó que el precio es lo único: presentar un bonificado afín del conjunto autorizado (p. ej. Publicidad en Redes Sociales o Community Manager; el modelo elige) explicando cómo le sirve para trabajar con marcas, mantener el precio y cerrar con una sola pregunta; el cierre enérgico es válido sólo aquí (oferta final/promo).'],
      mustNot: ['No cambiar el curso pago, no ofrecer una llamada, no mencionar beca ni 699.'],
      authority: [permission, affinity, limits, yesIsGuide, noInvasion],
      expected: { move: marketingMoves, action: ['offer_course_bonus', 'none'], state: {
        promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['marketing_digital'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'course_bonus_preconditions' },
        { type: 'bonus_in_when_offered', values: marketingSet }, { type: 'no_call_offer' },
        { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    marketingTurn('short_reply', 'ok, gracias', {
      must: ['Respuesta corta y sin presión que deja la puerta abierta; conserva el paquete vigente.'],
      mustNot: ['No pedir inscripción ni plan tras un «ok, gracias», no ofrecer una llamada, no repetir la oferta literal.'],
      authority: [noInvasion, noForcedRules],
      expected: { move: marketingMoves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['marketing_digital'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, { type: 'not_repeat_previous_reply' }, ...noBeca],
    }),
    marketingTurn('resume', 'hola, sigo interesada', {
      must: ['Retomar la conversación con calidez conservando el paquete ya ofrecido (Marketing Digital + el bonificado que el agente ofreció en el turno de la promo, sin cambiarlo) y el objetivo de trabajar con marcas, con información nueva o una pregunta que avance.'],
      mustNot: ['No repetir literalmente ninguna respuesta anterior del agente, no volver a presentar la promoción como si fuera nueva, no ofrecer una llamada, no cerrar con «?!» mecánico.'],
      authority: [noForcedRules, noInvasion, effectsApart, gabi(23, 23, 'Responde sólo con información nueva')],
      expected: { move: marketingMoves, action: ['none'], state: { promotion: { status: ['offer_available'], bonusCount: [1], paidCourse: ['marketing_digital'] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, { type: 'not_repeat_previous_reply' },
        { type: 'not_contains', value: '?!' }, ...noBeca],
    }),
    marketingTurn('classes_question', 'cuántas clases son y cómo se cursan?', {
      must: ['Responder con los hechos autorizados de duración y modalidad, conectados con trabajar con marcas, con una sola pregunta de avance si corresponde.'],
      mustNot: ['No pedir inscripción ni plan en dos turnos seguidos: si el turno anterior ya invitó a avanzar, no repetirlo hasta tener información nueva. No ofrecer una llamada.'],
      authority: [noInvasion, noForcedRules],
      hard: [{ type: 'workflow_committed' }, { type: 'current_course_facts_present', value: 'marketing_digital' },
        { type: 'no_call_offer' }, { type: 'no_consecutive_enrollment_ask' }, { type: 'not_contains', value: '?!' }, ...noBeca],
    }),
    marketingTurn('buying_signal', 'me convenciste, quiero inscribirme', {
      must: ['Señal real de compra: dejar de argumentar y avanzar a la inscripción (plan de pago o los datos faltantes), usando una vez el objetivo de trabajar con marcas. Es el único turno donde pedir inscripción corresponde.'],
      mustNot: ['No volver a vender beneficios, no ofrecer una llamada, no mencionar beca ni 699.'],
      authority: [noInvasion, gabi(183, 192, 'Plan, datos y pago')],
      expected: { move: [...marketingMoves, 'ask_payment_options', 'select_payment_plan'], action: ['none', 'accept_promotion', 'select_payment_plan', 'send_payment_link'], state: {} },
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, ...noBeca],
    }),
  ],
});

/** Case 28: Gabi's material (2026-11-03, docs/authority/material-gabi-2026-11-03). Judged on real model output;
 * hard checks are facts (no beca, no 699), semantic checks are the manual's guidance. */
const gabiSet = affinitySet('unas_gelificadas');
const gabiTurn = (id: string, customer: string, override: Partial<GoldenTurnV1> = {}) => turn(id, customer, {
  expected: { move: marketingMoves, action: ['none'], state: {} },
  ...override,
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '28_gabi_material_20261103',
  title: 'Material de Gabi: «es caro», «lo voy a pensar», título oficial, licencia, testimonio por afinidad y bonificado por «Combínalo con»',
  turns: [
    gabiTurn('interest', 'Hola, quiero hacer el curso de Uñas Gelificadas para trabajar por mi cuenta', {
      must: ['Identificar Uñas Gelificadas y descubrir lo justo (experiencia, cómo piensa trabajar) con una sola pregunta.'],
      mustNot: ['No ofrecer una llamada, no pedir inscripción ni plan todavía.'],
      authority: [noForcedRules, noInvasion],
      hard: [{ type: 'workflow_committed' }, { type: 'selected_course_equals', value: 'unas_gelificadas' },
        { type: 'no_call_offer' }, { type: 'no_enrollment_ask' }, ...noBeca],
    }),
    gabiTurn('expensive', 'es caro', {
      must: ['Responder con valor/inversión por resultado (lo que puede generar trabajando por su cuenta), sin justificarse; la objeción citada habilita el permiso de bonificar y el modelo decide si ofrece ya un bonificado afín o pregunta una vez por el precio. El bonificado, si lo hay, es un curso del conjunto autorizado elegido por el «Combínalo con» de la ficha (Maquillaje Profesional, Estética Integral o Instagram para Emprendedores).'],
      mustNot: ['No mencionar beca, no mencionar el precio de 699, no bajar el precio, no ofrecer una llamada.'],
      authority: [permission, affinity, gabi(83, 107, 'Manejo de objeciones'), owner(177, 177, 'Beca Studyx')],
      expected: { move: marketingMoves, action: ['none', 'offer_course_bonus'], state: {
        promotion: { status: ['offer_available', null, 'none'], bonusCount: [0, 1], paidCourse: ['unas_gelificadas', null] } } },
      hard: [{ type: 'workflow_committed' }, { type: 'course_bonus_preconditions' }, { type: 'bonus_in_when_offered', values: gabiSet },
        { type: 'no_call_offer' }, ...noBeca],
    }),
    gabiTurn('think_about_it', 'lo voy a pensar', {
      must: ['Responder con una pregunta aclaratoria sobre qué quiere pensar (el curso, el precio o el tiempo), sin empujar ni repetir la oferta.'],
      mustNot: ['No pedir inscripción ni plan, no ofrecer una llamada, no repetir la respuesta anterior, no mencionar beca.'],
      authority: [noInvasion, gabi(83, 107, '«Lo voy a pensar»'), noForcedRules],
      hard: [{ type: 'workflow_committed' }, { type: 'no_enrollment_ask' }, { type: 'no_call_offer' },
        { type: 'question_count_at_most', value: 1 }, { type: 'not_repeat_previous_reply' }, ...noBeca],
    }),
    gabiTurn('official_title', 'es título oficial?', {
      must: ['Responder con honestidad: el diploma es un certificado de Studyx, no un título oficial, universitario ni avalado por el gobierno; sin quitarle valor al curso.'],
      mustNot: ['No afirmar que es un título oficial, universitario o reconocido por el gobierno.'],
      authority: [owner(178, 178, 'nunca título oficial')],
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, ...noBeca],
    }),
    gabiTurn('licensed_trade', 'soy electricista, necesito licencia para instalar paneles solares?', {
      must: ['Honesto: el diplomado de Energía Solar da la base pero no reemplaza la licencia estatal en EE. UU.; indicar que debe consultar el requisito de su estado, sin prometer empleo ni ingresos.'],
      mustNot: ['No afirmar que el diplomado reemplaza o habilita la licencia, no prometer trabajo ni ingresos determinados.'],
      authority: [owner(178, 178, 'licencia estatal')],
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, ...noBeca],
    }),
    gabiTurn('testimonial', 'hay alguien que lo haya hecho y le haya servido?', {
      must: ['Contar una historia real elegida por afinidad con el cliente (sólo las del manual: Felipe Serrano; Cristian y Ana María; Amparo y Edson) sin atribuirles resultados que el manual no dice.'],
      mustNot: ['No inventar nombres, historias ni cifras de alumnos; no prometer que obtendrá los mismos resultados.'],
      authority: [gabi(60, 60, 'Historias de éxito'), owner(176, 176, 'Testimonios sólo los reales')],
      hard: [{ type: 'workflow_committed' }, { type: 'no_call_offer' }, ...noBeca],
    }),
  ],
});

/**
 * Cases 29-41 (owner decision 2026-11-04, AGENTS.md lines 204-210): bonus by current-message motive, turn intent,
 * payment consultation, official programme PDFs and Real Estate. Structural expectations (move, action, effects,
 * package before/after, document part) plus a few text rules; strategy and wording stay the model's.
 */
const mdSet = affinitySet('marketing_digital');
const intentRef = owner(204, 204, 'Intención del mensaje actual');
const motiveRef = owner(205, 205, 'Motivo de bonificación');
const paymentRef = owner(207, 207, 'Consulta de pago');
const noPrefabRef = owner(208, 208, 'Sin CTA prefabricados');
const programRef = owner(209, 209, 'Programa PDF');
const realEstateRef = owner(210, 210, 'Real Estate');
const intentMoves = [...marketingMoves, 'price_objection', 'explicit_promotion_request', 'request_course_program'];
const noPrefab = { type: 'no_prefab_cta' } as const;
const mdBase = (id: string, customer: string, override: Partial<GoldenTurnV1> = {}) => turn(id, customer, {
  expected: { move: intentMoves, action: ['none'], state: {} },
  authority: [intentRef, noPrefabRef, noForcedRules],
  hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_call_offer' }, ...noBeca],
  ...override,
});
const mdInterest = (id = 'interest') => mdBase(id, 'Hola, quiero hacer el curso de Marketing Digital', {
  must: ['Identificar Marketing Digital y descubrir lo justo con una sola pregunta.'],
  mustNot: ['No ofrecer una llamada, no pedir inscripción ni plan, no ofrecer ningún bonificado.'],
  expected: { move: intentMoves, action: ['none'], state: { promotion: { status: [null, 'none'], bonusCount: [0] } } },
  hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'selected_course_equals', value: 'marketing_digital' },
    { type: 'no_call_offer' }, { type: 'question_count_at_most', value: 1 }, ...noBeca],
});
/** «es caro»-style turn: the model may offer (never required); when it does, the motive quotes this message. */
const mdObjection = (id: string, customer: string, counts: readonly number[]) => mdBase(id, customer, {
  must: ['Trabajar el valor ligado a su objetivo; el modelo decide si ofrece ya un bonificado afín (con la cita de este mensaje como motivo) o primero pregunta.'],
  mustNot: ['No bajar el precio, no ofrecer más de un bonificado en el turno, no ofrecer una llamada, no mencionar beca ni 699.'],
  authority: [motiveRef, permission, limits, noPrefabRef],
  expected: { move: intentMoves, action: ['none', 'offer_course_bonus'], state: {
    promotion: { status: ['offer_available', null, 'none'], bonusCount: counts, paidCourse: ['marketing_digital', null] } } },
  hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' },
    { type: 'bonus_in_when_offered', values: mdSet }, { type: 'offered_bonus_named' },
    { type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'no_call_offer' }, ...noBeca],
});
const programMoves = [...intentMoves, 'ask_course_information'];

OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push(
  {
    id: '29_current_motive_first_bonus_20261104',
    title: '«es caro» tras el precio: la primera bonificación sale con motivo price_objection citado del mensaje actual',
    turns: [
      mdInterest(),
      mdBase('informative_price', 'cuánto sale?', {
        must: ['Dar el precio con los planes canónicos (USD 360; 12 × USD 30, 6 × USD 60 o un pago) sin promoción ni bonificado.'],
        mustNot: ['No tratarla como objeción, no ofrecer ni insinuar bonificado, no cerrar con un CTA fijo.'],
        authority: [intentRef, noPrefabRef, owner(195, 195, 'Consulta de precio sola')],
        expected: { move: intentMoves, action: ['none'], state: { promotion: { status: [null, 'none'], bonusCount: [0] } } },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'contains', value: '360' }, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdObjection('expensive', 'es caro', [0, 1]),
    ],
  },
  {
    id: '30_bonus_then_payment_question_20261104',
    title: 'Tras la bonificación, «¿cómo sería el pago?» es una consulta de pago: planes canónicos, sin otro curso, paquete igual, sin link',
    turns: [
      mdInterest(),
      mdObjection('expensive', 'es caro, no me alcanza', [0, 1]),
      mdBase('payment_question', '¿cómo sería el pago?', {
        must: ['Explicar sólo los planes canónicos (12 cuotas de USD 30, 6 de USD 60 o un pago de USD 360), conservando el curso y la promo ya ofrecida; a lo sumo una pregunta útil.'],
        mustNot: ['No ofrecer otro curso ni bonificado, no elegir plan por el cliente, no mandar link, no ofrecer una llamada.'],
        authority: [paymentRef, intentRef, noPrefabRef, motiveRef],
        expected: { move: ['ask_payment_options'], action: ['none'], state: { plan: [null] } },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'package_unchanged' }, { type: 'no_link_delivered' },
          { type: 'contains', value: 'USD 30' }, { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '31_second_step_new_complaint_20261104',
    title: '«igual sigue siendo caro» tras una bonificación: el modelo puede proponer el 2.º paso (permitido, no obligatorio) con motivo del mensaje actual',
    turns: [
      mdInterest(),
      mdObjection('expensive', 'es caro', [0, 1]),
      mdObjection('still_expensive', 'igual sigue siendo caro', [0, 1, 2]),
    ],
  },
  {
    id: '32_buying_signal_no_new_course_20261104',
    title: '«dale, quiero pagar» es señal de compra, no motivo: avanza al checkout sin sumar cursos',
    turns: [
      mdInterest(),
      mdObjection('expensive', 'es caro', [0, 1]),
      mdBase('buying_signal', 'dale, quiero pagar', {
        must: ['Avanzar al checkout: preguntar el plan de pago o pedir los datos que faltan, una sola cosa a la vez.'],
        mustNot: ['No ofrecer otro curso ni bonificado, no volver a vender beneficios, no ofrecer una llamada.'],
        authority: [motiveRef, intentRef, noInvasion, noPrefabRef],
        expected: { move: [...replayMoves, 'select_payment_plan', 'ask_payment_options'], action: ['none', 'accept_promotion', 'send_payment_link'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_new_bonus' }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '33_payment_question_without_plan_20261104',
    title: 'Pregunta de pago sin plan: presenta las opciones canónicas, no elige plan, no manda link',
    turns: [
      mdInterest(),
      mdBase('how_to_pay', 'cómo puedo pagarlo?', {
        must: ['Presentar los tres planes canónicos sin elegir por el cliente; puede cerrar con una sola pregunta o con ninguna.'],
        mustNot: ['No elegir un plan, no mandar link, no ofrecer bonificado ni llamada.'],
        authority: [paymentRef, intentRef, noPrefabRef],
        expected: { move: ['ask_payment_options'], action: ['none'], state: { plan: [null], promotion: { status: [null, 'none'], bonusCount: [0] } } },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_link_delivered' }, { type: 'contains', value: 'USD 30' },
          { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '34_explicit_plan_only_that_link_20261104',
    title: 'Plan explícito («12 cuotas»): sólo el link de ese plan, nunca otro',
    turns: [
      mdInterest(),
      mdBase('explicit_plan', 'quiero pagarlo en 12 cuotas', {
        must: ['Registrar el plan de 12 cuotas y avanzar: pedir los datos que faltan o enviar el link de ESE plan.'],
        mustNot: ['No ofrecer otro plan, otro curso ni bonificado, no mandar el link de otro plan.'],
        authority: [paymentRef, intentRef, noPrefabRef],
        expected: { move: [...replayMoves, 'select_payment_plan', 'ask_payment_options'], action: ['none', 'send_payment_link'],
          state: { plan: ['monthly_12'], promotion: { status: [null, 'none'], bonusCount: [0] } } },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'link_plan_in', values: ['monthly_12'] }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '35_program_pdf_request_20261104',
    title: '«me pasás el temario?» (Marketing Digital): send_course_program y la parte documento presente',
    turns: [
      mdInterest(),
      mdBase('syllabus_request', 'me pasás el temario?', {
        must: ['Presentar el programa con una introducción corta y humana; el PDF es la respuesta, no un resumen que lo reemplace; sin escribir ninguna URL.'],
        mustNot: ['No resumir el temario en lugar de enviar el PDF, no escribir enlaces, no afirmar que ya llegó, no ofrecer una llamada.'],
        authority: [programRef, intentRef, noPrefabRef],
        expected: { move: ['request_course_program'], action: ['send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_sent', value: 'marketing_digital' },
          { type: 'program_image_sent', value: 'marketing_digital' }, { type: 'program_document_kind', value: 'program' },
          { type: 'not_contains', value: 'http' }, { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '36_program_pdf_second_request_20261104',
    title: 'Segundo pedido del mismo PDF: sin segundo documento y con respuesta natural',
    turns: [
      mdInterest(),
      mdBase('syllabus_request', 'me pasás el temario?', {
        expected: { move: ['request_course_program'], action: ['send_course_program'], state: {} },
        authority: [programRef, intentRef, noPrefabRef],
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_sent', value: 'marketing_digital' },
          { type: 'program_image_sent', value: 'marketing_digital' }, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('syllabus_again', 'me lo mandás de nuevo?', {
        must: ['Decir con naturalidad que ya se lo compartió y ofrecer repasarlo juntos o resolver una duda, sin reenviarlo.'],
        mustNot: ['No afirmar que lo reenvía ni prometer un nuevo envío, no repetir literalmente la respuesta anterior, no ofrecer una llamada.'],
        authority: [programRef, intentRef, noPrefabRef],
        expected: { move: programMoves, action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_program_document' }, { type: 'not_repeat_previous_reply' },
          { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '37_three_bonuses_never_fourth_20261104',
    title: 'Tres bonificaciones como máximo: ante nuevas quejas y un pedido de «otro curso más», nunca una cuarta',
    turns: [
      mdInterest(),
      mdObjection('complaint_1', 'es caro', [0, 1]),
      mdObjection('complaint_2', 'igual sigue siendo caro', [0, 1, 2]),
      mdObjection('complaint_3', 'sigue siendo mucho para mí', [0, 1, 2, 3]),
      { ...mdObjection('fourth_request', 'y otro curso más de regalo también?', [0, 1, 2, 3]), negotiationProbe: 'fourth_bonus_request' },
    ],
  },
  {
    id: '38_rejected_actions_conversational_20261104',
    title: 'Acción rechazada (PDF sin programa oficial, link sin plan): respuesta conversacional, nunca silencio ni afirmación del efecto',
    turns: [
      mdBase('other_course', 'Hola, quiero el curso de Excel Integral', {
        must: ['Identificar Excel Integral y descubrir lo justo.'],
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('syllabus_unavailable', 'me pasás el temario de Excel Integral?', {
        must: ['Responder con naturalidad con lo que sí se sabe del curso; si no puede enviar un PDF, no inventar que lo envía.'],
        mustNot: ['No afirmar que envía o adjunta un documento, no escribir enlaces, no quedar en silencio.'],
        authority: [programRef, effectsApart, noPrefabRef],
        expected: { move: programMoves, action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_program_document' }, { type: 'not_contains', value: 'http' },
          { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('link_without_plan', 'mandame el link de pago', {
        must: ['Pedir con naturalidad el plan (o los datos que falten) antes del link.'],
        mustNot: ['No afirmar que el link fue enviado, no elegir plan por el cliente.'],
        authority: [paymentRef, effectsApart, noPrefabRef],
        expected: { move: [...replayMoves, 'select_payment_plan', 'ask_payment_options'], action: ['none'], state: { plan: [null] } },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_link_delivered' }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '39_no_repeated_cta_20261104',
    title: 'Dos turnos seguidos: ni el mismo CTA ni la misma explicación repetidos',
    turns: [
      mdInterest(),
      mdBase('duration', 'y cuánto dura?', {
        must: ['Responder con los hechos autorizados de duración; a lo sumo una pregunta.'],
        authority: [intentRef, noInvasion, noPrefabRef],
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('includes', 'ok, y qué más incluye?', {
        must: ['Aportar información nueva, no repetir la explicación ni el cierre del turno anterior.'],
        mustNot: ['No repetir el mismo cierre o invitación a inscribirse del turno anterior, no ofrecer una llamada.'],
        authority: [intentRef, noInvasion, noPrefabRef],
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'not_repeat_previous_reply' }, { type: 'no_consecutive_enrollment_ask' },
          { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '40_real_estate_20261104',
    title: '«quiero algo de real estate»: reconoce Real Estate, informa con el programa oficial y manda el PDF si lo piden',
    turns: [
      mdBase('real_estate_interest', 'Hola, quiero algo de real estate', {
        must: ['Reconocer el curso Real Estate (curso activo del catálogo) y descubrir lo justo con una sola pregunta.'],
        mustNot: ['No inventar contenidos, no prometer licencia, empleo ni ingresos, no ofrecer una llamada.'],
        authority: [realEstateRef, intentRef, noPrefabRef],
        expected: { move: intentMoves, action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_program_document' }, { type: 'contains', value: 'Real Estate' }, { type: 'question_count_at_most', value: 1 },
          { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('real_estate_modules', 'qué módulos tiene?', {
        must: ['Responder con los módulos del programa oficial de Real Estate (hechos autorizados), sin agregar contenidos inventados.'],
        mustNot: ['No prometer licencia estatal, empleo ni ingresos; si menciona la licencia, aclarar que el curso da la base pero no la reemplaza.'],
        authority: [realEstateRef, owner(178, 178, 'licencia estatal'), noPrefabRef],
        expected: { move: programMoves, action: ['none', 'send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('real_estate_pdf', 'me pasás el programa en PDF?', {
        must: ['Si el PDF todavía no salió: presentarlo con una introducción corta (el PDF es la respuesta). Si ya salió en el turno anterior: decir con naturalidad que ya se lo compartió, sin reenviarlo.'],
        mustNot: ['No resumir el programa en lugar de enviarlo, no escribir enlaces, no prometer un reenvío, no ofrecer una llamada.'],
        authority: [programRef, realEstateRef, noPrefabRef],
        expected: { move: ['request_course_program', 'ask_course_information'], action: ['none', 'send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_exactly_once', value: 'real_estate' },
          { type: 'not_contains', value: 'http' }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '42_class_info_sends_material_barista_20261104',
    title: '«¿cómo son las clases de Barista?» (curso NUEVO reactivado): el mismo turno manda texto + imagen + PDF del programa oficial',
    turns: [
      mdBase('hello', 'Hola', {
        must: ['Saludar con calidez y preguntar qué le gustaría aprender, sin enviar material.'],
        expected: { move: [...intentMoves, 'greeting'], action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_program_document' }, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('classes', '¿cómo son las clases de Barista?', {
        must: ['Explicar cómo son las clases con hechos autorizados (modalidad, cantidad de clases si el contexto la trae) con una introducción corta y humana; el material oficial (imagen + programa) acompaña el texto.'],
        mustNot: ['No escribir enlaces, no afirmar que el material llegó, no prometer empleo ni ingresos, no ofrecer una llamada, no hablar de precio ni de plan de pago.'],
        authority: [programRef, intentRef, noPrefabRef, owner(209, 209, 'Programa PDF')],
        expected: { move: programMoves, action: ['send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_sent', value: 'barista' },
          { type: 'program_image_sent', value: 'barista' }, { type: 'program_document_kind', value: 'program' },
          { type: 'not_contains', value: 'http' }, { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '43_licensed_trade_plomeria_material_20261104',
    title: 'Plomería (curso NUEVO, oficio con licencia): info de clases con imagen + PDF y sin promesa de licencia',
    turns: [
      mdBase('hello', 'Hola', {
        must: ['Saludar con calidez y preguntar qué le gustaría aprender, sin enviar material.'],
        expected: { move: [...intentMoves, 'greeting'], action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_program_document' }, { type: 'no_call_offer' }, ...noBeca],
      }),
      mdBase('plumbing_info', 'Quiero info del curso de Plomería, qué voy a ver en las clases y sirve para trabajar en Estados Unidos?', {
        must: ['Explicar lo que se ve en las clases con hechos autorizados y mandar el material oficial; ser honesto: el curso da la base pero no reemplaza la licencia estatal que exige Estados Unidos para el oficio.'],
        mustNot: ['No prometer licencia, habilitación para ejercer, empleo ni ingresos; no escribir enlaces; no ofrecer una llamada.'],
        authority: [programRef, owner(178, 178, 'licencia estatal'), noPrefabRef],
        expected: { move: programMoves, action: ['send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_sent', value: 'plomeria' },
          { type: 'program_image_sent', value: 'plomeria' }, { type: 'not_contains', value: 'http' }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '44_ficha_fallback_word_20261104',
    title: 'Word (curso NUEVO sin programa oficial): el PDF que acompaña la imagen es la ficha del manual',
    turns: [
      mdBase('classes', 'Hola, ¿cómo son las clases del curso de Word?', {
        must: ['Explicar cómo son las clases con hechos autorizados, sin inventar cantidad de clases ni contenidos; el material (imagen + ficha) acompaña el texto.'],
        mustNot: ['No inventar la cantidad de clases (el manual la deja a confirmar), no escribir enlaces, no ofrecer una llamada.'],
        authority: [programRef, intentRef, noPrefabRef],
        expected: { move: programMoves, action: ['send_course_program'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'program_document_sent', value: 'word' },
          { type: 'program_image_sent', value: 'word' }, { type: 'program_document_kind', value: 'ficha' },
          { type: 'not_contains', value: 'http' }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
  {
    id: '41_real_trace_a96de4bf_20261104',
    title: 'Traza real a96de4bf: tras la primera bonificación, «osea me regalas otro curso?» + «dos por uno?» aclara la promo vigente y no suma otro curso',
    reconstructed: true,
    note: 'El lote de dos mensajes se envía como un único texto con salto de línea. La aclaración sólo se juzga si ya existe un paquete (TURN_PRECONDITION_NOT_REACHED si no).',
    turns: [
      mdInterest(),
      mdObjection('expensive', 'es caro', [0, 1]),
      // The real conversation: the bonus landed after the price question was answered. It may land on either of
      // these two turns; the clarification below is judged only once a package exists.
      mdObjection('yes_price', 'sí, es el precio, es bastante caro', [0, 1, 2]),
      mdBase('clarification', 'osea me regalas otro curso?\ndos por uno?', {
        priorPromotion: { status: ['offer_available'], bonusCount: [1, 2, 3], paidCourse: ['marketing_digital'] },
        must: ['Aclarar la promo vigente (qué incluye lo ya ofrecido, el 2×1 actual) con naturalidad y a lo sumo una pregunta útil.'],
        mustNot: ['No ofrecer ni nombrar otro curso bonificado nuevo, no tratarlo como una queja de precio, no ofrecer una llamada.'],
        authority: [intentRef, motiveRef, noPrefabRef],
        expected: { move: ['ask_course_information', 'unknown', 'continue_by_chat'], action: ['none'], state: {} },
        hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'package_unchanged' }, { type: 'no_new_bonus' },
          { type: 'question_count_at_most', value: 1 }, { type: 'no_call_offer' }, ...noBeca],
      }),
    ],
  },
);

// Real conversation 5b138536 (2026-11-05 18:17–18:32Z, brain v168): 29 customer batches, in order. Calls are
// settled as voicemail before the next turn exactly as recorded; call 4 is still open when the customer says
// «sigamos por aca» (order-2 race) and is settled only before the following turn.
const traceRef = owner(222, 228, 'Recibos de datos, estado posllamada');
const traceBase = (id: string, customer: string, override: Partial<GoldenTurnV1> = {}) => turn(id, customer, {
  must: ['Responder al mensaje actual con hechos autorizados y un próximo paso apropiado.'],
  mustNot: ['No afirmar datos, llamadas, envíos ni promociones que no ocurrieron; no negar material disponible.'],
  authority: [traceRef, intentRef, noPrefabRef],
  expected: { move: [...intentMoves, 'ask_course_information', 'request_course_program', 'request_call', 'provide_contact_details',
    'continue_by_chat', 'decline_call', 'ask_current_state', 'select_course', 'browse_catalog', 'greeting'],
    action: ['none', 'send_course_program', 'request_call_now', 'offer_course_bonus'], state: {} },
  hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'not_contains', value: 'no tengo el archivo' }, ...noBeca],
  ...override,
});
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '45_real_trace_5b138536_20261105',
  title: 'Traza real 5b138536: programa en el mismo turno, correo con coma, corrección de teléfono, llamadas a buzón, «sigamos por acá» y promo',
  note: 'Lotes reales del cliente en orden; la identidad de canal es sintética. Las llamadas se cierran como buzón antes del turno siguiente.',
  turns: [
    traceBase('t02_greeting', 'buenas\nde los cursos\nquiero info'),
    traceBase('t03_business', 'negoicos, qué tenes disponible?'),
    traceBase('t04_real_estate', 'algo vinculado con\nreal state?'),
    traceBase('t05_real_estate_confirm', 'real state tenes entonces?'),
    traceBase('t06_contents', 'nada, capacitarme\nsabes qué dan?', {
      must: ['Explicar brevemente qué se estudia en Real Estate y, en el mismo turno, compartir el programa (imagen + PDF), salvo que ya se haya enviado.'],
      mustNot: ['No decir que no tiene el archivo del programa.'],
      expected: { move: ['ask_course_information', 'request_course_program'], action: ['send_course_program', 'none'], state: {} },
    }),
    traceBase('t07_payment', 'dale\njoya\nche y el pago?\npero no estoy seguro'),
    traceBase('t08_trust', 'no sé si es seguro este medio\nstudyx\nhay testimonios?'),
    traceBase('t09_testimonials', 'tenes algun testiminio de otro alumno\nde algun otro rubro?'),
    traceBase('t10_felipe', 'mandame el testiminio de felipe\nsa er\nno lo tenes?'),
    traceBase('t11_why_payment', 'y xq antes me dijiste que no lo tenias?\npor otro lado, qué métodos de pago hay?'),
    traceBase('t12_call_request', 'me pueden llamar?'),
    traceBase('t13_comma_email', 'dale, THIAGO MANEYRO 1169004497 tmaneyro@gmail,com', {
      must: ['Registrar nombre y apellido; ante el correo con coma, pedir que lo reenvíe completo, sin corregirlo por su cuenta.'],
      mustNot: ['No escribir el correo corregido («tmaneyro@gmail.com») ni darlo por registrado.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'not_contains', value: 'tmaneyro@gmail.com' }, ...noBeca],
    }),
    traceBase('t14_yes', 'sii esta bien'),
    traceBase('t15_insists', 'ahi me lo dijiste\nestaba bien como lo escribiste', {
      mustNot: ['No dar por registrado un correo que el cliente no escribió literalmente.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'not_contains', value: 'tmaneyro@gmail.com' }, ...noBeca],
    }),
    traceBase('t16_call_again', 'dale, me llamas?'),
    traceBase('t17_email', 'tmaneyro@gmail.com'),
    traceBase('t18_call_now', 'sii\nllamame'),
    traceBase('t19_retry', 'me llamas neuvamente?\nasi probamos', { settleLatestCallBefore: 'buzon_de_voz', must: ['Si la llamada anterior terminó sin hablar, decir con claridad cómo terminó (no atendió, buzón o contestador) y ofrecer reintentar o seguir por chat.'], mustNot: ['No prometer avisar, reintentar o llamar más tarde por su cuenta; no decir que llama si no puede llamar.'] }),
    traceBase('t20_ok', 'oki', { settleLatestCallBefore: 'buzon_de_voz', must: ['Si la llamada anterior terminó sin hablar, decir con claridad cómo terminó (no atendió, buzón o contestador) y ofrecer reintentar o seguir por chat.'], mustNot: ['No prometer avisar, reintentar o llamar más tarde por su cuenta; no decir que llama si no puede llamar.'] }),
    traceBase('t21_phone_correction', 'ah sabes que me confundi, mi número termina en 8, no en 7', {
      must: ['Escribir el número completo corregido y pedir que lo confirme.'],
      mustNot: ['No decir que el número quedó registrado o cambiado antes de la confirmación; no llamar.'],
      expected: { move: [...intentMoves, 'provide_contact_details', 'request_call'], action: ['none'], state: {} },
    }),
    traceBase('t22_call_unconfirmed', 'me volves a llamar?', {
      must: ['Si el número corregido no se confirmó, pedir la confirmación antes de llamar.'],
      mustNot: ['No llamar al número cuestionado ni decir que llama al número corregido sin confirmación.'],
    }),
    traceBase('t23_ok', 'oki', { settleLatestCallBefore: 'buzon_de_voz', must: ['Si la llamada anterior terminó sin hablar, decir con claridad cómo terminó (no atendió, buzón o contestador) y ofrecer reintentar o seguir por chat.'], mustNot: ['No prometer avisar, reintentar o llamar más tarde por su cuenta; no decir que llama si no puede llamar.'] }),
    traceBase('t24_cannot_call', 'dale, osea que ahora no me podes llamar?', { settleLatestCallBefore: 'buzon_de_voz', must: ['Decir con claridad si puede llamar ahora y, si no, por qué (por ejemplo, falta confirmar el número) y qué necesita.'], mustNot: ['No prometer avisar, reintentar o llamar más tarde por su cuenta; no decir que llama si no puede llamar.'] }),
    traceBase('t25_chat_while_call_open', 'pero no me estas llamando\nokay sigamos por aca\nme parece caro'),
    traceBase('t26_very_expensive', 'noo\nme parece muy caro', { settleLatestCallBefore: 'buzon_de_voz',
      must: ['Trabajar el valor; el modelo puede ofrecer un bonificado afín con la cita de este mensaje como motivo.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'not_contains', value: 'no tengo el archivo' },
        { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    traceBase('t27_promo', 'qué ormo me podes ofrecer?\na er\na ver', {
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    traceBase('t28_promo_again', 'pero digo que promo me podes ofrecer\nme ibas a ofrecer una promocion', {
      must: ['Si todavía no hay bonificado: preguntar con sus palabras (sin frase fija) si el precio es lo único que lo frena; si ya hay uno, presentarlo o sumar otro con efecto real.'],
      mustNot: ['No responder que el precio no baja ni prometer un regalo sin efecto.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    traceBase('t29_price_is_the_problem', 'porque el problema SI es el precio', {
      must: ['Con la llamada terminada y el cliente en chat, la queja de precio actual puede abrir un bonificado afín (o el siguiente escalón) con la cita de este mensaje.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' },
        { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    traceBase('t30_decline', 'okay, no no voy a comprar\ngracias', {
      expected: { move: [...intentMoves, 'decline_purchase'], action: ['none', 'offer_course_bonus'], state: {} },
    }),
  ],
});

// Call segment of 5b138536 with a complete number (the harness identity is a +999 sandbox phone, so the real
// local «1169004497» cannot match it): call → voicemail → «termina en 8» → confirm → voicemail → «sigamos por aca»
// while the call is still open → price → promo. Exercises receipts, pending correction, the order-2 race and the bonus.
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '46_call_segment_5b138536_20261105',
  title: 'Tramo de llamadas de 5b138536: corrección de teléfono confirmada, buzón, «sigamos por acá» con la llamada abierta y promo',
  reconstructed: true,
  note: 'El número se da completo con código de país; el resto del texto es el del cliente real.',
  turns: [
    traceBase('c01_interest', 'hola, quiero info de real state'),
    traceBase('c02_call', 'me pueden llamar?'),
    traceBase('c03_data', 'dale, THIAGO MANEYRO +54 9 11 6900 4497 tmaneyro@gmail.com'),
    traceBase('c04_call_now', 'sii\nllamame'),
    traceBase('c05_correction', 'ah sabes que me confundi, mi número termina en 8, no en 7', { settleLatestCallBefore: 'buzon_de_voz',
      must: ['Escribir el número completo corregido y pedir que lo confirme.'],
      mustNot: ['No decir que el número quedó registrado o cambiado antes de la confirmación; no llamar.'],
      expected: { move: [...intentMoves, 'provide_contact_details', 'request_call'], action: ['none'], state: {} },
    }),
    traceBase('c06_unconfirmed_call', 'me volves a llamar?', {
      must: ['Pedir la confirmación del número corregido antes de llamar.'],
      expected: { move: [...intentMoves, 'provide_contact_details', 'request_call'], action: ['none'], state: {} },
    }),
    traceBase('c07_confirm', 'sii ese es, llamame'),
    traceBase('c08_chat_while_open', 'pero no me estas llamando\nokay sigamos por aca'),
    traceBase('c09_expensive', 'me parece muy caro', { settleLatestCallBefore: 'buzon_de_voz',
      must: ['Con la llamada terminada y el cliente en chat, trabajar el valor; puede ofrecer un bonificado afín con la cita de este mensaje.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' },
        { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
    traceBase('c10_promo', 'pero digo que promo me podes ofrecer\nporque el problema SI es el precio', {
      must: ['Si todavía no ofreció un bonificado, ofrecer uno afín con efecto real (la cita de la queja de precio actual); nunca prometerlo sin efecto.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' },
        { type: 'offered_bonus_named' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca],
    }),
  ],
});

// Owner test 6bcc8efa (2026-11-05 21:05–22:07Z, brain v171): discovery asked «¿trabajar o invertir?» three times,
// including after «no lo sé aún»; «quiero pagar» never selected the course. Evaluation only, never a backend gate.
const discoverOnceRef = owner(234, 241, 'Descubrir una vez y cerrar');
const sameFamily = 'No volver a preguntar si quiere trabajar con una inmobiliaria o invertir (ni otra variante de esa elección): el cliente ya dijo que no lo sabe.';
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '47_discover_once_6bcc8efa_20261105',
  title: 'Prueba del dueño 6bcc8efa: «no sé» cuenta como respuesta, tomar posición, cierre de prueba y checkout hasta el link',
  note: 'Lotes reales del cliente en orden hasta el pedido de pago; el correo va correcto para aislar el cierre.',
  turns: [
    traceBase('g01_greeting', 'buenas\nde los cursos\nquiero info', { authority: [discoverOnceRef, intentRef, noPrefabRef] }),
    traceBase('g02_real_estate', 'y no sé\nalgo vinculado con real state\ntienen cursos de real state\n?', { authority: [discoverOnceRef, programRef, noPrefabRef],
      must: ['Confirmar que hay Real Estate; si comparte el programa (imagen + PDF), acompañarlo con una o dos frases que resuman qué se estudia.'],
      expected: { move: ['ask_course_information', 'request_course_program', 'select_course', 'browse_catalog'], action: ['send_course_program', 'none'], state: {} } }),
    traceBase('g03_from_zero', 'sería para iniciar de 0', { authority: [discoverOnceRef, intentRef, noPrefabRef],
      must: ['Afirmar con seguridad por qué Real Estate sirve para empezar de cero; como máximo una pregunta nueva.'],
      mustNot: ['No repetir la pregunta del turno anterior que el cliente no contestó (por ejemplo, trabajar con una inmobiliaria o invertir).'] }),
    traceBase('g04_undecided_trust', 'no lo sé aún\nes formarme\nche y cómo seq ue funciona studyx\nson confiables?', {
      authority: [discoverOnceRef, intentRef, noPrefabRef],
      must: ['Aceptar que todavía no decidió y vender la formación general; responder cómo funciona Studyx y la confianza con hechos autorizados.'],
      mustNot: [sameFamily],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 }, ...noBeca],
    }),
    traceBase('g05_students', 'hay gente que haya cursado con ustedes?', { authority: [discoverOnceRef, intentRef, noPrefabRef],
      mustNot: [sameFamily, 'No inventar un testimonio de Real Estate.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 }, ...noBeca],
    }),
    traceBase('g06_does_it_help', 'tenes los testimonios?\nme gustaría entender como se mueve el negocio, me sirve?', {
      authority: [discoverOnceRef, intentRef, noPrefabRef],
      must: ['Responder que sí con seguridad, conectar el curso con entender cómo se mueve el negocio y terminar con un único cierre de prueba suave.'],
      mustNot: [sameFamily, 'No abrir otra pregunta de descubrimiento.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 }, ...noBeca],
    }),
    traceBase('g07_wants_to_pay', 'no sé\nquiero pagar', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      must: ['Avanzar con la inscripción a Real Estate pidiendo sólo los datos que faltan.'],
      expected: { move: ['request_payment_link', 'select_course', 'provide_contact_details'], action: ['none'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'selected_course_equals', value: 'real_estate' }, { type: 'no_link_delivered' }, ...noBeca],
    }),
    traceBase('g08_data', 'thiago meiniero\ntmaneyro@gmail.com\n+54 9 11 6900 4497', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      expected: { move: ['provide_contact_details', 'request_payment_link'], action: ['none'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'selected_course_equals', value: 'real_estate' }, ...noBeca],
    }),
    traceBase('g09_confirm', 'sí, están bien', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      expected: { move: ['provide_contact_details', 'request_payment_link', 'ask_payment_options', 'select_payment_plan'], action: ['none', 'send_payment_link'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, ...noBeca],
    }),
    traceBase('g10_plan', 'el de 12 cuotas', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      must: ['Entregar el link del plan elegido en este turno, sin pedir otra confirmación.'],
      mustNot: ['No decir «no te entendí».'],
      expected: { move: ['select_payment_plan', 'request_payment_link'], action: ['send_payment_link'], state: {} },
      hard: [{ type: 'workflow_committed' }, { type: 'payment_link_delivered' }, { type: 'link_plan_in', values: ['monthly_12'] },
        { type: 'not_contains', value: 'no te entendí' }, ...noBeca],
    }),
  ],
});

// Owner test 6bcc8efa, checkout → price → bonus → voicemail → chat → plan (2026-11-05). Owner decision: a price
// complaint during checkout may open the bonus until the link is sent; back on chat the plan choice sends the link.
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '48_checkout_promo_call_6bcc8efa_20261105',
  title: 'Prueba del dueño 6bcc8efa: promo durante el checkout, llamada a buzón, «sigo por acá» y link con el paquete',
  reconstructed: true,
  note: 'Lotes reales del cliente desde el pedido de pago; la llamada se cierra como buzón antes del turno siguiente.',
  turns: [
    traceBase('p01_interest', 'hola, quiero info de real state', { authority: [discoverOnceRef, intentRef, noPrefabRef] }),
    traceBase('p02_wants_to_pay', 'quiero pagar', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      expected: { move: ['request_payment_link', 'select_course', 'provide_contact_details'], action: ['none'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'selected_course_equals', value: 'real_estate' }, ...noBeca] }),
    traceBase('p03_data', 'thiago meiniero\ntmaneyro@gmail.com\n+54 9 11 6900 4497', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      expected: { move: ['provide_contact_details', 'request_payment_link'], action: ['none'], state: {} } }),
    traceBase('p04_confirm', 'yesss', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      expected: { move: ['provide_contact_details', 'request_payment_link', 'ask_payment_options', 'select_payment_plan'], action: ['none'], state: {} } }),
    traceBase('p05_expensive', 'uuuf\nes bastante caro', { authority: [discoverOnceRef, motiveRef, noPrefabRef],
      must: ['Trabajar el valor y preguntar, con sus palabras, si el precio es lo único que lo frena; o, si ya lo dijo, ofrecer un bonificado afín con efecto real.'],
      mustNot: ['No responder que el precio no baja; no prometer un regalo sin la acción.'],
      expected: { move: ['price_objection'], action: ['none', 'offer_course_bonus'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'no_link_delivered' }, ...noBeca] }),
    traceBase('p06_price_only', 'solo el precio es el problema', { authority: [discoverOnceRef, motiveRef, noPrefabRef],
      must: ['Ofrecer un bonificado afín a Real Estate con efecto real, citando este mensaje como motivo.'],
      expected: { move: ['price_objection', 'explicit_promotion_request'], action: ['offer_course_bonus'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'course_bonus_preconditions' }, { type: 'bonus_motive_current_message' },
        { type: 'offered_bonus_named' }, { type: 'promotion_bonus_count_at_most', value: 3 }, ...noBeca] }),
    traceBase('p07_call', 'me podrian llamar?\nme sirve, pero quiero q me llamen', { authority: [traceRef, intentRef, noPrefabRef],
      expected: { move: ['request_call'], action: ['request_call_now', 'none'], state: {} } }),
    traceBase('p08_chat', 'nada, prefiero seguir por acá', { settleLatestCallBefore: 'buzon_de_voz', authority: [traceRef, discoverOnceRef, noPrefabRef],
      must: ['Seguir por chat con el paquete ofrecido y los planes reales.'],
      expected: { move: ['continue_by_chat', 'decline_call'], action: ['none'], state: {} } }),
    traceBase('p09_plan', 'el de 12 cuotas', { authority: [discoverOnceRef, paymentRef, noPrefabRef],
      must: ['Entregar en este turno el link del plan elegido con el paquete aceptado.'],
      mustNot: ['No decir «no te entendí» ni pedir otra confirmación.'],
      expected: { move: ['select_payment_plan', 'request_payment_link'], action: ['send_payment_link'], state: {} },
      hard: [{ type: 'workflow_committed' }, { type: 'payment_link_delivered' }, { type: 'link_plan_in', values: ['monthly_12'] },
        { type: 'not_contains', value: 'no te entendí' }, ...noBeca] }),
  ],
});

// Owner test 2026-11-06: the anti-repetition rule must not confuse an asked question with an answered one.
// The customer never answered the generic objective question; after naming a broad area and asking for options,
// Emma answers with a short oriented comparison and one NEW discriminating question instead of a flat catalog.
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '49_broad_area_unanswered_discovery_20261106',
  title: 'Pregunta de descubrimiento ignorada: saludar, orientar un área amplia y repreguntar sin repetir como robot',
  note: 'Reproduce la conversación del dueño del 06/11 que quedó en una lista plana de cuatro cursos sin orientación.',
  turns: [
    traceBase('d01_greeting', 'hola, cómo estás?', {
      authority: [gabi(7, 17, 'En el primer contacto preséntate una vez'), noPrefabRef],
      must: ['Saludar con naturalidad y presentarse una sola vez como «Soy Emma, asesora de Studyx».'],
      mustNot: ['No presentarse como administrativa ni usar signos invertidos de apertura.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'contains', value: 'Soy Emma, asesora de Studyx' },
        { type: 'not_contains', value: 'administrativa' }, { type: 'not_contains', value: '¿' }, { type: 'not_contains', value: '¡' }, ...noBeca],
    }),
    traceBase('d02_acknowledgement', 'ah okay', {
      authority: [gabi(17, 23, 'Varía la estructura'), gabi(32, 32, 'pregunta ligera de descubrimiento'), noPrefabRef],
      must: ['Retomar con calidez y avanzar con una sola pregunta ligera para conocer qué le interesa.'],
      mustNot: ['No volver a presentarse, no sonar administrativo ni usar signos invertidos de apertura.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 },
        { type: 'not_contains', value: 'Soy Emma' }, { type: 'not_contains', value: '¿' }, { type: 'not_contains', value: '¡' }, ...noBeca],
    }),
    traceBase('d03_does_not_remember', 'no se que habia visto', {
      authority: [gabi(36, 46, 'Descubrir lo justo'), noPrefabRef],
      must: ['Aceptar que no recuerda el curso y hacer como máximo una pregunta útil, sin formulario ni menú largo.'],
      mustNot: ['No inventar qué curso vio ni usar signos invertidos de apertura.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 },
        { type: 'not_contains', value: '¿' }, { type: 'not_contains', value: '¡' }, ...noBeca],
    }),
    traceBase('d04_computers_options', 'algo vinculado con computadoras\nme pasas las opciones?', {
      authority: [gabi(15, 21, 'Para dos o más opciones usa una lista'), gabi(38, 52, 'Con un objetivo claro, recomienda el mejor curso y por qué'), noPrefabRef],
      must: ['Responder primero al pedido con caminos realmente vinculados con computadoras en una orientación concisa, diferenciarlos brevemente y terminar con una sola pregunta nueva que ayude a elegir según el último mensaje.'],
      mustNot: ['No repetir la pregunta genérica sobre conseguir trabajo, sumar ingresos o tener un negocio; no dar una lista larga y plana del catálogo; no pedir inscripción, plan ni llamada; no usar signos invertidos de apertura.'],
      expected: { move: ['browse_catalog', 'ask_course_information'], action: ['none'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'question_count_at_most', value: 1 },
        { type: 'no_call_offer' }, { type: 'no_enrollment_ask' }, { type: 'not_contains', value: '¿' },
        { type: 'not_contains', value: '¡' }, ...noBeca],
    }),
    traceBase('d05_recommendation', 'cual me recomiendas para empezar?', {
      authority: [owner(245, 247, 'toma posición'), noPrefabRef],
      must: ['Recomendar un curso activo con seguridad y explicar por qué sirve para empezar; responder al pedido actual con valor verificado.'],
      mustNot: ['No devolver otro menú plano ni repetir inmediatamente la pregunta genérica ignorada; no iniciar datos, plan o link.'],
      expected: { move: ['ask_course_information', 'browse_catalog'], action: ['none', 'send_course_program'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_enrollment_ask' }, { type: 'no_link_delivered' }, { type: 'question_count_at_most', value: 1 }, ...noBeca],
    }),
  ],
});

// Plan A midpoint: fit may be checked before purchase consent, while checkout stays operationally gated.
const midpointRef = owner(243, 248, 'Punto medio de venta natural');
OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE.push({
  id: '50_trial_close_vs_checkout_20261106',
  title: 'Real Estate desde cero: valor y cierre de prueba antes del checkout',
  note: 'Contrasta interés exploratorio y criterio indeciso con la respuesta afirmativa al cierre; no prescribe redacción exacta.',
  turns: [
    traceBase('t01_interest', 'hola, quiero información de Real Estate', { authority: [midpointRef, intentRef, noPrefabRef] }),
    traceBase('t02_starting_level', 'empezaría de cero', { authority: [midpointRef, noPrefabRef],
      must: ['Conectar Real Estate con empezar de cero usando hechos verificados.'],
      mustNot: ['No iniciar datos, plan o enlace sin intención de compra.'],
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_enrollment_ask' }, { type: 'no_link_delivered' }, ...noBeca] }),
    traceBase('t03_undecided', 'no sé todavía si trabajar con una inmobiliaria o invertir', { authority: [midpointRef, noPrefabRef],
      must: ['Respetar que no decidió ese criterio; el no sé no impide responder otra duda útil.'],
      mustNot: ['No reformular inmediatamente la elección entre inmobiliaria o invertir.'] }),
    traceBase('t04_general_goal', 'quiero entender cómo se mueve el negocio, me sirve?', { authority: [midpointRef, noPrefabRef],
      must: ['Responder al pedido actual con seguridad, conectar valor verificado con entender el negocio y hacer un único cierre de prueba suave para comprobar encaje.'],
      mustNot: ['No volver a preguntar si quiere trabajar con una inmobiliaria o invertir; no seguir entrevistando ni pedir datos, plan o link.'],
      expected: { move: ['ask_course_information', 'browse_catalog', 'select_course'], action: ['none'], state: {} },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'no_enrollment_ask' }, { type: 'no_link_delivered' }, { type: 'no_call_offer' }, { type: 'question_count_at_most', value: 1 }, ...noBeca] }),
    traceBase('t05_affirmative', 'sí, es lo que busco, quiero inscribirme', { authority: [midpointRef, paymentRef, noPrefabRef],
      must: ['Avanzar al flujo existente de inscripción con Real Estate, pidiendo sólo los datos faltantes.'],
      expected: { move: ['request_payment_link', 'provide_contact_details', 'select_course'], action: ['none'], state: { checkout: ['contact_details'] } },
      hard: [{ type: 'workflow_committed' }, noPrefab, { type: 'selected_course_equals', value: 'real_estate' }, { type: 'no_link_delivered' }, ...noBeca] }),
  ],
});

export const OWNER_PROMOTION_MODE_REPLAY_CASES: readonly GoldenCaseV1[] = OWNER_PROMOTION_MODE_REPLAY_CASES_MUTABLE;
