import type { CallStore } from '../ports/call-store';
import {
  AmbiguousVoiceProviderError,
  ConfirmedVoiceProviderError,
  type VoiceProvider,
} from '../ports/voice-provider';

export type DispatchCallResult = {
  status: 'provider_accepted' | 'dispatch_ambiguous' | 'failed' | 'busy';
  providerCallId: string | null;
};

export async function dispatchCall(
  input: { callId: string; workerId: string },
  dependencies: { store: CallStore; provider: VoiceProvider },
): Promise<DispatchCallResult> {
  const claim = await dependencies.store.claimDispatch(input.callId, input.workerId);
  if (claim.outcome !== 'claimed') {
    return {
      status: claim.outcome === 'busy' ? 'busy' : claim.outcome,
      providerCallId: claim.outcome === 'provider_accepted' ? claim.providerCallId : null,
    };
  }

  try {
    const accepted = await dependencies.provider.placeCall({
      callId: claim.call.id,
      phoneE164: claim.call.phoneE164,
      context: claim.call.context,
      idempotencyKey: claim.call.requestIdempotencyKey,
    });
    await dependencies.store.attachProviderCall(claim.call.id, accepted.providerCallId, accepted.acceptedAt);
    return { status: 'provider_accepted', providerCallId: accepted.providerCallId };
  } catch (error) {
    if (error instanceof ConfirmedVoiceProviderError) {
      await dependencies.store.markDispatchFailed(claim.call.id, error.code);
      return { status: 'failed', providerCallId: null };
    }
    const code = error instanceof AmbiguousVoiceProviderError
      ? error.code
      : 'VOICE_PROVIDER_UNKNOWN_OUTCOME';
    await dependencies.store.markDispatchAmbiguous(claim.call.id, code);
    return { status: 'dispatch_ambiguous', providerCallId: null };
  }
}
