import {
  evaluateCallIntakeReadinessV1,
  type CallIntakeEvidenceV1,
  type CallIntakeReadinessV1,
} from '@/features/calls/domain/call-intake-readiness';
import type { ContactIntakeV1 } from '@/features/conversation/domain/conversation-planner';
import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import {
  ensureAgentOwnedContactProfileV1,
  loadContactProfileV1,
  type StoredContactProfileV1,
} from './contact-profile.repository';

function intakeFromProfile(profile: StoredContactProfileV1): ContactIntakeV1 {
  return {
    nombre: profile.fields.nombre.value,
    apellido: profile.fields.apellido.value,
    correo: profile.fields.correo.value,
    telefono: profile.fields.telefono.value,
  };
}

async function loadEmailEvidenceV1(
  contactId: string,
  sourceMessageId: string | null,
  db: DbClient,
): Promise<CallIntakeEvidenceV1 | null> {
  if (!sourceMessageId) return null;
  const [row] = await db<Array<CallIntakeEvidenceV1>>`
    SELECT message.direction,
      message.metadata->>'message_type' AS message_type,
      conversation.channel
    FROM messages AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE message.id = ${sourceMessageId}::uuid
      AND message.contact_id = ${contactId}::uuid
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Resolves the call intake and its evidence from one durable profile. With
 * `forUpdate`, the caller must own a transaction and the contact row stays
 * locked through the subsequent call reservation.
 */
export async function loadCallIntakeReadinessV1(
  contactId: string,
  conversationId: string,
  db: DbClient = orchestratorSql,
  options: { readonly forUpdate?: boolean } = {},
): Promise<CallIntakeReadinessV1> {
  const profile = options.forUpdate
    ? await ensureAgentOwnedContactProfileV1(contactId, db)
    : await loadContactProfileV1(contactId, db);

  if (!profile) {
    return {
      status: 'unknown',
      intake: { nombre: null, apellido: null, correo: null, telefono: null },
      requirements: [],
    };
  }

  // The conversation is part of the authorization boundary even though the
  // email proof may come from an earlier WhatsApp conversation for this same
  // contact. A mismatched contact/conversation pair can never become ready.
  const [conversation] = await db<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM messages
      WHERE conversation_id = ${conversationId}::uuid
        AND contact_id = ${contactId}::uuid
    ) AS exists
  `;
  if (!conversation?.exists) {
    return { status: 'unknown', intake: intakeFromProfile(profile), requirements: [] };
  }

  return evaluateCallIntakeReadinessV1({
    intake: intakeFromProfile(profile),
    email_evidence: await loadEmailEvidenceV1(
      contactId,
      profile.fields.correo.source_message_id,
      db,
    ),
  });
}
