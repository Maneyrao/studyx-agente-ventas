import type { DbClient } from '@/lib/db/types';
import { extractDeclaredPhones } from '@/lib/heuristics/contact-identity';

/**
 * A number the agent proposed in a delivered reply, since the profile phone
 * last changed, and the customer has not confirmed: never dial the questioned
 * number (2026-11-05, 5b138536: «termina en 8» → called 4497). Only a
 * correction of the number on file counts: same 8-digit local block except its
 * last 4 digits, so amounts or other contact numbers never count.
 */
export async function hasPendingPhoneCorrectionV1(db: DbClient, input: {
  readonly latest_message_id: string;
  readonly call_phone: string;
}): Promise<boolean> {
  const replies = await db<Array<{ content: string }>>`
    SELECT reply.content FROM messages current
    JOIN contacts contact ON contact.id = current.contact_id
    JOIN messages reply ON reply.conversation_id = current.conversation_id
      AND reply.contact_id = current.contact_id AND reply.direction = 'outbound'
      AND reply.created_at < current.created_at
    JOIN outbound_deliveries delivery ON delivery.message_id = reply.id
      AND delivery.state IN ('submitted', 'delivered')
    LEFT JOIN messages phone_source ON phone_source.id::text = contact.contact_profile_v1->'fields'->'telefono'->>'source_message_id'
    WHERE current.id = ${input.latest_message_id}::uuid
      AND (phone_source.created_at IS NULL OR reply.created_at > phone_source.created_at)
    ORDER BY reply.created_at DESC, reply.id DESC
    LIMIT 8
  `;
  const tail = (phone: string) => phone.replace(/\D/gu, '').slice(-8);
  const callTail = tail(input.call_phone);
  if (callTail.length !== 8) return false;
  return replies.some((reply) => extractDeclaredPhones(reply.content).some((phone) => {
    const candidate = tail(phone);
    return candidate.length === 8 && candidate !== callTail && candidate.slice(0, 4) === callTail.slice(0, 4);
  }));
}
