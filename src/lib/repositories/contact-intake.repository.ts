import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import { commercialIntakeFromContactRowV1 } from '@/lib/heuristics/contact-identity';
import type { ContactIntakeV1 } from '@/features/conversation/domain/conversation-planner';
import { contactProfileValuesV1, isAgentOwnedContactProfileV1, type StoredContactProfileV1 } from './contact-profile.repository';

/**
 * Owned profiles expose independent fields, including partial and retracted
 * values. Legacy contacts retain their existing compatibility projection.
 */
export async function loadContactIntakeV1(
  contactId: string,
  db: DbClient = orchestratorSql,
): Promise<ContactIntakeV1> {
  const rows = await db<Array<{
    phone: string;
    declared_phone: string | null;
    name: string | null;
    email: string | null;
    contact_profile_v1: StoredContactProfileV1 | null;
  }>>`
    SELECT phone, declared_phone, name, email, contact_profile_v1
    FROM contacts
    WHERE id = ${contactId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (isAgentOwnedContactProfileV1(row?.contact_profile_v1)) return contactProfileValuesV1(row.contact_profile_v1);
  return commercialIntakeFromContactRowV1(row ?? null);
}
