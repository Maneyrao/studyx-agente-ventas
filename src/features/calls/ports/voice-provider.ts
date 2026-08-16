import type { CallContextV1 } from '../domain/call-context';

export interface PlaceVoiceCallInput {
  callId: string;
  phoneE164: string;
  context: CallContextV1;
  idempotencyKey: string;
}

export interface VoiceProvider {
  placeCall(input: PlaceVoiceCallInput): Promise<{ providerCallId: string; acceptedAt: string }>;
  findCallByInternalId(callId: string): Promise<{ providerCallId: string } | null>;
  cancelCall(providerCallId: string): Promise<void>;
}

export class ConfirmedVoiceProviderError extends Error {
  readonly kind = 'confirmed' as const;

  constructor(readonly code: string) {
    super(code);
    this.name = 'ConfirmedVoiceProviderError';
  }
}

export class AmbiguousVoiceProviderError extends Error {
  readonly kind = 'ambiguous' as const;

  constructor(readonly code = 'VOICE_PROVIDER_AMBIGUOUS') {
    super(code);
    this.name = 'AmbiguousVoiceProviderError';
  }
}
