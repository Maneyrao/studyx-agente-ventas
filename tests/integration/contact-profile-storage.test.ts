import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';
import { applyContactProfileUpdatesV1, loadContactProfileV1, type ContactProfileApplyInputV1 } from '@/lib/repositories/contact-profile.repository';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import type { ContactProfileUpdateV1 } from '@/shared/conversation/contact-profile-contract';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const connections = process.env.TEST_DATABASE_URL ? openIndependentLocalTestDatabases(2) : [];
afterAll(async () => { await Promise.all([...connections.map(c => c.end()), db?.end(), sql.end()]); });

function envelope(text = 'Hola', owned = true): InboundEnvelope {
  const id = randomUUID();
  return { schema_version: 1, source: 'botpress', channel: 'whatsapp',
    integration_id: 'vitest-profile-storage', sandbox_provider: 'telegram_sandbox',
    ...(owned ? { identity_owner: 'agent_a_v1' as const } : {}),
    external_message_id: id, external_conversation_id: `profile-${id}`, external_user_id: id,
    phone_e164: `+999${id.replace(/\D/gu, '').slice(0, 10).padEnd(10, '1')}`, trace_id: randomUUID(),
    message: { type: 'text', text, occurred_at: new Date().toISOString(), reply_to_external_message_id: null } };
}

async function fixture(text: string) {
  const first = envelope(text);
  const opened = await processInboundMessage(first);
  const token = randomUUID();
  await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
    claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes'
    WHERE id = ${opened.batch.id}::uuid`;
  return { first, opened, request: { turn_id: opened.turn_id, batch_id: opened.batch.id,
    claim_token: token, expected_version: 0, updates: [] } satisfies ContactProfileApplyInputV1 };
}

const update = (field: ContactProfileUpdateV1['field'], value: string | null, message: string,
  quote: string, operation: ContactProfileUpdateV1['operation'] = 'set'): ContactProfileUpdateV1 =>
  ({ field, value, operation, source_message_id: message, source_quote: quote });

async function apply(request: ContactProfileApplyInputV1) {
  return withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, request));
}

async function followUp(f: Awaited<ReturnType<typeof fixture>>, text: string, expectedVersion: number) {
  await db!`UPDATE inbound_batches SET state = 'completed', completed_at = now() WHERE id = ${f.opened.batch.id}::uuid`;
  const opened = await processInboundMessage({ ...f.first, external_message_id: randomUUID(), trace_id: randomUUID(),
    message: { ...f.first.message, text } });
  const token = randomUUID();
  await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
    claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes'
    WHERE id = ${opened.batch.id}::uuid`;
  return { opened, request: { turn_id: opened.turn_id, batch_id: opened.batch.id,
    claim_token: token, expected_version: expectedVersion, updates: [] } satisfies ContactProfileApplyInputV1 };
}

run('canonical Agent A contact profile persistence', () => {
  it('persists a surname alone, then keeps a compound first name independent', async () => {
    const f = await fixture('de la Croix\nAna María');
    const surname = await apply({ ...f.request,
      updates: [update('apellido', 'de la Croix', f.opened.turn_id, 'de la Croix')] });
    expect(surname).toMatchObject({ version: 1, accepted_fields: ['apellido'],
      values: { nombre: null, apellido: 'de la Croix' }, rejections: [] });
    expect(await loadContactIntakeV1(f.opened.contact.id, db!)).toMatchObject({ nombre: null, apellido: 'de la Croix' });
    const name = await apply({ ...f.request, expected_version: 1,
      updates: [update('nombre', 'Ana María', f.opened.turn_id, 'Ana María')] });
    expect(name.values).toMatchObject({ nombre: 'Ana María', apellido: 'de la Croix' });
    expect((await db!`SELECT name FROM contacts WHERE id = ${f.opened.contact.id}::uuid`)[0].name)
      .toBe('Ana María de la Croix');
  });

  it('treats name values literally, preserving scripts, punctuation and NFC text', async () => {
    const f = await fixture('عائشة\nO’Neill\nJose\u0301');
    const receipt = await apply({ ...f.request, updates: [
      update('nombre', 'عائشة', f.opened.turn_id, 'عائشة'),
      update('apellido', 'O’Neill', f.opened.turn_id, 'O’Neill'),
    ] });
    expect(receipt.rejections).toEqual([]);
    expect(receipt.values).toMatchObject({ nombre: 'عائشة', apellido: 'O’Neill' });
    const corrected = await apply({ ...f.request, expected_version: 1,
      updates: [update('nombre', 'José', f.opened.turn_id, 'José', 'correct')] });
    expect(corrected.values.nombre).toBe('José');
  });

  it.each([
    { label: 'identical values', nameQuote: 'thiago', surnameQuote: 'maneyro', name: 'Thiago', surname: 'Maneyro',
      observedName: 'Thiago', observedSurname: 'Maneyro' },
    { label: 'casing', nameQuote: 'thiago', surnameQuote: 'maneyro', name: 'Thiago', surname: 'Maneyro',
      observedName: 'thiago', observedSurname: 'maneyro' },
    { label: 'spacing and canonical Unicode', nameQuote: 'Jose\u0301    Luis', surnameQuote: 'de   la   Pen\u0303a',
      name: 'José Luis', surname: 'de la Peña', observedName: 'jose\u0301 \t luis', observedSurname: 'DE \t LA PEÑA' },
  ])('keeps $label reobservations unchanged while storing a later email', async ({ nameQuote, surnameQuote, name, surname, observedName, observedSurname }) => {
    const f = await fixture(`${nameQuote}\n${surnameQuote}`);
    await apply({ ...f.request, updates: [update('nombre', name, f.opened.turn_id, nameQuote),
      update('apellido', surname, f.opened.turn_id, surnameQuote)] });
    const before = await loadContactProfileV1(f.opened.contact.id, db!);
    const next = await followUp(f, 'thiago@example.test', 1);
    const receipt = await apply({ ...next.request, updates: [
      update('nombre', observedName, f.opened.turn_id, nameQuote),
      update('apellido', observedSurname, f.opened.turn_id, surnameQuote),
      update('correo', 'thiago@example.test', next.opened.turn_id, 'thiago@example.test'),
    ] });

    expect(receipt).toMatchObject({ version: 2, accepted_fields: ['correo'], rejections: [],
      values: { nombre: name, apellido: surname, correo: 'thiago@example.test' } });
    const after = await loadContactProfileV1(f.opened.contact.id, db!);
    expect(after!.fields.nombre).toEqual(before!.fields.nombre);
    expect(after!.fields.apellido).toEqual(before!.fields.apellido);
    const repeated = await apply({ ...next.request, expected_version: 2, updates: [
      update('nombre', observedName, f.opened.turn_id, nameQuote),
      update('apellido', observedSurname, f.opened.turn_id, surnameQuote),
    ] });
    expect(repeated).toMatchObject({ version: 2, accepted_fields: [], rejections: [] });
    expect(await loadContactProfileV1(f.opened.contact.id, db!)).toEqual(after);
  });

  it('requires explicit correction for changes in accents, punctuation or actual name text', async () => {
    const f = await fixture("José\nJose\nJosè\nJosé Luis\nO’Neill\nO'Neill");
    await apply({ ...f.request, updates: [update('nombre', 'José', f.opened.turn_id, 'José'),
      update('apellido', 'O’Neill', f.opened.turn_id, 'O’Neill')] });
    for (const value of ['Jose', 'Josè', 'José Luis']) {
      expect((await apply({ ...f.request, expected_version: 1,
        updates: [update('nombre', value, f.opened.turn_id, value)] })).rejections)
        .toEqual([{ field: 'nombre', code: 'CORRECTION_REQUIRED' }]);
    }
    expect((await apply({ ...f.request, expected_version: 1,
      updates: [update('apellido', "O'Neill", f.opened.turn_id, "O'Neill")] })).rejections)
      .toEqual([{ field: 'apellido', code: 'CORRECTION_REQUIRED' }]);
    const corrected = await apply({ ...f.request, expected_version: 1,
      updates: [update('nombre', 'Jose', f.opened.turn_id, 'Jose', 'correct')] });
    expect(corrected).toMatchObject({ version: 2, accepted_fields: ['nombre'], values: { nombre: 'Jose' }, rejections: [] });
  });

  it('still fences equivalent observations by field version and stale evidence', async () => {
    const f = await fixture('thiago\nRiver');
    await apply({ ...f.request, updates: [update('nombre', 'River', f.opened.turn_id, 'River')] });
    const next = await followUp(f, 'Thiago', 1);
    await apply({ ...next.request, updates: [update('nombre', 'Thiago', next.opened.turn_id, 'Thiago', 'correct')] });
    const before = await loadContactProfileV1(f.opened.contact.id, db!);

    expect((await apply({ ...next.request, updates: [update('nombre', 'thiago', next.opened.turn_id, 'Thiago')] })).rejections)
      .toEqual([{ field: 'nombre', code: 'VERSION_CONFLICT' }]);
    expect((await apply({ ...next.request, expected_version: 2,
      updates: [update('nombre', 'thiago', f.opened.turn_id, 'thiago')] })).rejections)
      .toEqual([{ field: 'nombre', code: 'STALE_SOURCE' }]);
    expect(await loadContactProfileV1(f.opened.contact.id, db!)).toEqual(before);
  });

  it('validates each field independently and persists only the matching evidence', async () => {
    const f = await fixture('Me llamo Inès. Mi correo es INES@Example.Test y mi número +54 (911) 3210-4399');
    const receipt = await apply({ ...f.request, updates: [
      update('nombre', 'Inès', f.opened.turn_id, 'Inès'),
      update('apellido', 'Inventado', f.opened.turn_id, 'Inès'),
      update('correo', 'ines@example.test', f.opened.turn_id, 'INES@Example.Test'),
      update('telefono', '+5491132104399', f.opened.turn_id, '+54 (911) 3210-4399'),
    ] });
    expect(receipt.accepted_fields).toEqual(['nombre', 'correo', 'telefono']);
    expect(receipt.rejections).toEqual([{ field: 'apellido', code: 'VALUE_MISMATCH' }]);
    expect((await db!`SELECT name, email, declared_phone FROM contacts WHERE id = ${f.opened.contact.id}::uuid`)[0])
      .toEqual({ name: 'Inès', email: 'ines@example.test', declared_phone: '+5491132104399' });
  });

  it('accepts literal value spans in whole supporting phrases, corrections and wrapped contact values', async () => {
    const text = 'Mi nombre es María del Mar. Mi apellido es van der Meer. Mi correo es [MAR@EXAMPLE.TEST](mailto:MAR@EXAMPLE.TEST) y mi teléfono es +54 (911) 3210-4399.';
    const f = await fixture(text);
    const receipt = await apply({ ...f.request, updates: [
      update('nombre', 'María del Mar', f.opened.turn_id, 'Mi nombre es María del Mar'),
      update('apellido', 'van der Meer', f.opened.turn_id, 'Mi apellido es van der Meer'),
      update('correo', 'mar@example.test', f.opened.turn_id, 'Mi correo es [MAR@EXAMPLE.TEST](mailto:MAR@EXAMPLE.TEST)'),
      update('telefono', '+5491132104399', f.opened.turn_id, 'mi teléfono es +54 (911) 3210-4399'),
    ] });
    expect(receipt.accepted_fields).toEqual(['nombre', 'apellido', 'correo', 'telefono']);
    expect(receipt.rejections).toEqual([]);
    const correction = await apply({ ...f.request, expected_version: 1,
      updates: [update('apellido', 'Meer', f.opened.turn_id, 'Mi apellido es van der Meer', 'correct')] });
    expect(correction.values.apellido).toBe('Meer');
  });

  it('rejects absent quotes, other contacts, outbound sources and unsupported input', async () => {
    const f = await fixture('Rivière');
    const other = await fixture('Rivière');
    const outbound = randomUUID();
    await db!`INSERT INTO messages (id, conversation_id, contact_id, direction, content)
      VALUES (${outbound}::uuid, ${f.opened.conversation_id}::uuid, ${f.opened.contact.id}::uuid, 'outbound', 'Rivière')`;
    for (const source of [other.opened.turn_id, outbound, randomUUID()]) {
      const receipt = await apply({ ...f.request, updates: [update('apellido', 'Rivière', source, 'Rivière')] });
      expect(receipt.rejections).toEqual([{ field: 'apellido', code: 'SOURCE_NOT_AUTHORIZED' }]);
    }
    expect((await apply({ ...f.request, updates: [update('apellido', 'Rivière', f.opened.turn_id, 'absent')] })).rejections)
      .toEqual([{ field: 'apellido', code: 'SOURCE_NOT_AUTHORIZED' }]);
    await db!`UPDATE messages SET metadata = metadata || '{"message_type":"unsupported"}'::jsonb
      WHERE id = ${f.opened.turn_id}::uuid`;
    expect((await apply({ ...f.request, updates: [update('apellido', 'Rivière', f.opened.turn_id, 'Rivière')] })).rejections)
      .toEqual([{ field: 'apellido', code: 'SOURCE_NOT_AUTHORIZED' }]);
  });

  it('cannot use evidence arriving after the claimed snapshot', async () => {
    const f = await fixture('River');
    const later = await processInboundMessage({ ...f.first, external_message_id: randomUUID(), trace_id: randomUUID(),
      message: { ...f.first.message, text: 'Stone' } });
    expect((await apply({ ...f.request, updates: [update('apellido', 'Stone', later.turn_id, 'Stone')] })).rejections)
      .toEqual([{ field: 'apellido', code: 'SOURCE_NOT_AUTHORIZED' }]);
  });

  it('requires explicit correction and never lets stale evidence overwrite a newer correction', async () => {
    const f = await fixture('River');
    await apply({ ...f.request, updates: [update('apellido', 'River', f.opened.turn_id, 'River')] });
    await db!`UPDATE inbound_batches SET state = 'completed', completed_at = now() WHERE id = ${f.opened.batch.id}::uuid`;
    const newer = await processInboundMessage({ ...f.first, external_message_id: randomUUID(), trace_id: randomUUID(),
      message: { ...f.first.message, text: 'Stone' } });
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes'
      WHERE id = ${newer.batch.id}::uuid`;
    const request = { ...f.request, turn_id: newer.turn_id, batch_id: newer.batch.id, claim_token: token, expected_version: 1 };
    expect((await apply({ ...request, updates: [update('apellido', 'Stone', newer.turn_id, 'Stone')] })).rejections)
      .toEqual([{ field: 'apellido', code: 'CORRECTION_REQUIRED' }]);
    expect((await apply({ ...request, updates: [update('apellido', 'Stone', newer.turn_id, 'Stone', 'correct')] })).values.apellido)
      .toBe('Stone');
    expect((await apply({ ...request, expected_version: 2,
      updates: [update('apellido', 'River', f.opened.turn_id, 'River', 'correct')] })).rejections)
      .toEqual([{ field: 'apellido', code: 'STALE_SOURCE' }]);
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.fields.apellido.source_message_id).toBe(newer.turn_id);
  });

  it('serializes disjoint updates without losing either value despite an old common version', async () => {
    const f = await fixture('Samira\nOkafor');
    const [name, surname] = await Promise.all(connections.map((connection, index) =>
      withSerializableTransactionOn(connection, tx => applyContactProfileUpdatesV1(tx, { ...f.request,
        updates: [index === 0 ? update('nombre', 'Samira', f.opened.turn_id, 'Samira')
          : update('apellido', 'Okafor', f.opened.turn_id, 'Okafor')] }))));
    expect(name.accepted_fields).toEqual(['nombre']);
    expect(surname.accepted_fields).toEqual(['apellido']);
    expect(await loadContactIntakeV1(f.opened.contact.id, db!)).toMatchObject({ nombre: 'Samira', apellido: 'Okafor' });
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.version).toBe(2);
  });

  it('retracts one field without discarding unrelated fields or falling back to legacy columns', async () => {
    const f = await fixture('Samira\nOkafor\nRetiro mi apellido');
    await apply({ ...f.request, updates: [update('nombre', 'Samira', f.opened.turn_id, 'Samira'),
      update('apellido', 'Okafor', f.opened.turn_id, 'Okafor')] });
    const receipt = await apply({ ...f.request, expected_version: 1,
      updates: [update('apellido', null, f.opened.turn_id, 'Retiro mi apellido', 'retract')] });
    expect(receipt.values).toMatchObject({ nombre: 'Samira', apellido: null });
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.fields.apellido.status).toBe('retracted');
    expect(await loadContactIntakeV1(f.opened.contact.id, db!)).toMatchObject({ nombre: 'Samira', apellido: null });
  });

  it('returns the exact durable receipt after completion but refuses another token or a new request', async () => {
    const f = await fixture('Kiran');
    const request = { ...f.request, updates: [update('nombre', 'Kiran', f.opened.turn_id, 'Kiran')] };
    const receipt = await apply(request);
    await db!`UPDATE inbound_batches SET state = 'completed', completed_at = now() WHERE id = ${f.opened.batch.id}::uuid`;
    expect(await apply(request)).toEqual(receipt);
    await expect(apply({ ...request, claim_token: randomUUID() })).rejects.toMatchObject({ code: 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED' });
    await expect(apply({ ...request, expected_version: 1 })).rejects.toMatchObject({ code: 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED' });
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.version).toBe(1);
  });

  it('rejects a cached receipt after another worker takes ownership of its batch', async () => {
    const f = await fixture('Kiran');
    const request = { ...f.request, updates: [update('nombre', 'Kiran', f.opened.turn_id, 'Kiran')] };
    await apply(request);
    await db!`UPDATE inbound_batches SET claim_token = ${randomUUID()}::uuid,
      claimed_by = 'a-new-worker', claim_attempt_count = claim_attempt_count + 1
      WHERE id = ${f.opened.batch.id}::uuid`;
    await expect(apply(request)).rejects.toMatchObject({ code: 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED' });
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.version).toBe(1);
  });

  it('refuses fresh requests after lease expiry even when their token once owned the batch', async () => {
    const f = await fixture('Kiran');
    await db!`UPDATE inbound_batches SET lease_until = now() - interval '1 second'
      WHERE id = ${f.opened.batch.id}::uuid`;
    await expect(apply({ ...f.request, updates: [update('nombre', 'Kiran', f.opened.turn_id, 'Kiran')] }))
      .rejects.toMatchObject({ code: 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED' });
    expect((await loadContactIntakeV1(f.opened.contact.id, db!)).nombre).toBeNull();
  });

  it('keeps source sequence scoped to its conversation and fences stale field versions across conversations', async () => {
    const f = await fixture('River');
    // The previous conversation has a longer history; its sequence cannot be
    // compared with sequence 1 of a new channel conversation.
    await db!`UPDATE messages SET conversation_seq = 20 WHERE id = ${f.opened.turn_id}::uuid`;
    await apply({ ...f.request, updates: [update('apellido', 'River', f.opened.turn_id, 'River')] });
    const anotherConversation = await processInboundMessage({ ...f.first, external_conversation_id: randomUUID(),
      external_message_id: randomUUID(), trace_id: randomUUID(), message: { ...f.first.message, text: 'Stone\nInès' } });
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes'
      WHERE id = ${anotherConversation.batch.id}::uuid`;
    const nextRequest = { ...f.request, turn_id: anotherConversation.turn_id, batch_id: anotherConversation.batch.id,
      claim_token: token, updates: [update('apellido', 'Stone', anotherConversation.turn_id, 'Stone', 'correct')] };
    expect((await apply(nextRequest)).rejections).toEqual([{ field: 'apellido', code: 'VERSION_CONFLICT' }]);
    const corrected = await apply({ ...nextRequest, expected_version: 1 });
    expect(corrected.values.apellido).toBe('Stone');
    expect((await loadContactProfileV1(f.opened.contact.id, db!))?.fields.apellido)
      .toMatchObject({ source_conversation_id: anotherConversation.conversation_id, source_seq: 1 });
    const disjoint = await apply({ ...nextRequest, expected_version: 0,
      updates: [update('nombre', 'Inès', anotherConversation.turn_id, 'Inès')] });
    expect(disjoint.accepted_fields).toEqual(['nombre']);
    expect(disjoint.values).toMatchObject({ nombre: 'Inès', apellido: 'Stone' });
  });

  it('limits proposed source evidence to the same 32 recent eligible inbounds as the context', async () => {
    const first = envelope('Ancien');
    const oldest = await processInboundMessage(first);
    let latest = oldest;
    for (let index = 0; index < 33; index += 1) {
      latest = await processInboundMessage({ ...first, external_message_id: randomUUID(), trace_id: randomUUID(),
        message: { ...first.message, text: index === 32 ? 'Samir' : `message ${index}` } });
    }
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes',
      representative_turn_id = ${latest.turn_id}::uuid
      WHERE id = ${latest.batch.id}::uuid`;
    const request = { turn_id: latest.turn_id, batch_id: latest.batch.id, claim_token: token, expected_version: 0,
      updates: [update('apellido', 'Ancien', oldest.turn_id, 'Ancien'), update('nombre', 'Samir', latest.turn_id, 'Samir')] };
    const receipt = await apply(request);
    expect(receipt.accepted_fields).toEqual(['nombre']);
    expect(receipt.rejections).toEqual([{ field: 'apellido', code: 'SOURCE_NOT_AUTHORIZED' }]);
    await expect(apply({ ...request, turn_id: oldest.turn_id }))
      .rejects.toMatchObject({ code: 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED' });
  });

  it('rejects older conversation evidence even if its worker reloads the latest profile version', async () => {
    const f = await fixture('River');
    await apply({ ...f.request, updates: [update('apellido', 'River', f.opened.turn_id, 'River')] });
    const newer = await processInboundMessage({ ...f.first, external_conversation_id: randomUUID(),
      external_message_id: randomUUID(), trace_id: randomUUID(), message: { ...f.first.message, text: 'Stone' } });
    const token = randomUUID();
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      claimed_by = 'vitest-profile', claimed_at = now(), lease_until = now() + interval '5 minutes'
      WHERE id = ${newer.batch.id}::uuid`;
    await apply({ turn_id: newer.turn_id, batch_id: newer.batch.id, claim_token: token, expected_version: 1,
      updates: [update('apellido', 'Stone', newer.turn_id, 'Stone', 'correct')] });
    const receipt = await apply({ ...f.request, expected_version: 2,
      updates: [update('apellido', 'River', f.opened.turn_id, 'River', 'correct')] });
    expect(receipt.rejections).toEqual([{ field: 'apellido', code: 'STALE_SOURCE' }]);
    expect(receipt.values.apellido).toBe('Stone');
  });

  it('rejects malformed technical formats without rejecting literal human names by a word list', async () => {
    const f = await fixture('true\nnot-an-email\n+9991132104399');
    const receipt = await apply({ ...f.request, updates: [update('nombre', 'true', f.opened.turn_id, 'true'),
      update('correo', 'not-an-email', f.opened.turn_id, 'not-an-email'),
      update('telefono', '+9991132104399', f.opened.turn_id, '+9991132104399')] });
    expect(receipt.accepted_fields).toEqual(['nombre']);
    expect(receipt.rejections).toEqual([{ field: 'correo', code: 'INVALID_FORMAT' }, { field: 'telefono', code: 'INVALID_FORMAT' }]);
  });

  it('preserves independent observations when confirmed phone uses a stale field version', async () => {
    const f = await fixture('Iris\n+491701234567');
    await apply({ ...f.request, updates: [update('telefono', '+491701234567', f.opened.turn_id, '+491701234567')] });
    const receipt = await apply({ ...f.request, updates: [update('nombre', 'Iris', f.opened.turn_id, 'Iris')], confirmed_phone: '+491701234567' });
    expect(receipt.accepted_fields).toEqual(['nombre']);
    expect(receipt.rejections).toEqual([{ field: 'telefono', code: 'PHONE_CONFIRMATION_NOT_AUTHORIZED' }]);
    expect(receipt.values).toMatchObject({ nombre: 'Iris', telefono: '+491701234567' });
  });

  it('does not let a conflicting confirmed phone overwrite an accepted explicit phone in the same phase', async () => {
    const f = await fixture('Iris\n+491701234567');
    const receipt = await apply({ ...f.request, confirmed_phone: '+491709999999', updates: [
      update('nombre', 'Iris', f.opened.turn_id, 'Iris'), update('telefono', '+491701234567', f.opened.turn_id, '+491701234567'),
    ] });
    expect(receipt.accepted_fields).toEqual(['nombre', 'telefono']);
    expect(receipt.rejections).toEqual([{ field: 'telefono', code: 'PHONE_CONFIRMATION_NOT_AUTHORIZED' }]);
    expect(receipt.values.telefono).toBe('+491701234567');
  });

  it('enforces per-field version shape at the PostgreSQL boundary', async () => {
    const f = await fixture('Hola');
    const profile = await loadContactProfileV1(f.opened.contact.id, db!);
    profile!.fields.nombre.version = -1;
    await expect(db!`UPDATE contacts SET contact_profile_v1 = ${jsonbParam(db!, profile)}
      WHERE id = ${f.opened.contact.id}::uuid`).rejects.toMatchObject({ code: '23514' });
  });

  it('retires ingestion interpretation permanently after ownership and preserves raw evidence', async () => {
    const f = await fixture('Soy Marta River. marta@example.test');
    expect(await loadContactIntakeV1(f.opened.contact.id, db!)).toMatchObject({ nombre: null, apellido: null, correo: null });
    const later = await processInboundMessage({ ...f.first, identity_owner: undefined,
      external_message_id: randomUUID(), trace_id: randomUUID(), message: { ...f.first.message, text: 'Soy Elena Stone. elena@example.test' } });
    expect(later.contact.name).toBeNull();
    expect((await db!`SELECT content, metadata FROM messages WHERE id = ${later.turn_id}::uuid`)[0])
      .toMatchObject({ content: 'Soy Elena Stone. elena@example.test' });
    expect((await db!`SELECT metadata FROM messages WHERE id = ${later.turn_id}::uuid`)[0].metadata)
      .not.toHaveProperty('contact_name_answer_v1');
  });

  it('keeps ingestion suppression available for an already deleted owned contact', async () => {
    const f = await fixture('Hola');
    await db!`UPDATE contacts SET deleted_at = now() WHERE id = ${f.opened.contact.id}::uuid`;
    const result = await processInboundMessage({ ...f.first, external_message_id: randomUUID(), trace_id: randomUUID() });
    expect(result.status).toBe('suppressed');
    expect(result.policy.may_respond).toBe(false);
  });

  it('bootstraps only durable legacy columns and does not promote partial capture metadata', async () => {
    const first = envelope('Soy Nadia Vega. nadia@example.test', false);
    const legacy = await processInboundMessage(first);
    expect(legacy.contact.name).toBe('Nadia Vega');
    await db!`UPDATE messages SET metadata = metadata || '{"contact_name_answer_v1":{"surname":"Acá Está"}}'::jsonb
      WHERE id = ${legacy.turn_id}::uuid`;
    const migrated = await processInboundMessage({ ...first, identity_owner: 'agent_a_v1',
      external_message_id: randomUUID(), trace_id: randomUUID(), message: { ...first.message, text: 'Hola' } });
    expect(await loadContactIntakeV1(migrated.contact.id, db!)).toMatchObject({ nombre: 'Nadia', apellido: 'Vega', correo: 'nadia@example.test' });
    expect((await loadContactProfileV1(migrated.contact.id, db!))?.fields.apellido.source).toBe('legacy');
    const noName = envelope('Hola', false);
    const bare = await processInboundMessage(noName);
    await db!`UPDATE messages SET metadata = metadata || '{"contact_name_answer_v1":{"surname":"Acá Está"}}'::jsonb
      WHERE id = ${bare.turn_id}::uuid`;
    await processInboundMessage({ ...noName, identity_owner: 'agent_a_v1', external_message_id: randomUUID(), trace_id: randomUUID() });
    expect(await loadContactIntakeV1(bare.contact.id, db!)).toMatchObject({ nombre: null, apellido: null });
  });

  it('replays the same legacy inbound across marker deployment without changing payload identity', async () => {
    const first = envelope('Hola', false);
    const opened = await processInboundMessage(first);
    const replay = await processInboundMessage({ ...first, identity_owner: 'agent_a_v1', trace_id: randomUUID() });
    expect(replay.turn_id).toBe(opened.turn_id);
    expect(replay.replayed).toBe(true);
    expect(await loadContactProfileV1(opened.contact.id, db!)).toMatchObject({ owner: 'agent_a_v1', version: 0 });
  });

  it('keeps valid channel phones available but excludes synthetic channel identities', async () => {
    const first = envelope('Hola');
    first.sandbox_provider = undefined;
    first.phone_e164 = `+549${Date.now().toString().slice(-10)}`;
    const real = await processInboundMessage(first);
    expect((await loadContactIntakeV1(real.contact.id, db!)).telefono).toBe(first.phone_e164);
    const synthetic = await fixture('Hola');
    expect((await loadContactIntakeV1(synthetic.opened.contact.id, db!)).telefono).toBeNull();
  });
});
