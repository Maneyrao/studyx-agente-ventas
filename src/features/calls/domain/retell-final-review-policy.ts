export interface RetellSheetsTarget {
  readonly spreadsheetId: string;
  readonly tabName: string;
}

/** Global Sheets configuration is only valid for its explicitly bound workspace. */
export function resolveRetellProjectionTarget(input: {
  readonly configuredWorkspaceSlug: string | null;
  readonly canonicalWorkspaceSlug: string;
  readonly globalSheets: RetellSheetsTarget | null;
  readonly existingProjection: RetellSheetsTarget | null;
}): RetellSheetsTarget | null {
  if (input.globalSheets && input.configuredWorkspaceSlug === input.canonicalWorkspaceSlug) {
    return input.globalSheets;
  }
  return input.existingProjection;
}

/** Test/fake payment providers must never be wired to live Retell outbound. */
export function retellPaymentProviderCanWireLiveOutbound(
  provider: string,
): provider is 'stripe_live' {
  return provider === 'stripe_live';
}
