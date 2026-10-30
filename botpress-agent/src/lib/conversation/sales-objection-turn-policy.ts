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
  | 'decision_deferral'
  | 'offer_timing_question';

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
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


export function isPriceObjectionTextV1(text: string): boolean {
  const value = normalized(text);
  if (isOfferTimingQuestionTextV1(value)
    || isEmploymentOfferTextV1(value)
    || isPromotionOptOutTextV1(value)) return false;
  return /\b(?:car[oa]|costos[oa]|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza|no\s+llego|no\s+(?:puedo|podria|podre)\s+(?:pagar|abonarlo|hacer\s+ese\s+gasto)|se\s+me\s+va|much[oa]\s+dinero|presupuesto\b[^.!?\n]{0,32}\b(?:ajustado|limitado|no\s+(?:me\s+)?(?:alcanza|permite)))\b/u.test(value)
    || /\b(?:(?:hay|tenes|tienes|ofreces|haces|me\s+haces|puedes|podes)\b[^.!?\n]{0,40}\b(?:descuentos?|rebajas?|promos?|promocion(?:es)?|bonificacion(?:es)?|ofertas?)|(?:bajar|reducir)\b[^.!?\n]{0,24}\b(?:el\s+)?precio)\b/u.test(value);
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

function isDecisionDeferralTextV1(text: string): boolean {
  const value = normalized(text);
  const withoutNegatedDeferrals = value.replace(
    /\bno\s+(?:necesito|quiero|voy\s+a|tengo\s+que|lo\s+tengo\s+que)\s+pensar(?:lo)?(?:\s+mas)?\b/gu,
    (match) => ' '.repeat(match.length),
  );
  const deferralPatterns = [
    /\b(?:tengo\s+que|lo\s+tengo\s+que|necesito|quiero|voy\s+a|dejame)\s+pensar(?:lo)?\b/gu,
    /\b(?:quiero|necesito)\s+(?:un\s+poco\s+de\s+)?tiempo\s+para\s+pensar(?:lo)?\b/gu,
    /\b(?:lo|me\s+lo)\s+voy\s+a\s+pensar\b/gu,
    /\bno\s+(?:me\s+)?quiero\s+(?:pagar|comprar|inscribirme|inscribir|anotarme|anotar)\b[^.!?\n]{0,40}\b(?:ahora|todavia|aun|por\s+ahora|ya)\b/gu,
  ];
  const purchasePatterns = [
    /\b(?:pasame|mandame|enviame|compartime)\s+(?:el\s+)?(?:link|enlace)\b/gu,
    /\b(?:quiero|voy\s+a|me\s+decidi\s+a|decidi|list[oa]\s+para)\s+(?:comprar|pagar|inscribirme|inscribir|anotarme|anotar|avanzar)\b/gu,
  ];
  const lastMatchIndex = (patterns: readonly RegExp[], input: string, ignoreNegatedPurchase = false): number => {
    let lastIndex = -1;
    for (const pattern of patterns) {
      for (const match of input.matchAll(pattern)) {
        const matchIndex = match.index ?? -1;
        if (ignoreNegatedPurchase) {
          const prefix = input.slice(Math.max(0, matchIndex - 12), matchIndex);
          if (/\bno(?:\s+me)?\s*$/u.test(prefix)) continue;
        }
        lastIndex = Math.max(lastIndex, matchIndex);
      }
    }
    return lastIndex;
  };
  const lastDeferralIndex = lastMatchIndex(deferralPatterns, withoutNegatedDeferrals);
  if (lastDeferralIndex < 0) return false;
  const lastPurchaseIndex = lastMatchIndex(purchasePatterns, value, true);
  return lastPurchaseIndex <= lastDeferralIndex;
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
  if (isDecisionDeferralTextV1(current)) return { kind: 'decision_deferral' };
  if (isPaymentFrictionTextV1(current)) return { kind: 'payment_friction' };
  if (paymentTermsQuestion) return { kind: 'payment_terms_question' };
  if (isPriceQuestionTextV1(current)) return { kind: 'price_question' };
  if (isTimeOrScheduleObjectionTextV1(current)) return { kind: 'time_or_schedule_objection' };
  if (isReadinessOrRequirementsObjectionTextV1(current)) return { kind: 'readiness_or_requirements_objection' };
  if (isTrustObjectionTextV1(current)) return { kind: 'trust_objection' };
  return { kind: 'none' };
}
