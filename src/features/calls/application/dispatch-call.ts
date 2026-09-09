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
  dependencies: { store: CallStore; provider: VoiceProvider; now?: () => Date },
): Promise<DispatchCallResult> {
  const claim = await dependencies.store.claimDispatch(input.callId, input.workerId);
  if (claim.outcome !== 'claimed') {
    if (claim.outcome === 'dispatch_ambiguous') {
      // A prior request may have reached the provider while its response was
      // lost. Reconcile by the stable internal id before allowing any future
      // action; never place a second call merely because the first outcome is
      // unknown. A missing/ambiguous lookup keeps the state conservative and
      // returns promptly for a later bounded reconciliation attempt.
      try {
        const found = await dependencies.provider.findCallByInternalId(input.callId);
        if (found) {
          await dependencies.store.attachProviderCall(
            input.callId,
            found.providerCallId,
            (dependencies.now ?? (() => new Date()))().toISOString(),
          );
          return { status: 'provider_accepted', providerCallId: found.providerCallId };
        }
      } catch {
        // Provider lookup is itself an ambiguous operation. Keep the call
        // fenced; the caller can retry reconciliation without redialling.
      }
    }
    return {
      status: claim.outcome === 'busy' ? 'busy' : claim.outcome,
      providerCallId: claim.outcome === 'provider_accepted' ? claim.providerCallId : null,
    };
  }

  try {
    const accepted = await dependencies.provider.placeCall({
      callId: claim.call.id,
      contactId: claim.call.contactId,
      conversationId: claim.call.conversationId,
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
