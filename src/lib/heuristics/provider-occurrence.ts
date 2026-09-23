const MAX_PROVIDER_PAST_SKEW_MS = 5 * 60 * 1000;
const MAX_PROVIDER_FUTURE_SKEW_MS = 2 * 60 * 1000;

export interface ProviderOccurrenceV1 {
  readonly provider_occurred_at: string;
  readonly occurred_at: string;
  readonly occurred_at_trusted: boolean;
}

export function resolveProviderOccurrenceV1(input: {
  readonly providerOccurredAt: string;
  readonly receivedAt: string;
}): ProviderOccurrenceV1 {
  const providerMs = Date.parse(input.providerOccurredAt);
  const receivedMs = Date.parse(input.receivedAt);
  const trusted = Number.isFinite(providerMs)
    && Number.isFinite(receivedMs)
    && providerMs >= receivedMs - MAX_PROVIDER_PAST_SKEW_MS
    && providerMs <= receivedMs + MAX_PROVIDER_FUTURE_SKEW_MS;

  return {
    provider_occurred_at: input.providerOccurredAt,
    occurred_at: trusted ? new Date(providerMs).toISOString() : new Date(receivedMs).toISOString(),
    occurred_at_trusted: trusted,
  };
}
