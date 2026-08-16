import type { CallEvent, CallResult } from '@/lib/contracts/call-event';

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
        status = started ? 'completed' : 'failed';
    }
  } else if (started) {
    status = 'in_progress';
  } else {
    status = input.providerAccepted ? 'provider_accepted' : 'requested';
  }

  return { status, ...projectAnalysis(input.events) };
}

function projectAnalysis(events: readonly CallEvent[]): Pick<CallProjection, 'analysisStatus' | 'result'> {
  const analyzed = events
    .filter((event) => event.event_type === 'analyzed')
    .map((event) => event.payload)
    .find((payload) => payload.event_type === 'analyzed');
  return analyzed
    ? { analysisStatus: 'completed', result: analyzed.analysis.result }
    : { analysisStatus: 'pending', result: null };
}
