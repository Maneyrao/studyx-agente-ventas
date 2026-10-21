import type { AgentAContextV1 } from '../../schemas/agent-a-brain';

export type SalesObjectionTurnKindV1 =
  | 'none'
  | 'price_question'
  | 'price_question_with_objection'
  | 'price_objection'
  | 'repeated_price_objection'
  | 'payment_terms_question'
  | 'time_or_schedule_objection'
  | 'readiness_or_requirements_objection'
  | 'trust_objection'
  | 'payment_friction'
  | 'offer_timing_question';

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isPriceObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:car[oa]|costos[oa]|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza|no\s+llego|se\s+me\s+va|much[oa]\s+dinero|presupuesto\b[^.!?\n]{0,32}\b(?:ajustado|limitado))\b/u.test(value);
}

function isPaymentTermsQuestionTextV1(text: string): boolean {
  const value = normalized(text);
  const installmentVersusStudy = /\b(?:pago|cuotas?)\b[^.!?\n]{0,72}\b(?:mes(?:es)?|12|doce|6|seis)\b[^.!?\n]{0,72}\b(?:diploma|certificado|termin\p{L}*|dur\p{L}*|estudi\p{L}*|curso)\b/u.test(value);
  const allAtOnce = /\b(?:pagar|pago)\b[^.!?\n]{0,32}\b(?:todo\s+junto|completo|total)\b[^.!?\n]{0,48}\b(?:empezar|iniciar|arrancar|inscrib\p{L}*)\b/u.test(value);
  return installmentVersusStudy || allAtOnce;
}

function isTimeOrScheduleObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:no\s+(?:se\s+)?si\s+(?:voy\s+a\s+)?tener\s+tiempo|no\s+tengo\s+tiempo|trabajo\s+mucho|no\s+puedo\b[^.!?\n]{0,36}\bhorario|ese\s+horario\s+no|prefiero\s+estudiar\s+(?:de|a\s+la)\s+(?:manana|tarde|noche)|me\s+sirve\s+(?:de|por)\s+(?:la\s+)?(?:manana|tarde|noche))\b/u.test(value)
    || /\bclases?\b[^.!?\n]{0,32}\b(?:lunes\s+a\s+viernes|horarios?|manana|tarde|noche)\b/u.test(value);
}

function isReadinessOrRequirementsObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  const beginnerConcern = /\b(?:estoy|empiezo|arranco|comienzo)\s+(?:completamente\s+)?desde\s+cero\b/u.test(value)
    || /\bno\s+tengo\s+(?:experiencia|conocimientos?|base)\b/u.test(value);
  const missingEquipment = /\bno\s+tengo\s+(?:computadora|ordenador|pc|laptop|notebook|camara|equipo|herramientas?|maquina|celular|telefono)\b/u.test(value);
  return beginnerConcern || missingEquipment;
}

function isTrustObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:el\s+)?certificado\b[^.!?\n]{0,36}\b(?:sirve|vale|validez|reconocido|oficial)\b/u.test(value)
    || /\b(?:escuela|academia|studyx)\b[^.!?\n]{0,28}\b(?:real|confiable|legitima|seria)\b/u.test(value)
    || /\b(?:es\s+una\s+estafa|como\s+se\s+que\s+es\s+real|puedo\s+confiar)\b/u.test(value)
    || /\b(?:pense|crei|entendi)\b[^.!?\n]{0,56}\b(?:profesor\s+en\s+vivo|clases?\s+en\s+vivo)\b[^.!?\n]{0,48}\b(?:videos?|grabad[oa]s?)\b/u.test(value);
}

function isPaymentFrictionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:banco\b[^.!?\n]{0,44}\b(?:no\s+me\s+deja|rechaz\p{L}*|bloque\p{L}*)|tarjeta\b[^.!?\n]{0,44}\b(?:no\s+(?:me\s+)?pasa|no\s+funciona|rechaz\p{L}*|declinad\p{L}*|bloque\p{L}*|cajero|perdi|olvide)|(?:recarg|carg)(?:o|ar|ando)?\b[^.!?\n]{0,28}\btarjeta|no\s+puedo\b[^.!?\n]{0,32}\b(?:hacer|completar|meter)\b[^.!?\n]{0,24}\b(?:pago|cash)|(?:fallo|falla|error)\b[^.!?\n]{0,24}\bpago)\b/u.test(value);
}

function isOfferTimingQuestionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:hasta\s+cuando|por\s+cuanto\s+tiempo)\b[^.!?\n]{0,48}\b(?:oferta|promocion|precio|valor)\b/u.test(value)
    || /\b(?:oferta|promocion|precio|valor)\b[^.!?\n]{0,48}\b(?:vence|vencimiento|valida|vigente)\b/u.test(value);
}

function isPriceQuestionTextV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:cual\s+es\s+(?:el\s+)?(?:costo|precio|valor)|cuanto\s+(?:cuesta|sale|vale)|que\s+(?:costo|precio|valor)\s+tiene)\b/u.test(value)
    || /\bcuanto\b[^.!?\n]{0,56}\b(?:cuotas?|pagos?)\b/u.test(value);
}

export function evaluateSalesObjectionTurnV1(
  context: AgentAContextV1,
): { readonly kind: SalesObjectionTurnKindV1 } {
  const current = context.turn.batch_messages.map((message) => message.text).join('\n');
  const priceObjection = isPriceObjectionTextV1(current);
  const priceQuestion = isPriceQuestionTextV1(current);
  if (priceObjection && priceQuestion) return { kind: 'price_question_with_objection' };
  if (priceObjection) {
    const priorPriceObjection = context.turn.recent_turns.some((turn) => (
      turn.direction === 'inbound' && isPriceObjectionTextV1(turn.content)
    ));
    return { kind: priorPriceObjection ? 'repeated_price_objection' : 'price_objection' };
  }
  if (isPaymentFrictionTextV1(current)) return { kind: 'payment_friction' };
  if (isPaymentTermsQuestionTextV1(current)) return { kind: 'payment_terms_question' };
  if (isOfferTimingQuestionTextV1(current)) return { kind: 'offer_timing_question' };
  if (isPriceQuestionTextV1(current)) return { kind: 'price_question' };
  if (isTimeOrScheduleObjectionTextV1(current)) return { kind: 'time_or_schedule_objection' };
  if (isReadinessOrRequirementsObjectionTextV1(current)) return { kind: 'readiness_or_requirements_objection' };
  if (isTrustObjectionTextV1(current)) return { kind: 'trust_objection' };
  return { kind: 'none' };
}

/**
 * Price objections are handled by clarifying the real friction and connecting
 * authorized value to the customer's context. A valid catalog price may still
 * answer a direct price question, but it must not be used as a tactic to make
 * an objection feel cheaper.
 */
export function responseAvoidsDisallowedPriceReframingV1(input: {
  readonly messages: readonly string[];
  readonly call_offer?: string | null;
  readonly allow_requested_payment_terms?: boolean;
}): boolean {
  const text = normalized([
    ...input.messages,
    ...(input.call_offer ? [input.call_offer] : []),
  ].join('\n'));
  const installmentFacts = /\b(?:\d+|seis|doce)\s+(?:pagos?|cuotas?)\b/u.test(text)
    || /\b(?:cuota|plan)\b[^.!?\n]{0,48}\b(?:mas\s+(?:baja|chica|liviana|accesible)|accesible|usd|dolares?)\b/u.test(text)
    || /\b(?:pagarlo|pagalo|pagar|abonarlo|abonar)\b[^.!?\n]{0,36}\b(?:en\s+)?(?:cuotas?|pagos?\s+mensuales?|mensualidades?)\b/u.test(text);
  const monthlyMinimization = /\b(?:solo|apenas)\b[^.!?\n]{0,32}\b(?:usd|\d+|dolar(?:es)?)\b[^.!?\n]{0,24}\b(?:al\s+mes|mensual(?:es|mente)?)\b/u.test(text)
    || /\bmensualidades?\b[^.!?\n]{0,32}\b(?:usd|\d+|dolar(?:es)?)\b/u.test(text)
    || /\b(?:opcion|plan|cuota)\s+mensual\b[^.!?\n]{0,32}\b(?:mas\s+)?(?:accesible|barat[oa]|baj[oa]|livian[oa])\b/u.test(text)
    || /\b(?:usd\s*)?\d+(?:[.,]\d+)?\s*(?:dolar(?:es)?)?\s+(?:al\s+mes|mensual(?:es|mente)?)\b/u.test(text);
  const installmentPitch = monthlyMinimization
    || (!input.allow_requested_payment_terms && installmentFacts);
  const dailyComparison = /\b(?:menos\s+de\s+)?(?:usd\s*)?(?:\d+(?:[.,]\d+)?|un[oa]?)\s*(?:dolar(?:es)?)?\s+(?:por|al)\s+dia\b/u.test(text)
    || /\b(?:cafe|gasto\s+cotidiano|lo\s+que\s+gastas?)\b[^.!?\n]{0,56}\b(?:por\s+dia|diario|inversion|cuesta|precio)\b/u.test(text)
    || /\b(?:inversion|cuesta|precio)\b[^.!?\n]{0,56}\b(?:cafe|gasto\s+cotidiano|lo\s+que\s+gastas?)\b/u.test(text);
  const concession = /\b(?:descuento|bonific\p{L}*|gratis|sin\s+costo|regal\p{L}*)\b/u.test(text)
    || /\b(?:agregar|sumar|incluir)\b[^.!?\n]{0,56}\b(?:otro\s+)?curso\b[^.!?\n]{0,48}\b(?:mismo\s+(?:precio|valor)|incluido)\b/u.test(text);
  return !installmentPitch && !dailyComparison && !concession;
}

/**
 * A repeated objection must move somewhere: clarify the customer's intended
 * outcome, connect an authorized fact to a possible use, or offer the live
 * conversation that can resolve it. This rejects sterile repetition without
 * prescribing customer-facing copy.
 */
export function responseProgressesRepeatedPriceObjectionV1(input: {
  readonly messages: readonly string[];
  readonly call_offer?: string | null;
}): boolean {
  if (!responseAvoidsDisallowedPriceReframingV1(input)) return false;
  const visible = input.messages.join('\n');
  const text = normalized(visible);
  const concreteDiagnosticQuestion = (visible.match(/[^.!?\n]+\?/gu) ?? []).some((question) => {
    const candidate = normalized(question).replace(/^[¿\s]+/u, '');
    const genericClosing = /^(?:que\s+te\s+parece|te\s+parece|que\s+opinas|como\s+lo\s+ves|te\s+sirve|quieres\s+avanzar|queres\s+avanzar)\??$/u.test(candidate);
    if (genericClosing) return false;
    const selectsPaymentPlan = /\b(?:pagar|cuotas?|usd|plan)\b/u.test(candidate)
      && /\b(?:cual|prefieres|preferis|quieres|queres|eliges|elegis)\b/u.test(candidate);
    if (selectsPaymentPlan) return false;
    const merelyReoffersPayment = /\b(?:prefieres|preferis|quieres|queres|puedes|podes)\b[^?\n]{0,80}\b(?:pagar|cuotas?|usd|plan)\b/u.test(candidate);
    if (merelyReoffersPayment) return false;
    const opensDiagnosis = /^(?:que|cual|como|por\s+que|para\s+que)\b/u.test(candidate);
    const namesDecisionDimension = /\b(?:frena|frenando|presupuesto|confianza|aprovechar|objetivo|lograr|hacer|usar|aplicar|emprender|negocio|trabajo|ingresos?|conviene|duda|dudar|cuota\s+mensual|quieres|queres|buscas|necesitas)\b/u.test(candidate);
    return opensDiagnosis || namesDecisionDimension;
  });
  const vagueConditionalTarget = /\b(?:lo\s+que\s+(?:quieras|necesites|sea)|cualquier\s+cosa)\b/u.test(text);
  const conditionalValueConnection = /\b(?:lo\s+aprendido\s+)?te\s+(?:puede|podria|podrias|podes|puedes)\s+(?:servir|ayudar)\s+(?:a|para)\b/u.test(text)
    || /\b(?:podria|podrias|podes|puedes)\s+(?:aplicar|usar)\b[^.!?\n]{0,100}\b(?:en|para)\b/u.test(text);
  const acknowledgesRealBudgetLimit = /\b(?:presupuesto\b[^.!?\n]{0,56}\b(?:no\s+te\s+lo\s+permite|no\s+alcanza|limite)|no\s+(?:puedes|podes)\s+pagar)\b/u.test(text)
    && /\b(?:esta\s+bien|sin\s+presion|no\s+quiero\s+presionarte|no\s+te\s+voy\s+a\s+presionar)\b/u.test(text);
  return concreteDiagnosticQuestion
    || (conditionalValueConnection && !vagueConditionalTarget)
    || acknowledgesRealBudgetLimit;
}
