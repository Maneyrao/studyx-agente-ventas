/**
 * Sandbox lock — nothing with real-world side effects may run against a contact
 * that has a row in `sandbox_identities`. Cover for anything that would move
 * money, place a call, send a message to an external network, or write to a
 * production spreadsheet / email inbox.
 *
 * The check lives in one place so that any provider adapter can call it with
 * the same guarantees. Real-side-effect providers wired later (Stripe, Retell,
 * WhatsApp outbound, Google Sheets) MUST call `assertRealSideEffectAllowed`
 * before invoking the external system.
 */

export const RealSideEffectRejectionCode = 'CONTACT_IS_SANDBOX' as const;

export class RealSideEffectRejectedError extends Error {
  readonly code = RealSideEffectRejectionCode;

  constructor(
    readonly contactId: string,
    readonly provider: string,
    readonly attemptedEffect: string,
  ) {
    super(
      `Real side effect ${attemptedEffect} rejected on sandbox contact ${contactId} (provider=${provider}).`,
    );
    this.name = 'RealSideEffectRejectedError';
  }
}

/**
 * A tiny lookup port so the pure decision logic can be unit-tested without a DB.
 * The production wiring is a Postgres query against `sandbox_identities`.
 */
export type SandboxLookup = {
  /**
   * Returns null when the contact has no sandbox row, otherwise the provider
   * string (e.g. `'telegram_sandbox'`).
   */
  findSandboxProvider(contactId: string): Promise<string | null>;
};

export type RealSideEffectAttempt = {
  contactId: string;
  effect: string;
};

/**
 * Throws `RealSideEffectRejectedError` when the contact is sandbox. Returns
 * silently otherwise. Callers should await this immediately before invoking
 * the external provider.
 */
export async function assertRealSideEffectAllowed(
  lookup: SandboxLookup,
  attempt: RealSideEffectAttempt,
): Promise<void> {
  const provider = await lookup.findSandboxProvider(attempt.contactId);
  if (provider !== null) {
    throw new RealSideEffectRejectedError(attempt.contactId, provider, attempt.effect);
  }
}

/**
 * Non-throwing variant. Handy for pre-flight decisions like refusing to enqueue
 * an outbound before even reserving state.
 */
export async function isSandboxContact(
  lookup: SandboxLookup,
  contactId: string,
): Promise<boolean> {
  return (await lookup.findSandboxProvider(contactId)) !== null;
}
