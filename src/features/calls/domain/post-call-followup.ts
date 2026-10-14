import type { CallEndReason, CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from './call-state';

/**
 * Spec 007 — the orchestrator decides whether a post-call turn is allowed and
 * which verified situation it represents.  It does not decide the sales
 * conversation. The structured brief is passed to Agent A, which authors the
 * proactive message using the same identity and canonical prompt as chat.
 */

export const POST_CALL_FOLLOWUP_PROMPT_VERSION = 'post-call-followup-v3';

export type PostCallFollowupScenario =
  | 'no_answer'
  | 'voicemail'
  | 'call_interrupted'
  | 'temporarily_unavailable'
  | 'analysis_unavailable'
  | 'payment_verified'
  | 'payment_pending'
  | 'followup_scheduled'
  | 'not_interested'
  | 'human_handoff_unavailable'
  | 'neutral_after_call';

export type PostCallFollowupObjective =
  | 'recover_call_or_continue_chat'
  | 'continue_chat'
  | 'continue_payment'
  | 'confirm_verified_sale'
  | 'honor_scheduled_followup'
  | 'close_respectfully';

export type PostCallFollowupNextStep =
  | 'retry_call'
  | 'retry_call_later'
  | 'continue_chat'
  | 'complete_payment'
  | 'await_human_verification'
  | 'await_team_access'
  | 'honor_scheduled_followup'
  | 'close_conversation';

export interface PostCallFollowupBriefV1 {
  readonly schema_version: 1;
  readonly scenario: PostCallFollowupScenario;
  readonly objective: PostCallFollowupObjective;
  readonly payment_state: 'not_applicable' | 'reported_or_pending' | 'verified';
  readonly allowed_next_steps: readonly PostCallFollowupNextStep[];
}

export type PostCallFollowupVerdict =
  | { readonly action: 'send'; readonly brief: PostCallFollowupBriefV1; readonly reason: string }
  | { readonly action: 'revoke_contact'; readonly reason: string }
  | { readonly action: 'skip'; readonly reason: string };

function brief(
  scenario: PostCallFollowupScenario,
  objective: PostCallFollowupObjective,
  paymentState: PostCallFollowupBriefV1['payment_state'],
  allowedNextSteps: readonly PostCallFollowupNextStep[],
): PostCallFollowupBriefV1 {
  return {
    schema_version: 1,
    scenario,
    objective,
    payment_state: paymentState,
    allowed_next_steps: allowedNextSteps,
  };
}

/**
 * `paymentVerified` is canonical payment evidence, never a claim extracted
 * from the call.  A reported payment without verification therefore stays in
 * the pending path.
 */
export function decidePostCallFollowup(input: {
  readonly status: CallStatus;
  readonly result: CallResult | null;
  readonly analysisStatus: 'pending' | 'completed' | 'failed';
  readonly paymentVerified: boolean;
  readonly doNotContact?: boolean;
  readonly endReason?: CallEndReason | null;
}): PostCallFollowupVerdict {
  const {
    status, result, analysisStatus, paymentVerified, doNotContact = false,
    endReason = null,
  } = input;

  if (doNotContact) return { action: 'revoke_contact', reason: 'DO_NOT_CONTACT' };
  if (status === 'cancelled') return { action: 'skip', reason: 'CALL_CANCELLED' };

  if (status === 'no_answer') {
    return {
      action: 'send',
      brief: brief('no_answer', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call', 'continue_chat']),
      reason: 'CALL_NO_ANSWER',
    };
  }

  if (status === 'timed_out') {
    return {
      action: 'send',
      brief: brief('call_interrupted', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call', 'continue_chat']),
      reason: 'CALL_TIMED_OUT',
    };
  }

  if (status === 'failed') {
    return {
      action: 'send',
      brief: brief('temporarily_unavailable', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call_later', 'continue_chat']),
      reason: `CALL_${status.toUpperCase()}`,
    };
  }

  if (status !== 'completed') return { action: 'skip', reason: 'CALL_NOT_TERMINAL' };

  if (analysisStatus !== 'completed' || result === null) {
    if (endReason === 'user_hangup') {
      return {
        action: 'send',
        brief: brief('call_interrupted', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call', 'continue_chat']),
        reason: 'CALL_ENDED_BY_CONTACT_WITHOUT_ANALYSIS',
      };
    }
    return {
      action: 'send',
      brief: brief('analysis_unavailable', 'continue_chat', 'not_applicable', ['continue_chat']),
      reason: 'ANALYSIS_UNAVAILABLE',
    };
  }

  switch (result) {
    case 'venta_confirmada':
      return paymentVerified
        ? {
          action: 'send',
          brief: brief('payment_verified', 'confirm_verified_sale', 'verified', ['await_team_access']),
          reason: 'SALE_CONFIRMED_PAYMENT_VERIFIED',
        }
        : {
          action: 'send',
          brief: brief('payment_pending', 'continue_payment', 'reported_or_pending', ['complete_payment', 'await_human_verification']),
          reason: 'SALE_CLAIMED_PAYMENT_UNVERIFIED',
        };
    case 'link_enviado_sin_pago':
      return {
        action: 'send',
        brief: brief('payment_pending', 'continue_payment', 'reported_or_pending', ['complete_payment', 'await_human_verification']),
        reason: 'PAYMENT_LINK_SENT',
      };
    case 'seguimiento_agendado':
      return {
        action: 'send',
        brief: brief('followup_scheduled', 'honor_scheduled_followup', 'not_applicable', ['honor_scheduled_followup', 'continue_chat']),
        reason: 'FOLLOWUP_SCHEDULED',
      };
    case 'no_interesado':
      return {
        action: 'send',
        brief: brief('not_interested', 'close_respectfully', 'not_applicable', ['close_conversation']),
        reason: 'NOT_INTERESTED',
      };
    case 'no_contactar':
      return { action: 'revoke_contact', reason: 'DO_NOT_CONTACT' };
    case 'derivado_humano':
      return {
        action: 'send',
        brief: brief('human_handoff_unavailable', 'continue_chat', 'not_applicable', ['continue_chat']),
        reason: 'HUMAN_HANDOFF_REQUESTED_DISABLED',
      };
    case 'buzon_de_voz':
      return {
        action: 'send',
        brief: brief('voicemail', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call', 'continue_chat']),
        reason: 'VOICEMAIL_OUTCOME',
      };
    case 'corto_la_llamada':
      return {
        action: 'send',
        brief: brief('call_interrupted', 'recover_call_or_continue_chat', 'not_applicable', ['retry_call', 'continue_chat']),
        reason: 'CALL_ENDED_BY_CONTACT',
      };
    case 'ya_es_alumno':
    case 'no_calificado':
    case 'no_es_buen_momento':
      return {
        action: 'send',
        brief: brief('neutral_after_call', 'close_respectfully', 'not_applicable', ['continue_chat', 'close_conversation']),
        reason: `NEUTRAL_${result.toUpperCase()}`,
      };
  }
}
