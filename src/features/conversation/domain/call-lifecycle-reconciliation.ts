import type { ConversationStateV1 } from './conversation-pipeline';

export interface CallLifecycleFactsV1 {
  readonly active_call: { readonly call_id: string; readonly status: string } | null;
  readonly last_call_result: {
    readonly call_id: string;
    readonly result: string | null;
    readonly ended_at: string;
  } | null;
}

export interface CallLifecycleReconciliationInputV1 {
  readonly current_customer_signal?:
    | 'direct_call_request'
    | 'call_acceptance'
    | 'call_decline'
    | 'opt_out'
    | 'model_required';
  readonly current_customer_resumes_commercial_flow?: boolean;
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Positive evidence that the customer left a terminal-call retry checkpoint
 * and resumed the sale in chat. Generic text is deliberately false: an email,
 * thanks or another availability reply must not consume live call consent.
 */
export function customerResumesCommercialFlowAfterCallV1(
  messages: readonly string[],
): boolean {
  const text = normalized(messages.join('\n'));
  return /\b(?:mandame|enviame|pasame|compartime)\s+(?:el\s+)?(?:link|enlace)\b/u.test(text)
    || /\b(?:quiero|voy\s+a|listo\s+para|decidi)\b[^.!?\n]{0,40}\b(?:comprar|pagar|inscribirme|anotarme|avanzar)\b/u.test(text)
    || /\b(?:car[oa]|costos[oa]|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza|no\s+llego|se\s+me\s+va|much[oa]\s+dinero|vale\s+la\s+pena)\b/u.test(text)
    || /\b(?:precio|cuotas?|planes?\s+de\s+pago|formas?\s+de\s+pago|que\s+incluye|temario|contenidos?|beneficios?)\b/u.test(text)
    || /\bcuanto\b[^.!?\n]{0,32}\b(?:cuesta|sale|vale|curso|plan|cuota|pago)\b/u.test(text)
    || /\b(?:quiero|me\s+interesa)\b[^.!?\n]{0,48}\b(?:curso|estudiar|aprender)\b/u.test(text);
}

export function reconcileTerminalCallStateV1(
  state: ConversationStateV1,
  facts: CallLifecycleFactsV1,
  input?: CallLifecycleReconciliationInputV1,
): ConversationStateV1 {
  const currentConfirmsCall = input?.current_customer_signal === 'call_acceptance'
    || input?.current_customer_signal === 'direct_call_request';
  const releasesPendingCallReply = state.awaiting_reply === 'call_or_chat'
    && !currentConfirmsCall
    && (
      input?.current_customer_signal === 'call_decline'
      || input?.current_customer_signal === 'opt_out'
      || input?.current_customer_resumes_commercial_flow === true
    );
  const preservesCommercialCheckpoint = (
    state.awaiting_reply === 'payment_confirmation'
    || state.awaiting_reply === 'contact_details'
  ) && !currentConfirmsCall
    && input?.current_customer_resumes_commercial_flow === true;
  const canReleasePendingReply = state.awaiting_reply === 'none'
    || releasesPendingCallReply
    || preservesCommercialCheckpoint;
  const completedCallOwnsAcceptedState = facts.active_call === null
    && facts.last_call_result !== null
    && state.call_preference === 'call'
    && state.call_offer_status === 'accepted'
    && canReleasePendingReply
    && state.stage !== 'payment_link_sent'
    && state.stage !== 'closed';
  if (!completedCallOwnsAcceptedState) return state;

  const resumedStage = state.stage === 'handoff'
    ? state.selected_payment_plan !== null
      ? 'plan_selected' as const
      : state.selected_offering_code !== null
        ? 'course_selected' as const
        : 'exploring' as const
    : state.stage;

  return {
    ...state,
    stage: resumedStage,
    call_preference: 'unknown',
    call_offer_status: 'not_offered',
    // A direct request does not spend the proactive invitation budget. A call
    // born from an offer keeps its count, so the lifetime ceiling stays at two.
    call_offer_count: state.call_offer_count,
    awaiting_reply: preservesCommercialCheckpoint ? state.awaiting_reply : 'none',
  };
}
