export type RetellCorrelationMetadata = {
  readonly internalCallId: string;
  readonly contactId: string;
  readonly conversationId: string;
};

export type RetellCorrelationErrorCode =
  | 'CALL_CORRELATION_NOT_FOUND'
  | 'CALL_CORRELATION_MISMATCH'
  | 'CALL_PROVIDER_ID_CONFLICT'
  | 'CALL_CORRELATION_STATE_INVALID';

export class RetellCallCorrelationError extends Error {
  constructor(readonly code: RetellCorrelationErrorCode) {
    super(code);
    this.name = 'RetellCallCorrelationError';
  }
}

export interface RetellCallCorrelationStore {
  resolveRetellCall(input: {
    readonly providerCallId: string;
    readonly metadata: RetellCorrelationMetadata | null;
  }): Promise<{ readonly callId: string }>;
}
