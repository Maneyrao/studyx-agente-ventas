import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import {
  applyContactProfileUpdatesV1,
  loadContactProfileV1,
} from '@/lib/repositories/contact-profile.repository';
import {
  processInboundMessage,
  type InboundEnvelope,
} from '@/lib/services/ingestion.service';

interface SeedWrittenCallIntakeInput {
  readonly phone: string;
  readonly nombre?: string;
  readonly apellido?: string;
  readonly correo?: string;
  readonly telefono?: string;
  readonly integration_id?: string;
  readonly external_conversation_id?: string;
  readonly external_user_id?: string;
}

/**
 * Persists call intake through the same trust boundary used in production:
 * a real inbound WhatsApp text, an owned batch, and Agent A's profile writer.
 * Tests that reserve a call must use this instead of backfilling contact
 * columns, because a legacy/voice email is intentionally insufficient.
 */
export async function seedWrittenCallIntakeV1(
  input: SeedWrittenCallIntakeInput,
  db: postgres.Sql,
) {
  const suffix = randomUUID();
  const nombre = input.nombre ?? 'Ana';
  const apellido = input.apellido ?? 'Pérez';
  const correo = input.correo ?? `ana.${suffix}@example.test`;
  const text = [
    `Mi nombre es ${nombre}. Mi apellido es ${apellido}. Mi correo es ${correo}`,
    input.telefono ? `Mi teléfono es ${input.telefono}` : null,
  ].filter(Boolean).join('. ');
  const inbound = await processInboundMessage({
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: input.integration_id ?? 'vitest-call-intake',
    external_message_id: `call-intake-message-${suffix}`,
    external_conversation_id: input.external_conversation_id ?? `call-intake-conversation-${suffix}`,
    external_user_id: input.external_user_id ?? `call-intake-user-${suffix}`,
    phone_e164: input.phone,
    trace_id: randomUUID(),
    identity_owner: 'agent_a_v1',
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope);

  await db`UPDATE inbound_batches SET due_at = now() - interval '1 second'
    WHERE id = ${inbound.batch.id}::uuid`;
  const [claim] = await db<Array<{ outcome: string; claim_token: string }>>`
    SELECT outcome, claim_token
    FROM claim_inbound_batch(${inbound.batch.id}::uuid, ${`call-intake-fixture-${suffix}`}, 120000)
  `;
  if (claim?.outcome !== 'claimed') throw new Error('CALL_INTAKE_FIXTURE_CLAIM_FAILED');

  const before = await loadContactProfileV1(inbound.contact.id, db);
  if (!before) throw new Error('CALL_INTAKE_FIXTURE_PROFILE_MISSING');
  await withSerializableTransactionOn(db, tx => applyContactProfileUpdatesV1(tx, {
    turn_id: inbound.turn_id,
    batch_id: inbound.batch.id,
    claim_token: claim.claim_token,
    expected_version: before.version,
    updates: [
      { field: 'nombre', value: nombre, operation: 'set',
        source_message_id: inbound.turn_id, source_quote: nombre },
      { field: 'apellido', value: apellido, operation: 'set',
        source_message_id: inbound.turn_id, source_quote: apellido },
      { field: 'correo', value: correo, operation: 'set',
        source_message_id: inbound.turn_id, source_quote: correo },
      ...(input.telefono ? [{ field: 'telefono' as const, value: input.telefono,
        operation: 'set' as const, source_message_id: inbound.turn_id,
        source_quote: input.telefono }] : []),
    ],
  }));
  await db`SELECT * FROM complete_inbound_batch(
    ${inbound.batch.id}::uuid,
    ${claim.claim_token}::uuid
  )`;

  return { ...inbound, nombre, apellido, correo, telefono: input.telefono ?? input.phone };
}
