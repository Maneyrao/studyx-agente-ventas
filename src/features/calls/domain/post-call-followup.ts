import type { CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from './call-state';

/**
 * Spec 007 — el mensaje de cierre lo arma el backend con reglas fijas, nunca
 * el modelo. Determinístico y auditable: mismo (status, result) siempre
 * produce el mismo texto versionado.
 *
 * `null` significa "no corresponde emitir mensaje" — son verdictos válidos,
 * no errores (cancelled, no_contactar, sin turno de WhatsApp resoluble).
 */

export const POST_CALL_FOLLOWUP_PROMPT_VERSION = 'post-call-followup-v1';

export type PostCallFollowupVerdict =
  | { readonly action: 'send'; readonly content: string; readonly reason: string }
  | { readonly action: 'revoke_contact'; readonly reason: string }
  | { readonly action: 'skip'; readonly reason: string };

const RETRY_OFFER =
  'Che, recién intentamos llamarte pero no pudimos comunicarnos. ¿Querés que lo intentemos de nuevo en otro horario, o preferís que sigamos por acá?';

const NEUTRAL_CONTINUITY =
  'Hola, ¿cómo quedaste después de la llamada? Contame si te sirvió o si te quedó alguna duda.';

function saleFollowup(): string {
  return 'Buenísimo que hayamos podido cerrar en la llamada. Cualquier cosa que necesites de acá en más, escribime.';
}

function paymentPendingFollowup(): string {
  return 'Te dejé el link de pago en la llamada — cuando puedas completarlo avisame así seguimos. Sin apuro, cualquier duda me escribís.';
}

function scheduledFollowup(): string {
  return 'Quedamos así como charlamos en la llamada. Cualquier cosa antes de esa fecha, estoy por acá.';
}

function politeCloseFollowup(): string {
  return 'Gracias por el tiempo en la llamada. Quedo por acá si en algún momento te interesa retomarlo.';
}

function neutralNoClaimFollowup(): string {
  return 'Gracias por el tiempo en la llamada. Cualquier cosa que necesites, escribime por acá.';
}

/**
 * `paymentVerified` llega del sistema de pagos (canonical), nunca del
 * análisis de la llamada — el resultado que reporta Retell/el simulador no es
 * evidencia de pago. Si `venta_confirmada` no tiene pago verificado todavía,
 * se degrada a group de seguimiento de pago, nunca se afirma una venta que el
 * sistema no puede probar.
 */
export function decidePostCallFollowup(input: {
  readonly status: CallStatus;
  readonly result: CallResult | null;
  readonly analysisStatus: 'pending' | 'completed' | 'failed';
  readonly paymentVerified: boolean;
}): PostCallFollowupVerdict {
  const { status, result, analysisStatus, paymentVerified } = input;

  if (status === 'cancelled') {
    return { action: 'skip', reason: 'CALL_CANCELLED' };
  }

  if (status === 'no_answer' || status === 'timed_out' || status === 'failed') {
    return { action: 'send', content: RETRY_OFFER, reason: `CALL_${status.toUpperCase()}` };
  }

  if (status !== 'completed') {
    // in_progress, requested, dispatching, provider_accepted, dispatch_ambiguous:
    // no es terminal, el reconciliador no debería haber seleccionado esta fila.
    return { action: 'skip', reason: 'CALL_NOT_TERMINAL' };
  }

  if (analysisStatus !== 'completed' || result === null) {
    return { action: 'send', content: NEUTRAL_CONTINUITY, reason: 'ANALYSIS_UNAVAILABLE' };
  }

  switch (result) {
    case 'venta_confirmada':
      return paymentVerified
        ? { action: 'send', content: saleFollowup(), reason: 'SALE_CONFIRMED_PAYMENT_VERIFIED' }
        : { action: 'send', content: paymentPendingFollowup(), reason: 'SALE_CLAIMED_PAYMENT_UNVERIFIED' };
    case 'link_enviado_sin_pago':
      return { action: 'send', content: paymentPendingFollowup(), reason: 'PAYMENT_LINK_SENT' };
    case 'seguimiento_agendado':
      return { action: 'send', content: scheduledFollowup(), reason: 'FOLLOWUP_SCHEDULED' };
    case 'no_interesado':
      return { action: 'send', content: politeCloseFollowup(), reason: 'NOT_INTERESTED' };
    case 'no_contactar':
      return { action: 'revoke_contact', reason: 'DO_NOT_CONTACT' };
    case 'derivado_humano':
      // Spec 005: el handoff humano sigue apagado. El cierre es neutral y no
      // promete una derivación que el sistema no puede cumplir hoy.
      return { action: 'send', content: neutralNoClaimFollowup(), reason: 'HUMAN_HANDOFF_REQUESTED_DISABLED' };
    case 'ya_es_alumno':
    case 'no_calificado':
    case 'no_es_buen_momento':
      return { action: 'send', content: neutralNoClaimFollowup(), reason: `NEUTRAL_${result.toUpperCase()}` };
    default:
      return { action: 'send', content: NEUTRAL_CONTINUITY, reason: 'UNKNOWN_RESULT' };
  }
}
