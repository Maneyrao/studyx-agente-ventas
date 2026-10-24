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

function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isEmploymentOfferTextV1(value: string): boolean {
  return /\bofertas?\s+(?:laborales?|de\s+(?:trabajo|empleo))\b/u.test(value)
    || /\b(?:trabajo|empleo)\b[^.!?\n]{0,32}\bofertas?\b/u.test(value);
}

function isPromotionOptOutTextV1(value: string): boolean {
  return /\bno\s+quiero\b[^.!?\n]{0,40}\b(?:recibir|ver|que\s+me\s+(?:mandes|envies|ofrezcas))\b[^.!?\n]{0,24}\bofertas?\b/u.test(value)
    || /\bno\s+me\s+(?:mandes|envies)\b[^.!?\n]{0,24}\bofertas?\b/u.test(value)
    || /\bno\s+me\s+ofrec\p{L}*\s+mas\s+ofertas?\b/u.test(value);
}

function authorizedCourseBonusClaimV1(
  text: string,
  authorizedNames: readonly string[],
): { readonly matched: boolean; readonly remaining: string } {
  let remaining = text;
  let matched = false;
  for (const rawName of authorizedNames) {
    const name = normalized(rawName);
    if (!name) continue;
    const escapedName = regexLiteral(name);
    const patterns = [
      new RegExp(`\\b(?:te\\s+)?(?:puedo\\s+)?(?:inclu\\p{L}*|sum\\p{L}*|agreg\\p{L}*|bonific\\p{L}*|regal\\p{L}*|ofrec\\p{L}*)\\b\\s+(?:(?:el|la|un|una)\\s+)?(?:curso\\s+(?:de\\s+)?)?${escapedName}(?:\\s+(?:gratis|sin\\s+costo(?:\\s+adicional)?|incluid\\p{L}*|bonific\\p{L}*))?`, 'gu'),
      new RegExp(`${escapedName}(?:\\s+(?:queda|va|esta|seria|se\\s+incluye|te\\s+lo\\s+dejo))?\\s+(?:gratis|sin\\s+costo(?:\\s+adicional)?|incluid\\p{L}*|bonific\\p{L}*)\\b`, 'gu'),
    ];
    for (const pattern of patterns) {
      remaining = remaining.replace(pattern, () => {
        matched = true;
        return ' ';
      });
    }
  }
  return { matched, remaining };
}

export function isPriceObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  if (isOfferTimingQuestionTextV1(value)
    || isEmploymentOfferTextV1(value)
    || isPromotionOptOutTextV1(value)) return false;
  return /\b(?:car[oa]|costos[oa]|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza|no\s+llego|no\s+(?:puedo|podria|podre)\s+(?:pagar|abonarlo|hacer\s+ese\s+gasto)|se\s+me\s+va|much[oa]\s+dinero|presupuesto\b[^.!?\n]{0,32}\b(?:ajustado|limitado|no\s+(?:me\s+)?(?:alcanza|permite)))\b/u.test(value)
    || /\b(?:(?:hay|tenes|tienes|ofreces|haces|me\s+haces|puedes|podes)\b[^.!?\n]{0,40}\b(?:descuentos?|rebajas?|promos?|promocion(?:es)?|bonificacion(?:es)?|ofertas?)|(?:bajar|reducir)\b[^.!?\n]{0,24}\b(?:el\s+)?precio)\b/u.test(value);
}

export function customerExpressesRealBudgetLimitV1(text: string): boolean {
  const value = normalized(text);
  return /\b(?:no\s+me\s+alcanza|no\s+llego|no\s+(?:puedo|podria|podre)\s+(?:pagar|abonarlo|hacer\s+ese\s+gasto)|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+tengo\s+(?:el\s+)?(?:dinero|plata)|presupuesto\b[^.!?\n]{0,40}\b(?:no\s+(?:me\s+)?(?:alcanza|permite)|ajustado|limitado))\b/u.test(value);
}

function isPaymentTermsQuestionTextV1(text: string): boolean {
  const value = normalized(text);
  const installmentVersusStudy = /\b(?:pago|cuotas?)\b[^.!?\n]{0,72}\b(?:mes(?:es)?|12|doce|6|seis)\b[^.!?\n]{0,72}\b(?:diploma|certificado|termin\p{L}*|dur\p{L}*|estudi\p{L}*|curso)\b/u.test(value);
  const allAtOnce = /\b(?:pagar|pago)\b[^.!?\n]{0,32}\b(?:todo\s+junto|completo|total)\b[^.!?\n]{0,48}\b(?:empezar|iniciar|arrancar|inscrib\p{L}*)\b/u.test(value);
  const installmentQuestion = /\b(?:puedo|podria|se\s+puede|hay\s+posibilidad\s+de)\s+(?:pagar|abonar)(?:lo)?\s+en\s+(?:cuotas?|pagos?|mensualidades?)\b/u.test(value)
    || /\bcuantas?\s+(?:cuotas?|pagos?|mensualidades?)\b/u.test(value)
    || /\b(?:que|cuales)\s+(?:opciones|formas|modalidades)\s+de\s+pago\b/u.test(value)
    || /(?:^|[.!?\n]\s*)(?:es\s+)?(?:solo\s+)?(?:un|1)\s+(?:solo\s+)?pago\s*\?/u.test(value);
  return installmentVersusStudy || allAtOnce || installmentQuestion;
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
  const paymentTermsQuestion = isPaymentTermsQuestionTextV1(current);
  if (isOfferTimingQuestionTextV1(current)) return { kind: 'offer_timing_question' };
  if (priceObjection && (priceQuestion || paymentTermsQuestion)) {
    return { kind: 'price_question_with_objection' };
  }
  if (priceObjection) {
    const priorPriceObjection = context.turn.recent_turns.some((turn) => (
      turn.direction === 'inbound' && isPriceObjectionTextV1(turn.content)
    ));
    return { kind: priorPriceObjection ? 'repeated_price_objection' : 'price_objection' };
  }
  if (isPaymentFrictionTextV1(current)) return { kind: 'payment_friction' };
  if (paymentTermsQuestion) return { kind: 'payment_terms_question' };
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
  readonly authorized_bonus_offering_names?: readonly string[];
}): boolean {
  const text = normalized([
    ...input.messages,
    ...(input.call_offer ? [input.call_offer] : []),
  ].join('\n'));
  const installmentFacts = /\b(?:\d+|seis|doce)\s+(?:pagos?|cuotas?|mensualidades?)\b/u.test(text)
    || /\b(?:cuota|plan)\b[^.!?\n]{0,48}\b(?:usd|dolares?)\b/u.test(text)
    || /\b(?:usd\s*)?\d+(?:[.,]\d+)?\s*(?:dolar(?:es)?)?\s+(?:al\s+mes|mensual(?:es|mente)?)\b/u.test(text)
    || /\b(?:pagarlo|pagalo|pagar|abonarlo|abonar)\b[^.!?\n]{0,36}\b(?:en\s+)?(?:cuotas?|pagos?\s+mensuales?|mensualidades?)\b/u.test(text);
  const monthlyMinimization = /\b(?:solo|apenas)\b[^.!?\n]{0,32}\b(?:usd|\d+|dolar(?:es)?)\b[^.!?\n]{0,24}\b(?:al\s+mes|mensual(?:es|mente)?)\b/u.test(text)
    || /\b(?:opcion|plan|cuota)\s+mensual\b[^.!?\n]{0,32}\b(?:mas\s+)?(?:accesible|barat[oa]|baj[oa]|livian[oa])\b/u.test(text)
    || /\b(?:cuota|plan|opcion)\b[^.!?\n]{0,40}\b(?:mas\s+)?(?:baj[oa]|chic[oa]|livian[oa]|accesible|barat[oa])\b/u.test(text)
    || /\b(?:te\s+)?recomiend\p{L}*\b[^.!?\n]{0,56}\b(?:cuota|plan|pagos?|mensualidad)\b/u.test(text)
    || /\b(?:asi|porque)\b[^.!?\n]{0,32}\b(?:resulta|queda|es|sea)\b[^.!?\n]{0,20}\b(?:mas\s+)?(?:accesible|barat[oa]|livian[oa])\b/u.test(text)
    || /\b(?:menos\s+pesa|pesa\s+menos)\b/u.test(text);
  const installmentPitch = monthlyMinimization
    || (!input.allow_requested_payment_terms && installmentFacts);
  const dailyComparison = /\b(?:menos\s+de\s+)?(?:usd\s*)?(?:\d+(?:[.,]\d+)?|un[oa]?)\s*(?:dolar(?:es)?)?\s+(?:por|al)\s+dia\b/u.test(text)
    || /\b(?:cafe|gasto\s+cotidiano|lo\s+que\s+gastas?)\b[^.!?\n]{0,56}\b(?:por\s+dia|diario|inversion|cuesta|precio)\b/u.test(text)
    || /\b(?:inversion|cuesta|precio)\b[^.!?\n]{0,56}\b(?:cafe|gasto\s+cotidiano|lo\s+que\s+gastas?)\b/u.test(text);
  const textWithoutDiscountNegation = text.replace(/\b(?:sin|no\s+hay|no\s+aplica(?:n)?|no\s+incluye(?:n)?)\s+(?:ningun\p{L}*\s+)?(?:descuentos?|rebajas?)\b/gu, ' ');
  const priceReduction = /\b(?:descuentos?|rebajas?)\b/u.test(textWithoutDiscountNegation)
    || /\b(?:bajar|reducir)\b[^.!?\n]{0,24}\b(?:el\s+)?precio\b/u.test(textWithoutDiscountNegation);
  const courseBonus = /\b(?:bonific\p{L}*|gratis|sin\s+costo|regal\p{L}*)\b/u.test(text)
    || /\b(?:agregar|sumar|incluir)\b[^.!?\n]{0,56}\b(?:otro\s+)?curso\b[^.!?\n]{0,48}\b(?:mismo\s+(?:precio|valor)|incluido)\b/u.test(text);
  const authorizedClaim = authorizedCourseBonusClaimV1(
    text,
    input.authorized_bonus_offering_names ?? [],
  );
  const unconsumedGift = /\b(?:bonific\p{L}*|gratis|sin\s+costo|regal\p{L}*)\b/u.test(authorizedClaim.remaining)
    || /\b(?:agregar|sumar|incluir)\b[^.!?\n]{0,56}\b(?:otro\s+)?curso\b[^.!?\n]{0,48}\b(?:mismo\s+(?:precio|valor)|incluido)\b/u.test(authorizedClaim.remaining);
  return !installmentPitch
    && !dailyComparison
    && !priceReduction
    && (!courseBonus || (authorizedClaim.matched && !unconsumedGift));
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
  readonly customer_expressed_real_budget_limit?: boolean;
  readonly authorized_bonus_offering_names?: readonly string[];
}): boolean {
  if (!responseAvoidsDisallowedPriceReframingV1(input)) return false;
  if ((input.authorized_bonus_offering_names?.length ?? 0) > 0) {
    const authorizedOfferText = normalized(input.messages.join('\n'));
    const authorizedClaim = authorizedCourseBonusClaimV1(
      authorizedOfferText,
      input.authorized_bonus_offering_names!,
    );
    const mentionsIncludedCourse = /\b(?:bonific\p{L}*|gratis|sin\s+costo|regal\p{L}*)\b/u.test(authorizedOfferText)
      || /\b(?:agregar|sumar|incluir)\b[^.!?\n]{0,56}\b(?:otro\s+)?curso\b[^.!?\n]{0,48}\b(?:mismo\s+(?:precio|valor)|incluido)\b/u.test(authorizedOfferText);
    if (authorizedClaim.matched && mentionsIncludedCourse) return true;
  }
  // Once the customer has explicitly said they cannot afford the purchase,
  // any non-empty answer that preserves the price guard may acknowledge or
  // close naturally. Requiring a specific sentence here caused valid replies
  // to enter repair and, if repair failed, disappear from the conversation.
  if (input.customer_expressed_real_budget_limit && input.messages.some((message) => message.trim().length > 0)) {
    return true;
  }
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
  return concreteDiagnosticQuestion
    || (conditionalValueConnection && !vagueConditionalTarget);
}
