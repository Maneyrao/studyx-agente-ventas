import type { DbClient } from '@/lib/db/types';
import { extractDeclaredPhones, isCallablePhoneE164V1 } from '@/lib/heuristics/contact-identity';

/** The model interprets confirmation. PostgreSQL proves the number belonged
 * to the immediately preceding, delivered reply and extends the customer's
 * own local number. No country inference or conversational classification. */
export async function confirmDeliveredContactPhone(input: {
  turnId: string;
  phone: string;
}, db: DbClient): Promise<boolean> {
  if (!isCallablePhoneE164V1(input.phone)) return false;
  const rows = await db<Array<{ id: string; contact_id: string; declared_phone: string | null; content: string }>>`
    SELECT previous.id, current.contact_id, contact.declared_phone, previous.content
    FROM messages current
    JOIN contacts contact ON contact.id = current.contact_id
    JOIN messages previous ON previous.conversation_id = current.conversation_id
      AND previous.contact_id = current.contact_id AND previous.direction = 'outbound'
      AND previous.created_at < current.created_at
    JOIN outbound_deliveries delivery ON delivery.message_id = previous.id
      AND delivery.contact_id = current.contact_id AND delivery.conversation_id = current.conversation_id
      AND delivery.destination = contact.phone
      AND delivery.state IN ('submitted', 'delivered')
      AND NULLIF(btrim(delivery.provider_message_id), '') IS NOT NULL
      AND COALESCE(delivery.submitted_at, delivery.delivered_at) <= current.created_at
    WHERE current.id = ${input.turnId}::uuid AND current.direction = 'inbound'
      AND NOT EXISTS (
        SELECT 1 FROM messages intervening
        WHERE intervening.conversation_id = current.conversation_id
          AND intervening.direction = 'inbound'
          AND intervening.created_at > previous.created_at
          AND intervening.created_at < current.created_at
          AND (current.batch_id IS NULL OR intervening.batch_id IS DISTINCT FROM current.batch_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM messages newer
        WHERE newer.conversation_id = current.conversation_id AND newer.direction = 'outbound'
          AND newer.created_at > previous.created_at AND newer.created_at < current.created_at
          AND newer.in_reply_to IS DISTINCT FROM previous.in_reply_to
      )
    ORDER BY previous.created_at DESC, previous.id DESC
  `;
  const source = rows.find(row => extractDeclaredPhones(row.content).includes(input.phone));
  const declared = source?.declared_phone?.replace(/\D/gu, '') ?? '';
  if (!source || declared.length < 8 || !input.phone.endsWith(declared)) return false;
  await db`UPDATE contacts SET declared_phone = ${input.phone}, updated_at = now()
    WHERE id = ${source.contact_id}::uuid`;
  await db`UPDATE messages SET metadata = metadata || jsonb_build_object('confirmed_phone_v1',
    jsonb_build_object('phone', ${input.phone}::text, 'source_message_id', ${source.id}::text))
    WHERE id = ${input.turnId}::uuid`;
  return true;
}
