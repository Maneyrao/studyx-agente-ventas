import type { AgentAContextV1 } from '../../schemas/agent-a-brain';
import {
  supportsCallDeclineV1,
  supportsCallRequestV1,
  supportsChatPreferenceV1,
} from './channel-preference-evidence';

export type CallOfferTurnReasonV1 =
  | 'FIRST_NAME_OR_NEED_MISSING'
  | 'FIRST_OFFER_DUE'
  | 'SECOND_PRICE_OBJECTION'
  | 'SECOND_MULTIPLE_QUESTIONS'
  | 'SECOND_INDECISION'
  | 'SECOND_DETAILS_REQUEST'
  | 'SECOND_PREPAYMENT_FRICTION'
  | 'SECOND_BEFORE_FINAL_DATA'
  | 'SECOND_NOT_YET_DUE'
  | 'SOFT_CHAT_PREFERENCE_THIS_TURN'
  | 'CALL_ACCEPTED'
  | 'CALL_REJECTED'
  | 'OPTED_OUT'
  | 'HANDOFF_OR_CLOSED'
  | 'DIRECT_PURCHASE'
  | 'CALL_OFFER_LIMIT_REACHED'
  | 'CALL_OFFER_NOT_AUTHORIZED';

export type CallOfferCustomerSignalV1 =
  | 'none'
  | 'acceptance'
  | 'rejection'
  | 'chat_preference'
  | 'opt_out'
  | 'direct_purchase';

export interface CallOfferTurnPolicyV1 {
  readonly offer_required: boolean;
  readonly offer_allowed: boolean;
  readonly reason: CallOfferTurnReasonV1;
  readonly customer_signal: CallOfferCustomerSignalV1;
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
}

function currentText(context: AgentAContextV1): string {
  return context.turn.batch_messages.map((message) => message.text).join('\n');
}

function suppliesFirstName(text: string): boolean {
  return /\b(?:soy|me llamo|mi nombre es)\s+[\p{L}]{2,}/iu.test(text);
}

const GENERIC_CATALOG_WORDS = new Set([
  'academia', 'curso', 'cursos', 'online', 'virtual', 'integral', 'especialista',
]);

/**
 * A family such as "inglés" or an area such as "tecnología" is already a
 * concrete customer need even when it intentionally resolves to several
 * courses. This only decides whether to remind the model about the first call
 * offer; it never selects a course or writes customer copy.
 */
function mentionsCatalogInterest(context: AgentAContextV1, text: string): boolean {
  const customerTokens = new Set(
    normalized(text).split(/[^a-z0-9]+/u).filter((token) => token.length >= 4),
  );
  const catalogLabels = [
    ...context.catalog.available_offerings.map((offering) => offering.display_name),
    ...context.catalog.areas.map((area) => area.display_name),
  ];
  return catalogLabels.some((label) => normalized(label)
    .split(/[^a-z0-9]+/u)
    .some((token) => token.length >= 4
      && !GENERIC_CATALOG_WORDS.has(token)
      && customerTokens.has(token)));
}

function directPurchase(text: string): boolean {
  const value = normalized(text);
  return /\b(?:mandame|enviame|pasame|compartime)\s+(?:el\s+)?(?:link|enlace)\b/u.test(value)
    || /\b(?:quiero|voy\s+a|listo\s+para|decidi)\b[^.!?\n]{0,36}\b(?:comprar|pagar|inscribirme|anotarme|avanzar)\b/u.test(value);
}

function optOut(text: string): boolean {
  const value = normalized(text);
  return /\b(?:no\s+(?:quiero|deseo)\s+(?:recibir\s+)?mas\s+mensajes|deja\s+de\s+(?:escribirme|contactarme)|dame\s+de\s+baja|no\s+me\s+contactes|stop)\b/u.test(value);
}

function priceObjection(text: string): boolean {
  const value = normalized(text);
  return /\b(?:car[oa]|costos[oa]|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza|no\s+llego|se\s+me\s+va|much[oa]\s+dinero|presupuesto\b[^.!?\n]{0,32}\b(?:ajustado|limitado))\b/u.test(value);
}

function severalQuestions(context: AgentAContextV1, text: string): boolean {
  const closingQuestionMarks = (text.match(/\?/gu) ?? []).length;
  const currentQuestionMarks = closingQuestionMarks > 0
    ? closingQuestionMarks
    : (text.match(/¿/gu) ?? []).length;
  if (currentQuestionMarks >= 2 || /\b(?:varias|muchas)\s+(?:dudas|preguntas)\b/u.test(normalized(text))) {
    return true;
  }
  const priorQuestionTurns = context.turn.recent_turns.filter((turn) => (
    turn.direction === 'inbound' && /[?¿]/u.test(turn.content)
  )).length;
  return priorQuestionTurns >= 2 && /[?¿]/u.test(text);
}

function indecision(text: string): boolean {
  const value = normalized(text);
  return /\b(?:no\s+se\s+(?:si|cual|que)|no\s+me\s+decido|estoy\s+entre|dudo\s+entre|indecis[oa]|cual\s+me\s+conviene|comparando)\b/u.test(value);
}

function detailsRequest(text: string): boolean {
  const value = normalized(text);
  return /\b(?:en\s+detalle|detalladamente|mas\s+detalle|todos?\s+los\s+detalles|temario|contenidos?|que\s+incluye)\b/u.test(value);
}

function prepaymentFriction(text: string): boolean {
  const value = normalized(text);
  return /\b(?:antes\s+de\s+pagar|pensarlo|mas\s+adelante|lo\s+veo\s+despues|ahora\s+no|todavia\s+no|no\s+estoy\s+segur[oa]|consultarlo|falta\s+de\s+tiempo|no\s+tengo\s+tiempo)\b/u.test(value);
}

function asksForMissingIntake(
  context: AgentAContextV1,
  responseMessages: readonly string[],
): boolean {
  const missing = context.capabilities.intake_missing ?? [];
  if (missing.length === 0 || responseMessages.length === 0) return false;
  const text = normalized(responseMessages.join(' '));
  const terms: Record<(typeof missing)[number], RegExp> = {
    nombre: /\bnombre\b/u,
    apellido: /\bapellido\b/u,
    correo: /\b(?:correo|email|mail)\b/u,
    telefono: /\b(?:telefono|celular)\b/u,
  };
  return missing.some((field) => terms[field].test(text));
}

/**
 * Per-turn call-offer decision shared by generation, validation and audit.
 * It never writes customer copy and never infers consent from model output.
 */
export function evaluateCallOfferTurnPolicyV1(input: {
  readonly context: AgentAContextV1;
  readonly response_messages?: readonly string[];
  /** Course resolved by the proposal being validated/audited in this turn. */
  readonly proposed_course_reference?: string | null;
}): CallOfferTurnPolicyV1 {
  const { context } = input;
  const text = currentText(context);
  const pendingOffer = context.commercial_state.call_offer_status === 'offered';
  const customerSignal: CallOfferCustomerSignalV1 = optOut(text)
    ? 'opt_out'
    : supportsCallDeclineV1(text, pendingOffer)
      ? 'rejection'
      : supportsCallRequestV1(text, pendingOffer)
        ? 'acceptance'
        : directPurchase(text)
          ? 'direct_purchase'
          : supportsChatPreferenceV1(text, pendingOffer)
            ? 'chat_preference'
            : 'none';

  if (customerSignal === 'opt_out') {
    return { offer_required: false, offer_allowed: false, reason: 'OPTED_OUT', customer_signal: customerSignal };
  }
  if (customerSignal === 'rejection') {
    return { offer_required: false, offer_allowed: false, reason: 'CALL_REJECTED', customer_signal: customerSignal };
  }
  if (customerSignal === 'acceptance'
      || context.commercial_state.call_offer_status === 'accepted'
      || context.commercial_state.call_preference === 'call') {
    return { offer_required: false, offer_allowed: false, reason: 'CALL_ACCEPTED', customer_signal: customerSignal };
  }
  if (context.commercial_state.stage === 'handoff'
      || context.commercial_state.stage === 'closed'
      || context.commercial_state.stage === 'payment_link_sent'
      || context.commercial_state.payment_reported) {
    return { offer_required: false, offer_allowed: false, reason: 'HANDOFF_OR_CLOSED', customer_signal: customerSignal };
  }
  if (context.commercial_state.call_offer_count >= 2) {
    return { offer_required: false, offer_allowed: false, reason: 'CALL_OFFER_LIMIT_REACHED', customer_signal: customerSignal };
  }
  if (!context.capabilities.may_offer_call) {
    return { offer_required: false, offer_allowed: false, reason: 'CALL_OFFER_NOT_AUTHORIZED', customer_signal: customerSignal };
  }

  if (context.commercial_state.call_offer_count === 0) {
    const nameKnown = Boolean(context.customer.display_name?.trim())
      || Boolean(context.customer.contact_intake?.nombre?.trim())
      || suppliesFirstName(text);
    const needKnown = context.catalog.selected_offering !== null
      || context.commercial_state.selected_offering_code !== null
      || (context.catalog.resolution === 'ambiguous'
        && context.catalog.candidate_offerings.length > 0)
      || mentionsCatalogInterest(context, text)
      || Boolean(input.proposed_course_reference?.trim());
    return nameKnown && needKnown
      ? { offer_required: true, offer_allowed: true, reason: 'FIRST_OFFER_DUE', customer_signal: customerSignal }
      : { offer_required: false, offer_allowed: false, reason: 'FIRST_NAME_OR_NEED_MISSING', customer_signal: customerSignal };
  }

  if (customerSignal === 'direct_purchase') {
    return { offer_required: false, offer_allowed: false, reason: 'DIRECT_PURCHASE', customer_signal: customerSignal };
  }
  if (customerSignal === 'chat_preference') {
    return { offer_required: false, offer_allowed: false, reason: 'SOFT_CHAT_PREFERENCE_THIS_TURN', customer_signal: customerSignal };
  }
  if (priceObjection(text)) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_PRICE_OBJECTION', customer_signal: customerSignal };
  }
  if (severalQuestions(context, text)) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_MULTIPLE_QUESTIONS', customer_signal: customerSignal };
  }
  if (indecision(text)) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_INDECISION', customer_signal: customerSignal };
  }
  if (detailsRequest(text)) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_DETAILS_REQUEST', customer_signal: customerSignal };
  }
  if (prepaymentFriction(text)) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_PREPAYMENT_FRICTION', customer_signal: customerSignal };
  }
  if (
    context.commercial_state.selected_payment_plan !== null
    && (context.capabilities.intake_missing?.length ?? 0) > 0
    || asksForMissingIntake(context, input.response_messages ?? [])
  ) {
    return { offer_required: true, offer_allowed: true, reason: 'SECOND_BEFORE_FINAL_DATA', customer_signal: customerSignal };
  }
  return { offer_required: false, offer_allowed: false, reason: 'SECOND_NOT_YET_DUE', customer_signal: customerSignal };
}
