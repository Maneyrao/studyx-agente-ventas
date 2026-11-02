import type { DbClient } from '@/lib/db/types';
import { isCentralCargaBonusEnabledForContact, type CentralCargaBonusConfig } from './config';

type ContactScope = { readonly contactId: string } & (
  | { readonly workspaceId: string; readonly workspaceSlug?: never }
  | { readonly workspaceSlug: string; readonly workspaceId?: never }
);

/** Only the stored transport identity can grant a phone-scoped test permission.
 * Never use profile updates, declared_phone, model output or caller-supplied phone.
 */
export async function isCentralCargaBonusEnabledForStoredContact(
  config: CentralCargaBonusConfig, scope: ContactScope, db: DbClient,
): Promise<boolean> {
  if (isCentralCargaBonusEnabledForContact(config, scope.contactId)) return true;
  if (!config.canaryPhoneE164s?.length) return false;
  const [contact] = await db<Array<{ phone: string }>>`
    SELECT c.phone FROM contacts c
    JOIN workspace_contacts wc ON wc.contact_id=c.id
    JOIN workspaces w ON w.id=wc.workspace_id
    WHERE c.id=${scope.contactId}::uuid AND c.deleted_at IS NULL AND w.status='active'
      AND ((${scope.workspaceId ?? null}::uuid IS NOT NULL AND w.id=${scope.workspaceId ?? null}::uuid)
        OR (${scope.workspaceSlug ?? null}::text IS NOT NULL AND w.slug=${scope.workspaceSlug ?? null}))
    LIMIT 1 FOR SHARE OF c,wc`;
  return contact !== undefined && isCentralCargaBonusEnabledForContact(config, scope.contactId, contact.phone);
}
