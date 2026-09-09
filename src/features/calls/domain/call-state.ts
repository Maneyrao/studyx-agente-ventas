import { CallAnalysisSchema, type CallAnalysis, type CallEvent, type CallResult } from '@/lib/contracts/call-event';

export type CallStatus =
  | 'requested'
  | 'dispatching'
  | 'provider_accepted'
  | 'dispatch_ambiguous'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'timed_out'
  | 'cancelled';

export type AnalysisStatus = 'pending' | 'completed' | 'failed';

export interface CallProjection {
  status: CallStatus;
  analysisStatus: AnalysisStatus;
  result: CallResult | null;
}

/**
 * Retell can report the same call through the tool and the webhook.  Those
 * are two durable facts, not competing last-writer updates.  Webhook data is
 * the authoritative source when both sources provide a field; the tool fills
 * only fields the webhook did not provide.  Sorting by source identity makes
 * this merge independent of delivery/replay order.
 */
export function mergeCallAnalyses(events: readonly CallEvent[]): CallAnalysis {
  const analyzed = events
    .filter((event) => event.event_type === 'analyzed')
    .sort((left, right) => {
      const sourceRank = (event: CallEvent): number => {
        if (event.event_id.startsWith('retell:webhook:')) return 0;
        if (event.event_id.startsWith('retell:call_analyzed:')) return 1;
        if (event.event_id.startsWith('retell:tool:')) return 2;
        return 2;
      };
      return sourceRank(left) - sourceRank(right);
    });
  if (analyzed.length === 0) {
    throw new Error('CALL_ANALYSIS_MISSING');
  }

  const output: Record<string, unknown> = {};
  const keys: readonly (keyof CallAnalysis)[] = [
    'result', 'resultado', 'nivel_interes', 'objecion', 'notas', 'call_summary',
    'user_sentiment', 'curso_ofrecido', 'precio_ofrecido', 'objecion_principal',
    'email_capturado', 'link_pago_enviado', 'pago_confirmado', 'pidio_humano',
    'pidio_no_contactar', 'pregunto_si_es_ia', 'compromiso_pendiente',
  ];
  for (const event of analyzed) {
    const analysis = event.payload as Extract<CallEvent['payload'], { event_type: 'analyzed' }>;
    for (const key of keys) {
      const value = analysis.analysis[key];
      // Nullable legacy fields use null as "not supplied".  A concrete value
      // from the higher-precedence source must survive a replay regardless of
      // which event happened to be inserted first.
      if (value !== undefined && value !== null && output[key] === undefined) {
        output[key] = value;
      }
    }
  }
  // Consent revocation is a monotone safety fact: an explicit opt-out from
  // either durable source cannot be undone by a later/other source saying
  // false.
  if (analyzed.some((event) => (
    event.payload.event_type === 'analyzed'
    && event.payload.analysis.pidio_no_contactar === true
  ))) {
    output.pidio_no_contactar = true;
  }
  return CallAnalysisSchema.parse(output);
}

export function projectCallState(input: {
  providerAccepted: boolean;
  cancelledAt: string | null;
  events: readonly CallEvent[];
}): CallProjection {
  if (input.cancelledAt !== null) {
    return { status: 'cancelled', ...projectAnalysis(input.events) };
  }

  const started = input.events.some((event) => event.event_type === 'started');
  const ended = input.events
    .filter((event) => event.event_type === 'ended')
    .map((event) => event.payload)
    .find((payload) => payload.event_type === 'ended');

  let status: CallStatus;
  if (ended) {
    switch (ended.disconnection_reason) {
      case 'no_answer':
      case 'voicemail':
        status = 'no_answer';
        break;
      case 'timed_out':
        status = 'timed_out';
        break;
      case 'busy':
      case 'failed_to_connect':
        status = 'failed';
        break;
      default:
        status = 'completed';
    }
  } else if (started) {
    status = 'in_progress';
  } else {
    status = input.providerAccepted ? 'provider_accepted' : 'requested';
  }

  return { status, ...projectAnalysis(input.events) };
}

function projectAnalysis(events: readonly CallEvent[]): Pick<CallProjection, 'analysisStatus' | 'result'> {
  const analyzed = events.some((event) => event.event_type === 'analyzed');
  return analyzed
    ? { analysisStatus: 'completed', result: mergeCallAnalyses(events).result }
    : { analysisStatus: 'pending', result: null };
}
