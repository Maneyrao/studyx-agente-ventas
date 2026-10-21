import type { AgentAContextV1 } from '../../schemas/agent-a-brain';

export type SalesObjectionTurnKindV1 =
  | 'none'
  | 'price_objection'
  | 'repeated_price_objection';

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

export function evaluateSalesObjectionTurnV1(
  context: AgentAContextV1,
): { readonly kind: SalesObjectionTurnKindV1 } {
  const current = context.turn.batch_messages.map((message) => message.text).join('\n');
  if (!isPriceObjectionTextV1(current)) return { kind: 'none' };

  const priorPriceObjection = context.turn.recent_turns.some((turn) => (
    turn.direction === 'inbound' && isPriceObjectionTextV1(turn.content)
  ));
  return { kind: priorPriceObjection ? 'repeated_price_objection' : 'price_objection' };
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
  return concreteDiagnosticQuestion || (conditionalValueConnection && !vagueConditionalTarget);
}
