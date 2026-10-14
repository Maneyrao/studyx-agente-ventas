import { z } from 'zod';
import { jsonbParam } from '@/lib/db/json';
import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import { loadContactProfileV1, contactProfileValuesV1 } from './contact-profile.repository';
import { ContactProfileContextV1Schema, ContactProfileRequestV1Schema, type ContactProfileContextV1 } from '@/shared/conversation/contact-profile-contract';

const RequestsSchema = z.array(ContactProfileRequestV1Schema.omit({ message_index: true })).max(4);

/** Evidence is raw physical input. A question is eligible only if accepted before the claimed input arrived. */
export async function loadContactProfileContextV1(input: {
  contactId: string; conversationId: string; batchId: string;
}, db: DbClient = sql): Promise<ContactProfileContextV1 | null> {
  const profile = await loadContactProfileV1(input.contactId, db);
  if (!profile) return null;
  const [bound] = await db<Array<{ max_seq: number; occurred_at: string; provider: string; integration_id: string }>>`
    SELECT max(m.conversation_seq)::integer AS max_seq,
      min(CASE WHEN m.metadata->>'occurred_at_trusted' = 'true'
        THEN (m.metadata->>'occurred_at')::timestamptz ELSE m.created_at END) AS occurred_at,
      e.provider, e.integration_id
    FROM inbound_batches b JOIN messages m ON m.batch_id = b.id AND m.direction = 'inbound'
    JOIN messages representative ON representative.id = b.representative_turn_id
    JOIN channel_events e ON e.id = representative.source_event_id
    WHERE b.id = ${input.batchId}::uuid AND b.contact_id = ${input.contactId}::uuid
      AND b.conversation_id = ${input.conversationId}::uuid
    GROUP BY e.provider, e.integration_id
  `;
  if (!bound) return null;
  const sources = await db<Array<{ id: string; text: string; sequence: number }>>`
    SELECT id, content AS text, conversation_seq::integer AS sequence FROM messages
    WHERE contact_id = ${input.contactId}::uuid AND conversation_id = ${input.conversationId}::uuid
      AND direction = 'inbound' AND conversation_seq <= ${bound.max_seq}
      AND COALESCE(metadata->>'message_type', 'text') <> 'unsupported'
    ORDER BY conversation_seq DESC LIMIT 32
  `;
  const questions = await db<Array<{ message_id: string; requests: unknown; accepted_at: Date | string }>>`
    SELECT m.id AS message_id, m.metadata->'contact_profile_requests_v1' AS requests,
      COALESCE(d.submitted_at, d.delivered_at) AS accepted_at
    FROM messages m JOIN outbound_deliveries d ON d.message_id = m.id
      AND d.contact_id = m.contact_id AND d.conversation_id = m.conversation_id
    JOIN contacts c ON c.id = m.contact_id
    WHERE m.contact_id = ${input.contactId}::uuid AND m.conversation_id = ${input.conversationId}::uuid
      AND m.direction = 'outbound' AND jsonb_typeof(m.metadata->'contact_profile_requests_v1') = 'array'
      AND d.provider = ${bound.provider} AND d.integration_id = ${bound.integration_id}
      AND d.destination = c.phone AND d.state IN ('submitted', 'delivered')
      AND NULLIF(btrim(d.provider_message_id), '') IS NOT NULL
      AND COALESCE(d.submitted_at, d.delivered_at) <= ${bound.occurred_at}::timestamptz
    ORDER BY COALESCE(d.submitted_at, d.delivered_at) DESC, m.created_at DESC LIMIT 12
  `;
  const answered = await db<Array<{ field: string; occurred_at: Date | string }>>`
    SELECT field.key AS field,
      COALESCE(m.created_at, (field.value#>>'{voice_evidence,observed_at}')::timestamptz) AS occurred_at
    FROM jsonb_each(${jsonbParam(db, profile.fields)}) field
    LEFT JOIN messages m ON m.id::text = field.value->>'source_message_id'
      AND m.contact_id = ${input.contactId}::uuid
    WHERE m.id IS NOT NULL OR field.value#>>'{voice_evidence,observed_at}' IS NOT NULL
  `;
  const answeredAt = new Map(answered.map(row => [row.field, new Date(row.occurred_at).getTime()]));
  const values = contactProfileValuesV1(profile);
  const pending = questions.flatMap(question => {
    const parsed = RequestsSchema.safeParse(question.requests);
    return parsed.success ? parsed.data.flatMap(request => {
      const fields = request.fields.filter(field => request.mode === 'clarify'
        ? (answeredAt.get(field) ?? 0) <= new Date(question.accepted_at).getTime()
        : values[field] === null);
      return fields.length ? [{ message_id: question.message_id, ...request, fields }] : [];
    }) : [];
  }).slice(0, 12);
  return ContactProfileContextV1Schema.parse({ version: profile.version, sources: sources.reverse(), pending_requests: pending });
}
