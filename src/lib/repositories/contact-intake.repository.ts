import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import type { ContactIntakeV1 } from '@/features/conversation/domain/conversation-planner';

/**
 * Reads the frozen six-field commercial contract's identity half from the one
 * place that already owns it: `contacts`. Ingestion captures name and email
 * from the customer's own words before planning runs, so this is a pure read —
 * there is no second identity store and no second capture path.
 *
 * `contacts.name` holds one full name; the operator sheet wants it split, so
 * the same split the projection uses is applied here. A contact that is
 * unknown returns every field null, which the planner reads as incomplete.
 */
export async function loadContactIntakeV1(
  contactId: string,
  db: DbClient = orchestratorSql,
): Promise<ContactIntakeV1> {
  const rows = await db<Array<{ phone: string; name: string | null; email: string | null }>>`
    SELECT phone, name, email
    FROM contacts
    WHERE id = ${contactId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { nombre: null, apellido: null, correo: null, telefono: null };
  const identity = row.name ? splitFullName(row.name) : null;
  return {
    nombre: identity?.nombre || null,
    apellido: identity?.apellido || null,
    correo: row.email,
    telefono: row.phone,
  };
}
