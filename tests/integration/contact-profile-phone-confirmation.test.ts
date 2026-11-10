import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope, type IngestContext } from '@/lib/services/ingestion.service';
import { registerMessage } from '@/lib/services/message.service';
import { confirmDeliveredContactPhone } from '@/lib/repositories/contact-phone-confirmation.repository';
import { applyContactProfileUpdatesV1, loadContactProfileV1 } from '@/lib/repositories/contact-profile.repository';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const connections = process.env.TEST_DATABASE_URL ? openIndependentLocalTestDatabases(2) : [];
afterAll(async () => { await Promise.all([...connections.map(c => c.end()), db?.end(), sql.end()]); });
const PHONE = '+5491155550101';

function envelope(text = PHONE): InboundEnvelope {
  const id = randomUUID();
  return { schema_version: 1, source: 'botpress', channel: 'whatsapp', identity_owner: 'agent_a_v1',
    integration_id: 'vitest-profile-phone', sandbox_provider: 'telegram_sandbox',
    external_message_id: id, external_conversation_id: `phone-${id}`, external_user_id: id,
    phone_e164: `+999${id.replace(/\D/gu, '').slice(0, 10).padEnd(10, '1')}`, trace_id: randomUUID(),
    message: { type: 'text', text, occurred_at: new Date().toISOString(), reply_to_external_message_id: null } };
}

const next = (original: InboundEnvelope, text: string): InboundEnvelope => ({ ...original,
  external_message_id: randomUUID(), trace_id: randomUUID(), message: { ...original.message, text,
    occurred_at: new Date().toISOString() } });

async function suggested(first: InboundEnvelope, context: IngestContext, delivered = true) {
  const { message } = await registerMessage({ conversation_id: context.conversation_id,
    direction: 'outbound', content: '¿Confirmás +54 9 11 5555 0101?', in_reply_to: context.turn_id }, { db: db!, embedding: 'skip' });
  await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
    channel, destination, idempotency_key, state, provider_message_id, submitted_at)
    VALUES (${message.id}::uuid, ${context.conversation_id}::uuid, ${context.contact.id}::uuid, 'telegram_sandbox',
      ${first.integration_id}, 'whatsapp', ${first.phone_e164}, ${randomUUID()},
      ${delivered ? 'submitted' : 'pending'}, ${delivered ? randomUUID() : null},
      CASE WHEN ${delivered}::boolean THEN now() ELSE NULL END)`;
  return message.id;
}

async function confirm(turnId: string) {
  return withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId, phone: PHONE }, tx));
}

async function retractPhone(context: IngestContext, quote: string) {
  const token = randomUUID();
  await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
    representative_turn_id = ${context.turn_id}::uuid, claimed_by = 'vitest-profile-phone',
    claimed_at = now(), lease_until = now() + interval '5 minutes' WHERE id = ${context.batch.id}::uuid`;
  const profile = await loadContactProfileV1(context.contact.id, db!);
  return withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, {
    turn_id: context.turn_id, batch_id: context.batch.id, claim_token: token, expected_version: profile!.version,
    updates: [{ field: 'telefono', value: null, operation: 'retract', source_message_id: context.turn_id, source_quote: quote }],
  }));
}

run('owned contact profile phone confirmation provenance', () => {
  it('persists a customer-authored international number after its delivered confirmation', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    const suggestionId = await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    expect(confirmation.contact.name).toBeNull();
    expect((await db!`SELECT declared_phone FROM contacts WHERE id = ${original.contact.id}::uuid`)[0].declared_phone).toBeNull();
    expect(await confirm(confirmation.turn_id)).toBe(true);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe(PHONE);
    const profile = await loadContactProfileV1(original.contact.id, db!);
    expect(profile).toMatchObject({ version: 1, fields: { telefono: {
      value: PHONE, source: 'legacy', source_message_id: confirmation.turn_id, source_quote: 'Sí', source_seq: 2,
      confirmation_evidence: { kind: 'delivered_phone_confirmation_v1',
        suggested_message_id: suggestionId, local_phone_message_id: original.turn_id },
    } } });
    expect((await db!`SELECT metadata->'confirmed_phone_v1' AS proof FROM messages WHERE id = ${confirmation.turn_id}::uuid`)[0].proof)
      .toEqual({ phone: PHONE, source_message_id: suggestionId });
    expect(await confirm(confirmation.turn_id)).toBe(true);
    expect((await loadContactProfileV1(original.contact.id, db!))?.version).toBe(1);
  });

  // Authority line 191: "Un teléfono local requiere formato internacional;
  // no asumas país." A delivered assistant suggestion cannot manufacture the
  // missing country/mobile prefix and turn a local number into durable identity.
  it('rejects confirmation of an assistant-inferred international prefix for a local number', async () => {
    const first = envelope('1169004497');
    const original = await processInboundMessage(first);
    await suggestText(first, original, 'Entonces sería +54 9 11 6900 4497, me confirmás?');
    const confirmation = await processInboundMessage(next(first, 'Sí'));

    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({
      turnId: confirmation.turn_id,
      phone: '+5491169004497',
    }, tx))).toBe(false);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBeNull();
  });

  it('refuses a newer retraction even if an old writer drifted the legacy declared phone', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    const newer = await processInboundMessage(next(first, 'Retiro mi teléfono'));
    await retractPhone(newer, 'Retiro mi teléfono');
    await db!`UPDATE contacts SET declared_phone = ${PHONE} WHERE id = ${original.contact.id}::uuid`;
    expect(await confirm(confirmation.turn_id)).toBe(false);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBeNull();
    expect((await loadContactProfileV1(original.contact.id, db!))?.fields.telefono.status).toBe('retracted');
  });

  it('does not revive a phone retracted in the same confirmation turn', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    await retractPhone(confirmation, 'Sí');
    expect(await confirm(confirmation.turn_id)).toBe(false);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBeNull();
  });

  it('requires both a delivered suggestion and earlier literal number evidence', async () => {
    for (const [text, delivered] of [['1155550101', false], ['Hola', true]] as const) {
      const first = envelope(text);
      const original = await processInboundMessage(first);
      await suggested(first, original, delivered);
      const confirmation = await processInboundMessage(next(first, 'Sí'));
      expect(await confirm(confirmation.turn_id)).toBe(false);
      expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBeNull();
    }
  });

  it('rolls back canonical and legacy phone changes together with a rejected decision', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    await expect(db!.begin(async tx => {
      expect(await confirmDeliveredContactPhone({ turnId: confirmation.turn_id, phone: PHONE }, tx)).toBe(true);
      expect((await loadContactIntakeV1(original.contact.id, tx)).telefono).toBe(PHONE);
      throw new Error('rejected decision');
    })).rejects.toThrow('rejected decision');
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBeNull();
    expect((await loadContactProfileV1(original.contact.id, db!))?.version).toBe(0);
  });

  it('preserves a concurrent independent name observation while confirming the phone', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí, Samira'));
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      representative_turn_id = ${confirmation.turn_id}::uuid, claimed_by = 'vitest-profile-phone',
      claimed_at = now(), lease_until = now() + interval '5 minutes' WHERE id = ${confirmation.batch.id}::uuid`;
    const [phone, name] = await Promise.all([
      withSerializableTransactionOn(connections[0], tx => confirmDeliveredContactPhone({ turnId: confirmation.turn_id, phone: PHONE }, tx)),
      withSerializableTransactionOn(connections[1], tx => applyContactProfileUpdatesV1(tx, {
        turn_id: confirmation.turn_id, batch_id: confirmation.batch.id, claim_token: token, expected_version: 0,
        updates: [{ field: 'nombre', value: 'Samira', operation: 'set', source_message_id: confirmation.turn_id, source_quote: 'Samira' }],
      })),
    ]);
    expect(phone).toBe(true);
    expect(name.accepted_fields).toEqual(['nombre']);
    expect(await loadContactIntakeV1(original.contact.id, db!)).toMatchObject({ nombre: 'Samira', telefono: PHONE });
    expect((await loadContactProfileV1(original.contact.id, db!))?.version).toBe(2);
  });

  it('commits typed phone confirmation in the independent profile phase before a later decision fails', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      representative_turn_id = ${confirmation.turn_id}::uuid, claimed_by = 'vitest-profile-phone',
      claimed_at = now(), lease_until = now() + interval '5 minutes' WHERE id = ${confirmation.batch.id}::uuid`;
    const input = { turn_id: confirmation.turn_id, batch_id: confirmation.batch.id,
      claim_token: token, expected_version: 0, updates: [], confirmed_phone: PHONE };
    const receipt = await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, input));
    expect(receipt.accepted_fields).toContain('telefono');
    expect(receipt.values.telefono).toBe(PHONE);
    await expect(db!.begin(async () => { throw new Error('reply rejected'); })).rejects.toThrow('reply rejected');
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe(PHONE);
    await db!`UPDATE inbound_batches SET state = 'completed', completed_at = now() WHERE id = ${confirmation.batch.id}::uuid`;
    expect(await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, input))).toEqual(receipt);
  });
  // 2026-11-05: «mi número termina en 8, no en 7». El agente arma el número
  // completo a partir del conocido y el cliente lo confirma por escrito.
  async function suggestText(first: InboundEnvelope, context: IngestContext, content: string) {
    const { message } = await registerMessage({ conversation_id: context.conversation_id,
      direction: 'outbound', content, in_reply_to: context.turn_id }, { db: db!, embedding: 'skip' });
    await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
      channel, destination, idempotency_key, state, provider_message_id, submitted_at)
      VALUES (${message.id}::uuid, ${context.conversation_id}::uuid, ${context.contact.id}::uuid, 'telegram_sandbox',
        ${first.integration_id}, 'whatsapp', ${first.phone_e164}, ${randomUUID()}, 'submitted', ${randomUUID()}, now())`;
    return message.id;
  }

  it('confirms a corrected known number when the customer confirms the complete delivered candidate', async () => {
    const CORRECTED = '+5491155550108';
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    const confirmation = await processInboundMessage(next(first, 'Sí'));
    expect(await confirm(confirmation.turn_id)).toBe(true);
    const correction = await processInboundMessage(next(first, 'me confundí, termina en 8, no en 1'));
    await suggestText(first, correction, 'Entonces sería +5491155550108, me confirmás?');
    // The agent repeats the question once before the customer confirms.
    const again = await processInboundMessage(next(first, 'me volvés a llamar?'));
    const suggestionId = await suggestText(first, again, 'Antes confirmame: ¿+5491155550108 está bien?');
    const yes = await processInboundMessage(next(first, 'sí'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId: yes.turn_id, phone: CORRECTED }, tx))).toBe(true);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe(CORRECTED);
    expect((await db!`SELECT declared_phone FROM contacts WHERE id = ${original.contact.id}::uuid`)[0].declared_phone).toBe(CORRECTED);
    expect((await loadContactProfileV1(original.contact.id, db!))?.fields.telefono.confirmation_evidence)
      .toMatchObject({ kind: 'delivered_phone_correction_v1', suggested_message_id: suggestionId });
  });

  it('accepts the owner trace only after the customer writes the full number, then accepts a last-four correction', async () => {
    const first = envelope('1169004497');
    const original = await processInboundMessage(first);
    await suggestText(first, original, 'Entonces sería +54 11 6900 4497, me confirmás?');
    const inferred = await processInboundMessage(next(first, 'sii esta bien'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({
      turnId: inferred.turn_id,
      phone: '+541169004497',
    }, tx))).toBe(false);

    const authored = await processInboundMessage(next(first, '+54 9 11 6900 4497'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({
      turnId: authored.turn_id,
      phone: '+5491169004497',
    }, tx))).toBe(true);

    const correction = await processInboundMessage(next(first, 'mi número termina en 8, no en 7'));
    await suggestText(first, correction, 'Entonces sería +54 9 11 6900 4498, me confirmás?');
    const yes = await processInboundMessage(next(first, 'oki'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({
      turnId: yes.turn_id,
      phone: '+5491169004498',
    }, tx))).toBe(true);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe('+5491169004498');
  });

  it('rejects a corrected candidate whose changed digits the customer never wrote', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    expect(await confirm((await processInboundMessage(next(first, 'Sí'))).turn_id)).toBe(true);
    const correction = await processInboundMessage(next(first, 'creo que está mal'));
    await suggestText(first, correction, 'Entonces sería +5491155550108, me confirmás?');
    const yes = await processInboundMessage(next(first, 'sí'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId: yes.turn_id, phone: '+5491155550108' }, tx))).toBe(false);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe(PHONE);
  });

  it('an unrelated digit from an older batch or an amount never counts as the written correction', async () => {
    for (const older of ['a las 8 me viene bien', 'son 8 cuotas?']) {
      const first = envelope();
      const original = await processInboundMessage(first);
      await suggested(first, original);
      expect(await confirm((await processInboundMessage(next(first, 'Sí'))).turn_id)).toBe(true);
      const unrelated = await processInboundMessage(next(first, older));
      await suggestText(first, unrelated, 'Dale, lo vemos.');
      const later = await processInboundMessage(next(first, 'ok'));
      await suggestText(first, later, '¿Tu número es +5491155550108?');
      const yes = await processInboundMessage(next(first, 'sí'));
      expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId: yes.turn_id, phone: '+5491155550108' }, tx))).toBe(false);
    }
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    expect(await confirm((await processInboundMessage(next(first, 'Sí'))).turn_id)).toBe(true);
    const amount = await processInboundMessage(next(first, 'pago USD 8.000, termina en 1 creo'));
    await suggestText(first, amount, '¿Tu número es +5491155550108?');
    const yes = await processInboundMessage(next(first, 'sí'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId: yes.turn_id, phone: '+5491155550108' }, tx))).toBe(false);
  });

  it('rejects a confirmed candidate that rewrites more than the last four digits of the known number', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    await suggested(first, original);
    expect(await confirm((await processInboundMessage(next(first, 'Sí'))).turn_id)).toBe(true);
    const correction = await processInboundMessage(next(first, 'es otro, termina en 0108'));
    await suggestText(first, correction, 'Entonces sería +5491266660108, me confirmás?');
    const yes = await processInboundMessage(next(first, 'sí'));
    expect(await withSerializableTransactionOn(db!, tx => confirmDeliveredContactPhone({ turnId: yes.turn_id, phone: '+5491266660108' }, tx))).toBe(false);
    expect((await loadContactIntakeV1(original.contact.id, db!)).telefono).toBe(PHONE);
  });
});
