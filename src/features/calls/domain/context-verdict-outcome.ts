import type { CallEvent, CallEventProvider } from '@/lib/contracts/call-event';
import type { ContextVerdict } from './context-receipt';

/**
 * El sandbox de Telegram no tiene Retell detrás: no existe un webhook de
 * proveedor que reporte `started` / `ended` / `analyzed`. El único hecho de
 * negocio disponible es el veredicto humano de Bot B sobre el contexto que
 * recibió (correcto/incorrecto, ver `domain/context-receipt.ts`). Esta
 * función traduce ese veredicto — determinísticamente — a los eventos de
 * `call_events` que hacen falta para que el ledger llegue a un estado
 * terminal, que es lo único que el cron post-llamada (`post-call-followup`)
 * sabe recoger.
 *
 * `correct`: Bot B pudo trabajar con el contexto — se simula una llamada que
 * conecta y corre hasta el final (`started` + `ended` con
 * `disconnection_reason: 'user_hangup'`), sin análisis de venta: el cron
 * degrada a un cierre neutro (`ANALYSIS_UNAVAILABLE`).
 *
 * `incorrect`: Bot B no pudo trabajar con el contexto — nunca llega a
 * `started`; sólo `ended` con `disconnection_reason: 'failed_to_connect'`,
 * que proyecta a `failed` y el cron ofrece reintentar.
 *
 * `event_id` es determinista por `call_id` (nunca incluye un nonce o
 * timestamp), así que reintentos del webhook de Telegram — que sí pueden
 * volver a llamar a esta función con el mismo veredicto — producen
 * exactamente los mismos eventos, y `CallStore.appendEvent` los descarta por
 * `ON CONFLICT (provider, event_id) DO NOTHING`.
 */
export function buildVerdictOutcomeEvents(input: {
  callId: string;
  provider: CallEventProvider;
  verdict: ContextVerdict;
  occurredAt: string;
}): CallEvent[] {
  const { callId, provider, verdict, occurredAt } = input;

  const endedBase = {
    schema_version: 1 as const,
    call_id: callId,
    event_type: 'ended' as const,
    occurred_at: occurredAt,
    provider,
  };

  if (verdict === 'incorrect') {
    return [
      {
        ...endedBase,
        event_id: `studyx:ended:${callId}`,
        sequence: 1,
        payload: {
          event_type: 'ended',
          ended_at: occurredAt,
          duration_seconds: 0,
          disconnection_reason: 'failed_to_connect',
        },
      },
    ];
  }

  return [
    {
      schema_version: 1,
      event_id: `studyx:started:${callId}`,
      call_id: callId,
      event_type: 'started',
      sequence: 1,
      occurred_at: occurredAt,
      provider,
      payload: { event_type: 'started', started_at: occurredAt },
    },
    {
      ...endedBase,
      event_id: `studyx:ended:${callId}`,
      sequence: 2,
      payload: {
        event_type: 'ended',
        ended_at: occurredAt,
        duration_seconds: 0,
        disconnection_reason: 'user_hangup',
      },
    },
  ];
}
