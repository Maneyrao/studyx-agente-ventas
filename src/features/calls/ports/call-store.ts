import type { CallEvent } from '@/lib/contracts/call-event';
import type { CallContextV1 } from '../domain/call-context';
import type { CallProjection, CallStatus } from '../domain/call-state';

export interface DispatchableCall {
  id: string;
  phoneE164: string;
  status: CallStatus;
  providerCallId: string | null;
  requestIdempotencyKey: string;
  context: CallContextV1;
}

export type DispatchClaim =
  | { outcome: 'claimed'; call: DispatchableCall }
  | { outcome: 'provider_accepted'; providerCallId: string }
  | { outcome: 'dispatch_ambiguous' | 'failed' | 'busy'; providerCallId: null };

export interface CallStore {
  claimDispatch(callId: string, workerId: string): Promise<DispatchClaim>;
  attachProviderCall(callId: string, providerCallId: string, acceptedAt: string): Promise<void>;
  markDispatchAmbiguous(callId: string, errorCode: string): Promise<void>;
  markDispatchFailed(callId: string, errorCode: string): Promise<void>;
  appendEvent(event: CallEvent): Promise<'recorded' | 'duplicate'>;
  recomputeProjection(callId: string): Promise<CallProjection>;
}
