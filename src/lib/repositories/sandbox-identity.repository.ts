import type { DbClient } from '@/lib/db/types';
import type { SandboxLookup } from '@/lib/services/sandbox.service';

/**
 * Postgres-backed implementation of `SandboxLookup`. Wire this into the
 * providers (Stripe / Retell / WhatsApp outbound / Sheets) right before they
 * call the external system:
 *
 *   const lookup = createSandboxLookup(db)
 *   await assertRealSideEffectAllowed(lookup, { contactId, effect: 'STRIPE_CHARGE' })
 *   await stripe.charges.create(...)
 */
export function createSandboxLookup(db: DbClient): SandboxLookup {
  return {
    async findSandboxProvider(contactId: string): Promise<string | null> {
      const rows = await db<Array<{ provider: string }>>`
        SELECT provider
        FROM sandbox_identities
        WHERE contact_id = ${contactId}::uuid
        LIMIT 1
      `;
      return rows[0]?.provider ?? null;
    },
  };
}

/**
 * Idempotent registration of a sandbox contact.
 *
 * Called by the ingest pipeline whenever an envelope carries
 * `sandbox_provider = 'telegram_sandbox'` immediately after the contact row
 * has been created (or resolved). Uses `ON CONFLICT DO NOTHING` on the
 * (provider, external_user_id) UNIQUE so redeliveries are safe.
 */
export async function registerSandboxIdentity(
  db: DbClient,
  input: {
    provider: 'telegram_sandbox';
    externalUserId: string;
    contactId: string;
    syntheticPhone: string;
  },
): Promise<void> {
  await db`
    INSERT INTO sandbox_identities (
      provider, external_user_id, contact_id, synthetic_phone
    )
    VALUES (
      ${input.provider},
      ${input.externalUserId},
      ${input.contactId}::uuid,
      ${input.syntheticPhone}
    )
    ON CONFLICT (provider, external_user_id) DO NOTHING
  `;
}
