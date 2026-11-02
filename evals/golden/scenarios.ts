import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GOLDEN_BASE_SHA = '028f272fc3a6f6dc4806d19b251564169b55e6d6' as const;

export type AuthorityFile = 'AGENTS.md'
  | 'docs/authority/prompt-agente-a-studyx-v2.md'
  | 'docs/authority/spec-backend-bonificacion.md';

export interface AuthorityReference {
  readonly file: AuthorityFile;
  readonly start: number;
  readonly end: number;
  /** Literal corto para detectar que la cita no se corrió a otra regla. */
  readonly contains: string;
}

export interface ExpectedPromotionV1 {
  readonly status: readonly (string | null)[];
  readonly bonusCount: readonly number[];
  readonly paidCourse?: readonly (string | null)[];
}

export type ExpectedCheckoutStateV1 = 'contact_details' | 'payment_confirmation'
  | 'payment_plan' | 'link';

export interface ExpectedTurnV1 {
  readonly move: readonly string[];
  readonly action: readonly string[];
  readonly state: {
    readonly checkout?: readonly ExpectedCheckoutStateV1[];
    readonly closed?: boolean;
    readonly plan?: readonly (string | null)[];
    readonly promotion?: ExpectedPromotionV1;
  };
}

export type HardRuleV1 =
  | { readonly type: 'contains'; readonly value: string }
  | { readonly type: 'not_contains'; readonly value: string }
  | { readonly type: 'question_count_at_most'; readonly value: number }
  | { readonly type: 'promotion_bonus_count_at_most'; readonly value: number }
  | { readonly type: 'action_bonus_in'; readonly values: readonly string[] }
  | { readonly type: 'response_mentions_all_promotions' }
  | { readonly type: 'response_uses_authorized_syllabus' }
  | { readonly type: 'requests_only_missing_call_fields' }
  | { readonly type: 'payment_link_delivered' }
  | { readonly type: 'access_lists_all_activated_courses' }
  | { readonly type: 'course_bonus_preconditions' }
  | { readonly type: 'current_price_objection_recorded' }
  | { readonly type: 'workflow_committed' }
  | { readonly type: 'call_offer_recorded' }
  | { readonly type: 'early_call_previously_recorded' }
  | { readonly type: 'rule_outcomes_recorded' }
  | { readonly type: 'current_course_facts_present'; readonly value: string }
  | { readonly type: 'selected_course_equals'; readonly value: string };

export interface GoldenTurnV1 {
  readonly negotiationProbe?: 'fourth_bonus_request' | 'paid_course_change';
  readonly id: string;
  readonly customer: string;
  readonly must: readonly string[];
  readonly mustNot: readonly string[];
  readonly authority: readonly AuthorityReference[];
  readonly expected: ExpectedTurnV1;
  readonly hard?: readonly HardRuleV1[];
  /** Estado que debe haber dejado el turno anterior para que este turno mida su regla aislada. */
  readonly priorPromotion?: {
    readonly status: readonly (string | null)[];
    readonly bonusCount: readonly number[];
    readonly paidCourse?: readonly (string | null)[];
  };
}

export interface GoldenCaseV1 {
  readonly evaluationMode?: 'negotiation_invariants';
  readonly id: string;
  readonly title: string;
  readonly setup?: 'none' | 'fulfilled_bonus_package';
  readonly turns: readonly GoldenTurnV1[];
}

const PROMPT = 'docs/authority/prompt-agente-a-studyx-v2.md' as const;
const BONUS = 'docs/authority/spec-backend-bonificacion.md' as const;
const ROOT = 'AGENTS.md' as const;

const ref = (file: AuthorityFile, start: number, end: number, contains: string): AuthorityReference => (
  { file, start, end, contains }
);

const promotion = (
  status: readonly (string | null)[] = [null, 'none'],
  bonusCount: readonly number[] = [0],
  paidCourse?: readonly (string | null)[],
): ExpectedPromotionV1 => ({ status, bonusCount, ...(paidCourse ? { paidCourse } : {}) });

const state = (expected: ExpectedTurnV1['state'] = {}): ExpectedTurnV1['state'] => expected;

export const GOLDEN_CASES: readonly GoldenCaseV1[] = [
  {
    id: '01_first_contact_identity',
    title: 'Primer contacto con identidad exacta y rol comercial',
    turns: [
      {
        id: 'greeting', customer: 'Hola, buen día',
        must: ['Presentarse una sola vez como “Soy Emma, asesora de Studyx” y abrir la conversación con cercanía.'],
        mustNot: ['No llamarse administrativa, no añadir Academia Internacional y no convertir el saludo en un folleto.'],
        authority: [ref(ROOT, 10, 15, 'Soy Emma, asesora de Studyx'), ref(PROMPT, 7, 7, 'En el primer contacto')],
        expected: { move: ['greeting'], action: ['none'], state: state() },
        hard: [
          { type: 'contains', value: 'Soy Emma, asesora de Studyx' },
          { type: 'not_contains', value: 'administrativa' },
          { type: 'not_contains', value: 'Academia Internacional' },
        ],
      },
      {
        id: 'continuity', customer: 'Quiero conocer los cursos de fotografía.',
        must: ['Continuar desde el interés por fotografía sin volver a presentarse.'],
        mustNot: ['No repetir “Soy Emma”, no usar administrativa y no reiniciar el saludo.'],
        authority: [ref(PROMPT, 7, 7, 'En el primer contacto'), ref(PROMPT, 23, 23, 'Responde sólo con información nueva')],
        expected: { move: ['browse_catalog', 'ask_course_information'], action: ['none'], state: state() },
        hard: [{ type: 'not_contains', value: 'Soy Emma' }, { type: 'not_contains', value: 'administrativa' }],
      },
    ],
  },
  {
    id: '02_info_discovery',
    title: 'Info inicia descubrimiento conversacional, no formulario',
    turns: [
      {
        id: 'info', customer: 'Info',
        must: ['Preguntar qué quiere aprender o qué curso vio; una sola pregunta principal.'],
        mustNot: [
          'No elegir un curso por “Info”.',
          'No pedir nombre, apellido, correo o teléfono.',
          'No hacer varias preguntas juntas.',
        ],
        authority: [ref(PROMPT, 36, 44, '«Info» no elige un curso'), ref(PROMPT, 17, 17, 'Nunca hagas más de una pregunta principal')],
        expected: { move: ['greeting', 'browse_catalog'], action: ['none'], state: state() },
        hard: [{ type: 'question_count_at_most', value: 1 }],
      },
      {
        id: 'goal', customer: 'Quiero aprender algo para sacar mejores fotos de los productos de mi tienda online',
        must: ['Retomar la tienda online y hacer una sola pregunta útil de situación, motivación o freno, o avanzar si el contexto ya alcanza.'],
        mustNot: ['No repetir qué quiere aprender, no pedir nombre/correo/teléfono y no listar el catálogo.'],
        authority: [ref(PROMPT, 38, 44, 'Hazlo conversando, una pregunta por vez')],
        expected: { move: ['browse_catalog', 'ask_course_information', 'unknown'], action: ['none'], state: state() },
        hard: [{ type: 'question_count_at_most', value: 1 }],
      },
    ],
  },
  {
    id: '03_single_course_recommendation',
    title: 'Recomienda un curso conectado al objetivo y prueba el cierre',
    turns: [
      {
        id: 'recommend',
        customer: 'Quiero ofrecer fotos profesionales a emprendedores. Hoy sólo saco con el celular, pero quiero aprender cámara y edición.',
        must: [
          'Recomendar un solo curso con seguridad.',
          'Conectar cámara/edición y el objetivo de ofrecer sesiones con hechos autorizados del curso.',
          'Cerrar probando si esa propuesta encaja o si se ve aplicándola.',
        ],
        mustNot: [
          'No abrir un menú de cursos ni ofrecer varias opciones.',
          'No prometer ingresos ni clientes.',
          'No registrar la recomendación como elección del cliente.',
        ],
        authority: [ref(PROMPT, 46, 54, 'Recomienda **un** curso'), ref(PROMPT, 56, 66, 'cierre de prueba'), ref(PROMPT, 38, 38, 'Una recomendación no es elección')],
        expected: { move: ['ask_course_information', 'browse_catalog', 'unknown'], action: ['none'], state: state() },
        hard: [{ type: 'question_count_at_most', value: 1 }],
      },
      {
        id: 'test_close_reply', customer: 'Sí, me veo aplicándolo para ofrecer sesiones.',
        must: ['Tomar el sí como interés y proponer un paso concreto para avanzar.'],
        mustNot: ['No confundir el cierre de prueba con consentimiento de inscripción ni enviar un enlace.'],
        authority: [ref(PROMPT, 56, 66, 'Si responde positivo, cierra')],
        expected: { move: ['ask_course_information', 'select_course', 'request_payment_link', 'unknown'], action: ['none'], state: state() },
      },
    ],
  },
  {
    id: '04_price_value_objection',
    title: 'Está caro: valor personalizado y cuota sin descontar',
    turns: [
      {
        id: 'interest', customer: 'Quiero Fotografía Profesional para ofrecer sesiones y sumar una nueva fuente de ingresos.',
        must: ['Construir valor desde el objetivo concreto y avanzar con un solo cierre o pregunta útil.'],
        mustNot: ['No garantizar ingresos, no hablar de promociones y no pedir datos de inscripción todavía.'],
        authority: [ref(PROMPT, 46, 58, 'Conecta siempre'), ref(PROMPT, 54, 54, 'No prometas ingresos')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'expensive', customer: 'Está caro, no sé si realmente lo vale.',
        must: ['Reconocer la duda, demostrar valor con el objetivo de ofrecer sesiones, reencuadrar con USD 30 mensuales y terminar con la pregunta exacta de la Regla C. La segunda respuesta puede incluir la invitación de la Regla B.'],
        mustNot: ['No descontar, no repetir un argumento genérico, no prometer ingresos y no ejecutar una bonificación todavía.'],
        authority: [ref(PROMPT, 68, 76, 'con lo que ya sabes de él'), ref(PROMPT, 91, 102, 'Valor percibido'), ref(ROOT, 67, 68, 'Regla C')],
        expected: { move: ['ask_payment_options', 'ask_course_information', 'unknown'], action: ['none'], state: state({ promotion: promotion() }) },
        hard: [{ type: 'contains', value: 'USD 30' }, { type: 'promotion_bonus_count_at_most', value: 0 },
          { type: 'contains', value: 'El precio es el único inconveniente? Puedo revisar una promoción.' },
          { type: 'current_price_objection_recorded' }, { type: 'call_offer_recorded' }],
      },
    ],
  },
  {
    id: '05_real_budget_limit',
    title: 'No me alcanza: presupuesto real sin presión',
    turns: [
      {
        id: 'interest', customer: 'Me interesa Marketing Digital para mover mi emprendimiento, cuánto cuesta?',
        must: ['Responder el precio de inmediato con los tres planes exactos y conservar el foco en Marketing Digital.'],
        mustNot: ['No demorar el precio, no inventar descuentos y no seleccionar un plan por el cliente.'],
        authority: [ref(PROMPT, 91, 98, 'Ante una pregunta directa de precio')],
        expected: { move: ['ask_payment_options', 'select_course'], action: ['none'], state: state({ plan: [null] }) },
      },
      {
        id: 'budget', customer: 'No me alcanza, ahora mismo estoy muy justo.',
        must: ['Reconocer la limitación sin presionar, presentar 12 cuotas de USD 30 como la forma más accesible del mismo total y, porque responde con una nueva objeción después de la pregunta de la Regla C, ofrecer el primer curso de la tabla sin bajar el precio.'],
        mustNot: ['No culpabilizar, no inventar urgencia, no reducir USD 360 y no ofrecer un curso distinto del decidido por el backend.'],
        authority: [ref(PROMPT, 98, 102, 'Presupuesto real'), ref(ROOT, 13, 13, 'plan de 12 como el más accesible'), ref(ROOT, 67, 68, 'nueva objeción de precio dispara la oferta')],
        expected: { move: ['defer_payment', 'ask_payment_options', 'ask_course_information', 'unknown'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [1], ['marketing_digital']) }) },
        hard: [{ type: 'contains', value: 'USD 30' }, { type: 'not_contains', value: 'descuento' },
          { type: 'current_price_objection_recorded' }, { type: 'course_bonus_preconditions' },
          { type: 'action_bonus_in', values: ['publicidad_redes_sociales'] }],
      },
    ],
  },
  {
    id: '06_repeated_price_bonus_ladder',
    evaluationMode: 'negotiation_invariants',
    title: 'Reglas del dueño: pregunta de precio, llamada temprana y máximo tres bonificaciones afines',
    turns: [
      {
        id: 'select', customer: 'Quiero Fotografía Profesional para vivir de esto y ofrecer fotos a tiendas y emprendedores.',
        must: ['Confirmar el foco en Fotografía Profesional y construir valor con su objetivo emprendedor.'],
        mustNot: ['No ofrecer cuotas ni bonificación antes de que exista una objeción.'],
        authority: [ref(PROMPT, 46, 54, 'Conecta siempre')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'value', customer: 'Me interesa, pero está caro.',
        must: ['Conectar valor con ofrecer fotos a tiendas/emprendedores, reencuadrar con la cuota, terminar con la pregunta exacta de la Regla C y ofrecer la llamada temprana de la Regla B.'],
        mustNot: ['No ejecutar una bonificación en esta primera objeción y no bajar el precio.'],
        authority: [ref(PROMPT, 98, 104, '**Valor percibido**'), ref(ROOT, 56, 62, '2.ª o 3.ª respuesta'), ref(ROOT, 67, 68, 'Regla C')],
        expected: { move: ['ask_course_information', 'ask_payment_options', 'unknown'], action: ['none'], state: state({ promotion: promotion() }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 0 },
          { type: 'current_price_objection_recorded' }, { type: 'call_offer_recorded' },
          { type: 'contains', value: 'El precio es el único inconveniente? Puedo revisar una promoción.' }],
      },
      {
        id: 'installments', customer: 'Lo veo útil, pero el precio me sigue frenando.',
        must: ['La segunda objeción registrada dispara el primer curso de la tabla; mantener USD 360, poder recordar las 12 cuotas de USD 30 y cerrar en el mismo turno.'],
        mustNot: ['No repetir sólo el valor, no ofrecer dos cursos nuevos y no modificar el total.'],
        authority: [ref(ROOT, 45, 54, '2.ª objeción de precio'), ref(PROMPT, 121, 124, 'exactamente un código')],
        expected: { move: ['ask_payment_options', 'ask_course_information', 'unknown'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [1], ['fotografia_profesional']) }) },
        hard: [{ type: 'course_bonus_preconditions' }, { type: 'current_price_objection_recorded' },
          { type: 'action_bonus_in', values: ['diseno_photoshop'] }],
      },
      {
        id: 'isolate', customer: 'Aun así me parece caro.',
        must: ['La nueva objeción posterior a la oferta suma el segundo curso de la tabla y recapitula el paquete completo.'],
        mustNot: ['No reemplazar el primer bonificado, no duplicarlo y no modificar el precio.'],
        authority: [ref(ROOT, 49, 52, 'nueva objeción de precio'), ref(PROMPT, 121, 124, 'paquete completo')],
        expected: { move: ['unknown', 'ask_course_information', 'ask_payment_options'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [2], ['fotografia_profesional']) }) },
        hard: [{ type: 'action_bonus_in', values: ['fotografia_celulares_tiendas_online'] }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'call_step', customer: 'Sí, el precio es el único freno. Si resolvemos eso, avanzo.',
        must: ['La confirmación de que el precio es el único freno suma el tercer y último curso de la tabla y recapitula todo el paquete.'],
        mustNot: ['No ofrecer un cuarto curso, no borrar los anteriores y no modificar USD 360.'],
        authority: [ref(ROOT, 45, 54, 'máximo 3'), ref(PROMPT, 121, 127, 'como máximo, un tercero')],
        expected: { move: ['request_call', 'unknown', 'ask_course_information', 'ask_payment_options'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'action_bonus_in', values: ['decoracion_de_interiores'] }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'bonus_1', customer: 'Prefiero seguir por chat. El precio sigue siendo lo único que me frena.',
        must: ['Respetar la preferencia de seguir por chat y conservar el paquete completo de tres cursos bonificados.'],
        mustNot: ['No insistir con la llamada rechazada ni ofrecer un cuarto curso.'],
        authority: [ref(ROOT, 49, 54, 'máximo 3'), ref(PROMPT, 121, 127, 'Máximo de cursos bonificados')],
        expected: { move: ['continue_by_chat', 'unknown', 'ask_payment_options', 'ask_course_information'], action: ['none'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'bonus_2', customer: 'Me suma, pero sigo dudando por el mismo precio.',
        must: ['Mantener los tres bonificados ya entregados y seguir cerrando sin prometer otra incorporación.'],
        mustNot: ['No reemplazar, repetir ni ampliar el paquete por encima de tres.'],
        authority: [ref(PROMPT, 121, 127, 'Máximo de cursos bonificados'), ref(BONUS, 64, 67, 'bonus_limit_reached')],
        expected: { move: ['unknown', 'ask_payment_options', 'ask_course_information'], action: ['none'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'bonus_3', customer: 'Todavía me cuesta decidir por el precio. Hay algo más que pueda sumar valor?',
        must: ['Conservar el paquete de tres y responder la duda de precio con valor o cierre, sin insinuar otra bonificación.'],
        mustNot: ['No duplicar cursos, no modificar USD 360 y no insinuar que existe una cuarta bonificación.'],
        authority: [ref(PROMPT, 121, 127, 'como máximo, un tercero'), ref(BONUS, 61, 67, 'bonus_limit_reached')],
        expected: { move: ['unknown', 'ask_payment_options', 'ask_course_information'], action: ['none'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'never_fourth', negotiationProbe:'fourth_bonus_request', customer: 'Y otro curso más también?',
        must: ['Mantener el paquete acumulado de tres y cerrar o dejar la puerta abierta con calidez.'],
        mustNot: ['Nunca ofrecer ni prometer un cuarto curso bonificado.'],
        authority: [ref(PROMPT, 121, 127, 'Máximo de cursos bonificados'), ref(BONUS, 64, 67, 'bonus_limit_reached')],
        expected: { move: ['unknown', 'ask_payment_options', 'ask_course_information', 'defer_payment'], action: ['none'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'response_mentions_all_promotions' }],
        priorPromotion: { status: ['offer_available'], bonusCount: [3], paidCourse: ['fotografia_profesional'] },
      },
    ],
  },
  {
    id: '07_think_it_over_not_closed',
    title: 'Pensarlo trabaja el freno sin cerrar ni guardar un plan',
    turns: [
      {
        id: 'plans', customer: 'Me interesa Fotografía Profesional. Qué planes de pago tienen?',
        must: ['Dar los tres planes exactos y preguntar cuál le serviría o qué necesita evaluar.'],
        mustNot: ['No elegir ni guardar un plan por la persona y no enviar enlace.'],
        authority: [ref(PROMPT, 91, 98, 'Los planes suman USD 360'), ref(PROMPT, 216, 220, 'Fuera de una elección pendiente')],
        expected: { move: ['ask_payment_options', 'select_course'], action: ['none'], state: state({ plan: [null] }) },
      },
      {
        id: 'think', customer: 'No me quiero inscribir igual ya, tengo que pensarlo.',
        must: ['Preguntar con naturalidad qué le queda por definir y trabajar ese freno.'],
        mustNot: ['No decline_purchase, no stage closed, no guardar un plan no elegido, no decir “queda anotado” y no bonificar.'],
        authority: [ref(PROMPT, 78, 89, '«Lo voy a pensar»'), ref(PROMPT, 216, 220, 'su elección clara')],
        expected: { move: ['defer_payment', 'ask_course_information', 'unknown'], action: ['none'], state: state({ closed: false, plan: [null], promotion: promotion() }) },
        hard: [{ type: 'not_contains', value: 'queda anotado' }, { type: 'promotion_bonus_count_at_most', value: 0 }],
      },
    ],
  },
  {
    id: '08_consult_partner',
    title: 'Ayuda a llevar la decisión a la pareja',
    turns: [
      {
        id: 'context', customer: 'Quiero Marketing Digital para vender más con mi emprendimiento y ordenar mis redes.',
        must: ['Conectar el curso con ordenar redes y vender, sin prometer resultados.'],
        mustNot: [
          'No inventar ingresos.',
          'No pedir nombre, apellido, correo o teléfono para inscripción o llamada todavía.',
        ],
        authority: [ref(PROMPT, 40, 44, 'Descubre sólo lo que te sirve para vender'), ref(PROMPT, 46, 54, 'cómo lo podría usar')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'partner', customer: 'Lo tengo que consultar con mi pareja antes de decidir.',
        must: ['Darle lo clave para contarle: para qué le sirve y que puede pagarse en 12 cuotas de USD 30; ofrecer resolver dudas de la pareja.'],
        mustNot: ['No presionar, no desacreditar a la pareja y no despedirse sin ayudar.'],
        authority: [ref(PROMPT, 78, 83, 'Lo consulto con mi pareja/familia')],
        expected: { move: ['defer_payment', 'continue_by_chat', 'unknown'], action: ['none'], state: state() },
        hard: [{ type: 'contains', value: 'USD 30' }],
      },
    ],
  },
  {
    id: '09_definitive_no',
    title: 'Negativa definitiva después de trabajar el freno',
    turns: [
      {
        id: 'interest', customer: 'Estoy evaluando Fotografía Profesional para mejorar mi trabajo.',
        must: ['Orientar y avanzar con una pregunta o cierre breve.'],
        mustNot: ['No presionar ni hablar de promociones.'],
        authority: [ref(PROMPT, 25, 34, 'Cada turno tiene un propósito comercial')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'hidden_friction', customer: 'Lo voy a pensar.',
        must: ['Preguntar qué le queda por definir antes de cerrar la conversación.'],
        mustNot: ['No tratarlo aún como rechazo definitivo.'],
        authority: [ref(PROMPT, 78, 81, 'casi siempre esconde otro freno')],
        expected: { move: ['defer_payment', 'unknown'], action: ['none'], state: state({ closed: false }) },
      },
      {
        id: 'definitive', customer: 'Ya lo decidí: no quiero comprar ni seguir evaluándolo. Gracias.',
        must: ['Cerrar con calidez y brevedad, respetando la decisión.'],
        mustNot: ['No reabrir la venta, no ofrecer llamada, cuotas o bonificación y no hacer otra pregunta comercial.'],
        authority: [ref(PROMPT, 5, 5, 'no persigue'), ref(PROMPT, 66, 66, 'entiende qué lo frena'), ref(PROMPT, 81, 81, 'deja la puerta abierta sin presionar')],
        expected: { move: ['decline_purchase'], action: ['none'], state: state({ closed: true }) },
      },
    ],
  },
  {
    id: '10_requested_call',
    title: 'Pedido de llamada: datos faltantes, disponibilidad y despacho',
    turns: [
      {
        id: 'request', customer: 'Quiero que me llames para orientarme con los cursos de fotografía.',
        must: ['Aceptar el pedido y solicitar juntos sólo los datos de llamada realmente faltantes.'],
        mustNot: [
          'No exigir un curso exacto para aceptar la llamada.',
          'No despachar la llamada sin datos completos y consentimiento vigente.',
        ],
        authority: [ref(PROMPT, 204, 210, 'Ante aceptar o pedir una llamada'), ref(ROOT, 12, 12, 'consentimiento, datos completos')],
        expected: { move: ['request_call'], action: ['none'], state: state({ checkout: ['contact_details'] }) },
        hard: [{ type: 'requests_only_missing_call_fields' }],
      },
      {
        id: 'data', customer: 'Soy Ana Pérez, ana.perez@example.test, teléfono +1 305 555 0182.',
        must: ['Conservar move=request_call, usar proposed_action=none y preguntar una sola vez si puede atender ahora; puede ofrecer seguir más tarde si ahora no puede.'],
        mustNot: ['No llamar por completar el último dato y no volver a pedir campos ya recibidos.'],
        authority: [ref(PROMPT, 210, 210, 'pregunta una vez si puede atender ahora')],
        expected: { move: ['request_call', 'provide_contact_details'], action: ['none'], state: state() },
        hard: [{ type: 'question_count_at_most', value: 1 }],
      },
      {
        id: 'available', customer: 'Sí, puedo atender ahora.',
        must: ['Usar request_call_now después de la confirmación vigente.'],
        mustNot: [
          'No pedir otra confirmación.',
          'No duplicar la llamada.',
        ],
        authority: [ref(PROMPT, 210, 212, 'sólo su confirmación posterior autoriza')],
        expected: { move: ['request_call', 'none'], action: ['request_call_now'], state: state() },
      },
    ],
  },
  {
    id: '11_purchase_to_payment_link',
    title: 'Compra: datos, resumen, plan por alternativa y enlace inmediato',
    turns: [
      {
        id: 'buy', customer: 'Quiero inscribirme en Fotografía Profesional.',
        must: ['Dejar de vender el curso y pedir sólo los datos de inscripción faltantes.'],
        mustNot: ['No seguir descubriendo, no enviar link y no seleccionar plan.'],
        authority: [ref(PROMPT, 34, 34, 'Ante señal de compra'), ref(PROMPT, 218, 220, 'Solicita sólo nombre')],
        expected: { move: ['request_payment_link', 'select_course'], action: ['none'], state: state({ checkout: ['contact_details'] }) },
      },
      {
        id: 'data', customer: 'Ana Pérez, ana.perez@example.test, +1 305 555 0182.',
        must: [
          'Mostrar un resumen que incluya el nombre y apellido recibidos, el correo y el teléfono.',
          'Pedir confirmación del resumen y esperar esa respuesta antes de preguntar el plan.',
        ],
        mustNot: [
          'No mandar enlace.',
          'No listar planes junto al resumen.',
          'No reexplicar el curso.',
        ],
        authority: [ref(PROMPT, 218, 220, 'pasa directo al resumen')],
        expected: { move: ['provide_contact_details', 'request_payment_link'], action: ['none'], state: state({ checkout: ['payment_confirmation'] }) },
      },
      {
        id: 'confirm', customer: 'Sí, los datos están correctos.',
        must: ['Preguntar cómo prefiere pagar con un cierre por alternativa entre planes reales.'],
        mustNot: ['No enviar link todavía y no pedir otro dato.'],
        authority: [ref(PROMPT, 220, 220, 'pregunta cómo prefiere pagar con un cierre por alternativa')],
        expected: { move: ['ask_payment_options', 'request_payment_link'], action: ['none'], state: state({ checkout: ['payment_plan'] }) },
      },
      {
        id: 'plan_and_link', customer: 'Elijo 12 cuotas de USD 30.',
        must: ['Seleccionar monthly_12 y entregar el enlace canónico en este mismo turno.'],
        mustNot: ['No pedir otro “dale”, no repetir el resumen y no escribir una URL inventada.'],
        authority: [ref(PROMPT, 216, 222, 'su elección clara completa el pedido de checkout')],
        expected: { move: ['select_payment_plan', 'request_payment_link'], action: ['send_payment_link'], state: state({ checkout: ['link'], plan: ['monthly_12'] }) },
        hard: [{ type: 'payment_link_delivered' }],
      },
    ],
  },
  {
    id: '12_verified_payment_bonus_fulfillment',
    title: 'Pago verificado y alta completa del curso pago más bonificados',
    setup: 'fulfilled_bonus_package',
    turns: [
      {
        id: 'verified_access_event', customer: '[evento verificado: pago confirmado y alta completa]',
        must: ['El mensaje transaccional generado por el modelo y completado por el backend comunica acceso activo con todos los cursos efectivamente habilitados.'],
        mustNot: ['No prometer un alta futura, no omitir bonificados, no generar invoice y no afirmar cursos no activados.'],
        authority: [ref(PROMPT, 224, 230, 'Sólo `paid` con `paid_at`'), ref(BONUS, 87, 90, 'cada curso de `bonus_offerings`')],
        expected: { move: ['none'], action: ['none'], state: state({ plan: ['monthly_12'], promotion: promotion(['accepted'], [2], ['fotografia_profesional']) }) },
        hard: [{ type: 'access_lists_all_activated_courses' }, { type: 'not_contains', value: 'invoice' }, { type: 'not_contains', value: 'factura' }],
      },
      {
        id: 'customer_acknowledgement', customer: 'Gracias, ya veo los tres cursos.',
        must: ['Responder desde el vínculo y celebrar el próximo paso con el curso concreto.'],
        mustNot: ['No volver a vender, no prometer acceso futuro y no generar invoice.'],
        authority: [ref(PROMPT, 230, 230, 'Ante un agradecimiento después del alta')],
        expected: { move: ['ask_current_state', 'unknown'], action: ['none'], state: state({ plan: ['monthly_12'], promotion: promotion(['accepted'], [2], ['fotografia_profesional']) }) },
        hard: [{ type: 'not_contains', value: 'cuando esté listo' }, { type: 'not_contains', value: 'invoice' }],
      },
    ],
  },
  {
    id: '13_real_syllabus',
    title: 'Temario real desde hechos autorizados',
    turns: [
      {
        id: 'syllabus', customer: 'Pasame el temario de Fotografía Profesional.',
        must: ['Responder con el temario real de Fotografía Profesional recibido como dato autorizado y mantener la respuesta útil.'],
        mustNot: ['No negar que existe si llegó al contexto, no inventar módulos y no responder sólo con generalidades.'],
        authority: [ref(ROOT, 29, 29, 'Temarios'), ref(PROMPT, 50, 50, 'Contenido, duración, modalidad'), ref(PROMPT, 236, 236, 'Cita sólo lo usado')],
        expected: { move: ['ask_course_information'], action: ['none'], state: state() },
        hard: [{ type: 'response_uses_authorized_syllabus' }],
      },
      {
        id: 'duration_followup', customer: 'Y cuánto dura ese curso?',
        must: ['Responder la duración real de Fotografía Profesional desde los hechos autorizados.'],
        mustNot: ['No inventar una duración ni perder el referente del curso.'],
        authority: [ref(PROMPT, 50, 50, 'Contenido, duración, modalidad'), ref(PROMPT, 236, 236, 'Cita sólo lo usado')],
        expected: { move: ['ask_course_information'], action: ['none'], state: state() },
      },
    ],
  },
  {
    id: '14_course_change_cancels_promotion',
    evaluationMode: 'negotiation_invariants',
    title: 'Cambiar curso pago cancela la promoción y reinicia el paquete',
    turns: [
      {
        id: 'interest', customer: 'Quiero Fotografía Profesional para trabajar con emprendedores y tiendas online.',
        must: ['Mantener Fotografía Profesional como foco y construir valor.'],
        mustNot: ['No bonificar todavía.'],
        authority: [ref(PROMPT, 116, 120, 'última carta')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'price_1', customer: 'El precio es lo único que me frena.',
        must: ['Trabajar valor conectado al objetivo, registrar la objeción, terminar con la Regla C y ofrecer la llamada temprana de la Regla B.'],
        mustNot: ['No ejecutar una bonificación en la primera objeción.'],
        authority: [ref(PROMPT, 87, 87, 'price_objection'), ref(ROOT, 56, 62, '2.ª o 3.ª respuesta'), ref(ROOT, 67, 68, 'Regla C')],
        expected: { move: ['ask_course_information', 'ask_payment_options', 'unknown'], action: ['none'], state: state() },
        hard: [{ type: 'current_price_objection_recorded' }, { type: 'call_offer_recorded' },
          { type: 'contains', value: 'El precio es el único inconveniente? Puedo revisar una promoción.' }],
      },
      {
        id: 'installments', customer: 'Sigue siendo caro para mí.',
        must: ['La segunda objeción dispara el primer bonificado afín y mantiene el total de USD 360.'],
        mustNot: ['No ofrecer dos cursos nuevos ni cambiar el precio.'],
        authority: [ref(ROOT, 45, 54, '2.ª objeción de precio'), ref(PROMPT, 121, 124, 'exactamente un código')],
        expected: { move: ['ask_payment_options', 'ask_course_information', 'unknown'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [1], ['fotografia_profesional']) }) },
        hard: [{ type: 'course_bonus_preconditions' }, { type: 'action_bonus_in', values: ['diseno_photoshop'] }],
      },
      {
        id: 'isolate', customer: 'Aun en cuotas me frena el precio.',
        must: ['La nueva objeción posterior a la oferta suma el segundo bonificado y recapitula el paquete.'],
        mustNot: ['No reemplazar el primero, no repetirlo y no cambiar el total.'],
        authority: [ref(ROOT, 49, 52, 'nueva objeción de precio'), ref(PROMPT, 121, 124, 'paquete completo')],
        expected: { move: ['unknown', 'ask_course_information', 'ask_payment_options'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [2], ['fotografia_profesional']) }) },
        hard: [{ type: 'action_bonus_in', values: ['fotografia_celulares_tiendas_online'] }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'call_step', customer: 'Sí, es el único freno. Si lo resolvemos, avanzo.',
        must: ['La confirmación suma el tercer y último bonificado y recapitula todo el paquete.'],
        mustNot: ['No ofrecer un cuarto curso ni cambiar USD 360.'],
        authority: [ref(ROOT, 45, 54, 'máximo 3'), ref(PROMPT, 121, 127, 'como máximo, un tercero')],
        expected: { move: ['request_call', 'unknown', 'ask_course_information', 'ask_payment_options'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'action_bonus_in', values: ['decoracion_de_interiores'] }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'bonus_1', customer: 'Prefiero seguir por chat. El precio sigue siendo lo único que me frena.',
        must: ['Respetar la preferencia de chat y conservar el paquete de tres sin ampliarlo.'],
        mustNot: ['No modificar el precio, repetir la llamada ni ofrecer un cuarto curso.'],
        authority: [ref(ROOT, 49, 54, 'máximo 3'), ref(BONUS, 64, 67, 'bonus_limit_reached')],
        expected: { move: ['continue_by_chat', 'unknown', 'ask_payment_options'], action: ['none'], state: state({ promotion: promotion(['offer_available'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'promotion_bonus_count_at_most', value: 3 }, { type: 'response_mentions_all_promotions' }],
      },
      {
        id: 'change', negotiationProbe:'paid_course_change', customer: 'Cambio de idea: quiero que Marketing Digital sea el curso que pago.',
        must: ['Cambiar el curso pago a Marketing Digital y empezar cualquier promoción desde cero.'],
        mustNot: ['No arrastrar bonificados de Fotografía Profesional ni mantener vigente la promoción anterior.'],
        authority: [ref(BONUS, 39, 40, 'promoción anterior pasa a `cancelled`'), ref(PROMPT, 228, 228, 'Si cambia de curso, suelta el anterior')],
        expected: { move: ['select_course'], action: ['none'], state: state({ promotion: promotion(['cancelled'], [3], ['fotografia_profesional']) }) },
        hard: [{ type: 'selected_course_equals', value: 'marketing_digital' }],
        priorPromotion: { status: ['offer_available'], bonusCount: [3], paidCourse: ['fotografia_profesional'] },
      },
    ],
  },
  {
    id: '15_purchase_signal_executes',
    title: 'Señal de compra detiene argumentos y ejecuta',
    turns: [
      {
        id: 'context', customer: 'Fotografía Profesional me serviría para empezar a ofrecer sesiones.',
        must: ['Construir valor o medir temperatura sin pedir datos todavía.'],
        mustNot: ['No asumir que ya compró.'],
        authority: [ref(PROMPT, 56, 66, 'Un cierre por turno')],
        expected: { move: ['select_course', 'ask_course_information'], action: ['none'], state: state() },
      },
      {
        id: 'signal', customer: 'Dale, cómo me inscribo?',
        must: ['Dejar de argumentar y pedir únicamente los datos faltantes para ejecutar inscripción/pago.'],
        mustNot: ['No volver a vender beneficios, no descubrir motivación y no ofrecer llamada.'],
        authority: [ref(PROMPT, 34, 34, 'Ante señal de compra'), ref(PROMPT, 214, 220, 'Solicita sólo')],
        expected: { move: ['request_payment_link'], action: ['none'], state: state({ checkout: ['contact_details'] }) },
      },
    ],
  },
  {
    id: '16_discount_limit_stays_commercial',
    title: 'Pide descuento: límite amable y alternativa comercial',
    turns: [
      {
        id: 'context', customer: 'Quiero Marketing Digital para mejorar las ventas de mi emprendimiento. Cuánto cuesta?',
        must: ['Responder los planes exactos, conectar el curso con el emprendimiento y terminar con la pregunta exacta de la Regla C.'],
        mustNot: ['No ofrecer descuento de precio ni ejecutar todavía una bonificación.'],
        authority: [ref(PROMPT, 91, 102, 'El precio total no se baja'), ref(ROOT, 67, 68, 'pregunta de precio')],
        expected: { move: ['ask_payment_options', 'select_course'], action: ['none'], state: state({ plan: [null] }) },
        hard: [{ type: 'contains', value: 'El precio es el único inconveniente? Puedo revisar una promoción.' },
          { type: 'promotion_bonus_count_at_most', value: 0 }],
      },
      {
        id: 'discount', customer: 'No me hacés un descuento? USD 360 me parece caro.',
        must: ['Expresar que el valor se mantiene con amabilidad y, por el pedido explícito de descuento, ofrecer el primer curso afín decidido por el backend sin bajar USD 360.'],
        mustNot: ['No usar “no te lo puedo ofrecer”, “es lo que hay”, “no te lo voy a inventar”, “eso no lo puedo cambiar” ni cortar la venta.'],
        authority: [ref(PROMPT, 17, 20, 'no uses frases defensivas'), ref(PROMPT, 91, 102, 'El precio total no se baja'), ref(ROOT, 66, 66, 'Promo instantánea')],
        expected: { move: ['defer_payment', 'ask_payment_options', 'ask_course_information', 'unknown'], action: ['offer_course_bonus'], state: state({ promotion: promotion(['offer_available'], [1], ['marketing_digital']) }) },
        hard: [
          { type: 'not_contains', value: 'no te lo puedo ofrecer' },
          { type: 'not_contains', value: 'es lo que hay' },
          { type: 'not_contains', value: 'no te lo voy a inventar' },
          { type: 'not_contains', value: 'eso no lo puedo cambiar' },
          { type: 'current_price_objection_recorded' },
          { type: 'course_bonus_preconditions' },
          { type: 'action_bonus_in', values: ['publicidad_redes_sociales'] },
        ],
      },
    ],
  },
] as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function validateGoldenAuthorityReferences(cases: readonly GoldenCaseV1[] = GOLDEN_CASES): Promise<string[]> {
  const failures: string[] = [];
  const cache = new Map<AuthorityFile, string[]>();
  for (const scenario of cases) {
    for (const turn of scenario.turns) {
      for (const authority of turn.authority) {
        let lines = cache.get(authority.file);
        if (!lines) {
          lines = (await readFile(path.join(repoRoot, authority.file), 'utf8')).split(/\r?\n/u);
          cache.set(authority.file, lines);
        }
        if (authority.start < 1 || authority.end < authority.start || authority.end > lines.length) {
          failures.push(`${scenario.id}/${turn.id}: rango inválido ${authority.file}:${authority.start}-${authority.end}`);
          continue;
        }
        const excerpt = lines.slice(authority.start - 1, authority.end).join('\n');
        if (!excerpt.includes(authority.contains)) {
          failures.push(`${scenario.id}/${turn.id}: ${authority.file}:${authority.start}-${authority.end} no contiene ${JSON.stringify(authority.contains)}`);
        }
      }
    }
  }
  return failures;
}
