import type { DbClient } from '@/lib/db/types';
import { extractDeclaredPhones, isCallablePhoneE164V1 } from '@/lib/heuristics/contact-identity';
import { isAgentOwnedContactProfileV1, isContactProfileSourceStaleV1, type StoredContactProfileV1 } from './contact-profile.repository';
import { jsonbParam } from '@/lib/db/json';
import { withSerializableTransactionOn } from '@/lib/db/transaction';

/** The model interprets confirmation. PostgreSQL proves the number belonged
 * to the immediately preceding, delivered reply and extends the customer's
 * own local number. No country inference or conversational classification. */
export async function confirmDeliveredContactPhone(input: {
  turnId: string;
  phone: string;
}, db: DbClient): Promise<boolean> {
  if ('begin' in db) return withSerializableTransactionOn(db, tx => confirmDeliveredContactPhone(input, tx));
  if (!isCallablePhoneE164V1(input.phone)) return false;
  // Intake may already have captured the complete number from this inbound
  // message. Repeating that durable fact is a no-op, not a new confirmation
  // requiring a previous assistant suggestion. Never invent provenance.
  const [recorded] = await db<Array<{ contact_id: string; conversation_id: string; conversation_seq: string | number | null;
    content: string; declared_phone: string | null; contact_profile_v1: StoredContactProfileV1 | null }>>`
    SELECT current.contact_id, current.conversation_id, current.conversation_seq, current.content,
      contact.declared_phone, contact.contact_profile_v1 FROM messages current
    JOIN contacts contact ON contact.id = current.contact_id
    WHERE current.id = ${input.turnId}::uuid AND current.direction = 'inbound' AND contact.deleted_at IS NULL
    FOR UPDATE OF contact
  `;
  if (!recorded) return false;
  const profile = isAgentOwnedContactProfileV1(recorded.contact_profile_v1) ? recorded.contact_profile_v1 : null;
  if (profile) {
    if (profile.fields.telefono.value === input.phone) return true;
    if (recorded.conversation_seq === null || await isContactProfileSourceStaleV1(db, {
      contactId: recorded.contact_id, current: profile.fields.telefono,
      source: { id: input.turnId, conversation_id: recorded.conversation_id, conversation_seq: Number(recorded.conversation_seq) },
    }) || profile.fields.telefono.status === 'retracted' && profile.fields.telefono.source_message_id === input.turnId) return false;
  } else if (recorded.declared_phone === input.phone) return true;
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
  if (!source) return false;
  const declared = source.declared_phone?.replace(/\D/gu, '') ?? '';
  let numberEvidence: { id: string; content: string } | undefined;
  if (profile) {
    // Literal number provenance survives retirement of semantic ingestion.
    // A chooses what the customer confirms; this only proves the supplied
    // suffix predates the exact delivered full-number suggestion.
    const priorNumbers = await db<Array<{ id: string; content: string }>>`
      SELECT supplied.id, supplied.content FROM messages supplied JOIN messages suggestion ON suggestion.id = ${source.id}::uuid
      WHERE supplied.contact_id = ${recorded.contact_id}::uuid AND supplied.conversation_id = ${recorded.conversation_id}::uuid
        AND supplied.direction = 'inbound' AND supplied.created_at < suggestion.created_at
        AND supplied.conversation_seq < ${Number(recorded.conversation_seq)}
        AND COALESCE(supplied.metadata->>'message_type', 'text') <> 'unsupported'
      ORDER BY supplied.conversation_seq DESC LIMIT 32
    `;
    numberEvidence = priorNumbers.find(message => extractDeclaredPhones(message.content)
      .some(number => input.phone.endsWith(number.replace(/\D/gu, ''))));
    // A corrected known number: the customer wrote the changed tail ("termina
    // en 8"), saw the complete candidate in the delivered reply and confirmed
    // it. Only the last four digits may change; country and area stay those of
    // the callable number already on the profile.
    const known = profile.fields.telefono.status === 'retracted' ? null : profile.fields.telefono.value;
    let correctionEvidence: { id: string; content: string } | undefined;
    if (!numberEvidence && known !== null && known !== input.phone && isCallablePhoneE164V1(known)
      && known.length === input.phone.length && known.slice(0, -4) === input.phone.slice(0, -4)) {
      let firstChanged = 0;
      while (known[firstChanged] === input.phone[firstChanged]) firstChanged += 1;
      const changedTail = input.phone.slice(firstChanged);
      correctionEvidence = priorNumbers.find(message => (message.content.match(/\d+/gu) ?? [])
        .some(run => run.length >= changedTail.length && input.phone.endsWith(run)));
    }
    if (!numberEvidence && !correctionEvidence && (declared.length < 8 || !input.phone.endsWith(declared))) return false;
    const evidenceKind = correctionEvidence && !(declared.length >= 8 && input.phone.endsWith(declared))
      ? 'delivered_phone_correction_v1' as const : 'delivered_phone_confirmation_v1' as const;
    numberEvidence ??= correctionEvidence;
    const nextProfile = structuredClone(profile);
    nextProfile.version += 1;
    nextProfile.fields.telefono = { value: input.phone, status: 'confirmed', source: 'legacy',
      source_message_id: input.turnId, source_conversation_id: recorded.conversation_id,
      source_quote: recorded.content, source_seq: Number(recorded.conversation_seq), version: nextProfile.version,
      confirmation_evidence: { kind: evidenceKind, suggested_message_id: source.id,
        suggested_quote: source.content, local_phone_message_id: numberEvidence?.id ?? null,
        local_phone_quote: numberEvidence?.content ?? null } };
    await db`UPDATE contacts SET contact_profile_v1 = ${jsonbParam(db, nextProfile)},
      declared_phone = ${input.phone}, updated_at = now() WHERE id = ${source.contact_id}::uuid`;
  } else {
    if (declared.length < 8 || !input.phone.endsWith(declared)) return false;
    await db`UPDATE contacts SET declared_phone = ${input.phone}, updated_at = now()
      WHERE id = ${source.contact_id}::uuid AND contact_profile_v1 IS NULL`;
  }
  await db`UPDATE messages SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmed_phone_v1',
    jsonb_build_object('phone', ${input.phone}::text, 'source_message_id', ${source.id}::text))
    WHERE id = ${input.turnId}::uuid`;
  return true;
}
