import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope, type IngestContext } from '@/lib/services/ingestion.service';
import { registerMessage } from '@/lib/services/message.service';
import { confirmDeliveredContactPhone } from '@/lib/repositories/contact-phone-confirmation.repository';
import { loadContactProfileV1 } from '@/lib/repositories/contact-profile.repository';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); await sql.end(); });

function envelope(): InboundEnvelope {
  const id = randomUUID();
  const digits = id.replace(/\D/gu, '').slice(0, 10).padEnd(10, '4');
  return {
    schema_version: 1, source: 'botpress', channel: 'whatsapp',
    integration_id: 'vitest-contextual-intake', sandbox_provider: 'telegram_sandbox',
    external_message_id: id, external_conversation_id: `conv-${id}`, external_user_id: digits,
    phone_e164: `+999${digits}`, trace_id: randomUUID(),
    message: { type: 'text', text: 'Hola', occurred_at: new Date().toISOString(), reply_to_external_message_id: null },
  };
}

function answer(original: InboundEnvelope, text: string): InboundEnvelope {
  return { ...original, external_message_id: randomUUID(), trace_id: randomUUID(),
    message: { ...original.message, text, occurred_at: new Date().toISOString() } };
}

async function outbound(initial: InboundEnvelope, context: IngestContext, content: string,
  delivery: 'submitted' | 'pending' | 'missing' | 'unproven' | 'wrong-destination' = 'submitted') {
  const { message } = await registerMessage({ conversation_id: context.conversation_id,
    direction: 'outbound', content, in_reply_to: context.turn_id }, { db: db!, embedding: 'skip' });
  if (delivery !== 'missing') await db!`
    INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
      channel, destination, idempotency_key, state, provider_message_id, submitted_at)
    VALUES (${message.id}::uuid, ${context.conversation_id}::uuid, ${context.contact.id}::uuid,
      'telegram_sandbox', ${initial.integration_id}, 'whatsapp',
      ${delivery === 'wrong-destination' ? '+9990000000000' : initial.phone_e164}, ${randomUUID()},
      ${delivery === 'pending' ? 'pending' : 'submitted'},
      ${delivery === 'pending' || delivery === 'unproven' ? null : randomUUID()},
      ${delivery === 'pending' || delivery === 'unproven' ? null : message.created_at}::timestamptz)
  `;
  return message.id;
}

const fullRequest = 'Para dejarlo registrado necesito tu nombre, apellido y teléfono. ¿Me los pasás?';

run('contact identity from delivered conversational requests', () => {
  it('persists the Agus surname in the second message of one delivered intake request', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    const requestId = await outbound(first, opened,
      'Para llamarte necesito tu nombre, tu apellido y tu correo. El teléfono lo tengo como +5491132104399, es correcto?');
    const named = await processInboundMessage(answer(first, 'así es, mi nombre es Agus'));
    const surnameInput = answer(first, 'maneyro');
    const completed = await processInboundMessage(surnameInput);
    expect(completed.batch.id).toBe(named.batch.id);
    expect(completed.contact.name).toBe('Agus Maneyro');
    expect(await loadContactIntakeV1(completed.contact.id, db!))
      .toMatchObject({ nombre: 'Agus', apellido: 'Maneyro' });
    const [receipt] = await db!`SELECT metadata->'contact_intake_response_v1' AS capture FROM messages WHERE id=${named.turn_id}::uuid`;
    expect(receipt.capture).toMatchObject({ request_message_id: requestId, captured_fields: ['nombre'] });
    expect((await processInboundMessage({ ...surnameInput, trace_id: randomUUID() })).status).toBe('duplicate');
    expect((await db!`SELECT name FROM contacts WHERE id=${completed.contact.id}::uuid`)[0].name).toBe('Agus Maneyro');
  });

  it('continues a delivered request across bare first-name and surname messages', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    await processInboundMessage(answer(first, 'Agus'));
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus Maneyro');
  });

  it('does not treat a repeated first-name reply as the missing surname', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    await processInboundMessage(answer(first, 'Agus'));
    const repeated = await processInboundMessage(answer(first, 'Agus'));
    expect(repeated.contact.name).toBe('Agus');
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus Maneyro');
  });

  it('keeps name capture open across requested email and phone responses', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, 'Necesito tu nombre, apellido, correo y teléfono.');
    await processInboundMessage(answer(first, 'agus@example.com'));
    const phone = await processInboundMessage(answer(first, 'Mi teléfono es +15555550123'));
    expect(phone.contact.name).toBeNull();
    await processInboundMessage(answer(first, 'mi nombre es Agus'));
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus Maneyro');
  });

  it('does not keep the old intake request alive after a new delivered question', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    const named = await processInboundMessage(answer(first, 'mi nombre es Agus'));
    await outbound(first, named, 'Qué curso te interesa?');
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus');
  });

  it('closes a first-name-only request after the first name has been captured', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, 'Me pasas tu nombre?');
    await processInboundMessage(answer(first, 'Agus'));
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus');
  });

  it('closes the pending data request when an unrelated message interrupts its responses', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    await processInboundMessage(answer(first, 'mi nombre es Agus'));
    await processInboundMessage(answer(first, 'Cuánto cuesta?'));
    expect((await processInboundMessage(answer(first, 'maneyro'))).contact.name).toBe('Agus');
  });

  it('does not trust a caller-supplied receipt to reopen an answered intake request', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    const requestId = await outbound(first, opened, fullRequest);
    const unrelated = answer(first, '¿Cuánto cuesta?');
    unrelated.message.metadata = { contact_intake_response_v1: JSON.stringify({request_message_id: requestId, captured_fields: ['nombre']}) };
    await processInboundMessage(unrelated);
    expect((await processInboundMessage(answer(first, 'Agus Maneyro'))).contact.name).toBeNull();
  });

  it('does not replace a complete durable identity with a conversational reminder', async () => {
    const first = envelope();
    first.message.text = 'Me llamo Gustavo Fring, quiero el curso de alemán';
    const opened = await processInboundMessage(first);
    expect(opened.contact.name).toBe('Gustavo Fring');

    await outbound(first, opened, '¿Me confirmas tu nombre y apellido?');
    const reminded = await processInboundMessage(answer(first, 'ya te lo pasé'));

    expect(reminded.contact.name).toBe('Gustavo Fring');
    expect(await db!`SELECT name FROM contacts WHERE id = ${opened.contact.id}::uuid`)
      .toEqual([{ name: 'Gustavo Fring' }]);
  });

  it('preserves the durable surname when the customer corrects only the first name', async () => {
    const first = envelope();
    first.message.text = 'Me llamo Lucas Pierella';
    const opened = await processInboundMessage(first);
    expect(opened.contact.name).toBe('Lucas Pierella');

    const corrected = await processInboundMessage(answer(
      first,
      'Mentira, me confundí con mi nombre. Mi nombre es Luke',
    ));
    expect(corrected.contact.name).toBe('Luke Pierella');
    expect(await db!`SELECT name FROM contacts WHERE id = ${opened.contact.id}::uuid`)
      .toEqual([{ name: 'Luke Pierella' }]);
  });

  it('persists a surname stated after a payment-plan selection in the same Telegram turn', async () => {
    const first = envelope();
    first.message.text = 'Me llamo Luke';
    const opened = await processInboundMessage(first);

    const completed = await processInboundMessage(answer(
      first,
      '1 pago\n\nPierella mi apellido',
    ));

    expect(completed.contact.name).toBe('Luke Pierella');
    expect(await db!`SELECT name FROM contacts WHERE id = ${opened.contact.id}::uuid`)
      .toEqual([{ name: 'Luke Pierella' }]);
  });

  it('persists a repeated natural full-name answer instead of asking for the surname again', async () => {
    const first = envelope();
    first.message.text = 'Me llamo Luke';
    const opened = await processInboundMessage(first);
    await outbound(first, opened, 'Me confirmas tu nombre y apellido?');

    const completed = await processInboundMessage(answer(first, 'Luke Pierella, ya te dije'));
    expect(completed.contact.name).toBe('Luke Pierella');
    expect(await db!`SELECT name FROM contacts WHERE id = ${opened.contact.id}::uuid`)
      .toEqual([{ name: 'Luke Pierella' }]);
  });

  it('persists a leading first name when the same turn continues with the study goal', async () => {
    const first = envelope();
    first.message.text = 'Thiago. Busco algo de tecnología para conseguir trabajo';
    const accepted = await processInboundMessage(first);
    expect(accepted.contact.name).toBe('Thiago');
    expect(await db!`SELECT name FROM contacts WHERE id = ${accepted.contact.id}::uuid`)
      .toEqual([{ name: 'Thiago' }]);
  });

  it('persists the exact Telegram identity sequence before the commercial call offer', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(
      first,
      opened,
      'Para orientarte mejor, si me dices tu primer nombre puedo ayudarte. ¿Qué te gustaría estudiar?',
    );
    const named = await processInboundMessage(answer(first, 'Thiago, queria saber como se paga el curso'));
    expect(named.contact.name).toBe('Thiago');

    await outbound(first, named, 'Para enviarte el link necesito tu apellido, correo y teléfono.');
    const completed = await processInboundMessage(answer(
      first,
      'Maneyro\n[Tmaneyro@gmail.com](mailto:Tmaneyro@gmail.com)\n[1169004497](tel:1169004497)',
    ));
    expect(completed.contact.name).toBe('Thiago Maneyro');
    expect(await db!`
      SELECT name, email, declared_phone FROM contacts WHERE id = ${completed.contact.id}::uuid
    `).toEqual([{ name: 'Thiago Maneyro', email: 'Tmaneyro@gmail.com', declared_phone: '1169004497' }]);
  });

  it('persists a full name and Markdown phone from the answer, independent of awaiting_reply and email', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    const requestId = await outbound(first, opened, fullRequest);
    const input = answer(first, 'Lucía Ríos [+1 305 555 0168](tel:+13055550168) \n\nCuanto sale?');
    const accepted = await processInboundMessage(input);
    expect(accepted.contact.name).toBe('Lucía Ríos');
    expect(await db!`SELECT name, email, declared_phone FROM contacts WHERE id = ${accepted.contact.id}::uuid`)
      .toEqual([{ name: 'Lucía Ríos', email: null, declared_phone: '+13055550168' }]);
    const rows = await db!`SELECT metadata->'contact_name_answer_v1' AS captured FROM messages WHERE id = ${accepted.turn_id}::uuid`;
    expect(rows[0].captured).toMatchObject({ request_message_id: requestId, first_name: 'Lucía', surname: 'Ríos' });
    expect((await processInboundMessage({ ...input, trace_id: randomUUID() })).status).toBe('duplicate');
  });

  it('keeps a requested surname as a partial field and combines the later requested first name', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, 'Me falta tu apellido. ¿Me lo pasás?');
    const surname = await processInboundMessage(answer(first, 'Ríos'));
    expect(surname.contact.name).toBeNull();
    await outbound(first, surname, 'Para completar el registro necesito tu nombre.');
    const completed = await processInboundMessage(answer(first, 'Lucía'));
    expect(completed.contact.name).toBe('Lucía Ríos');
  });

  it('combines a requested first name followed by a requested surname', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, '¿Me pasás tu nombre?');
    const firstName = await processInboundMessage(answer(first, 'Franco'));
    expect(firstName.contact.name).toBe('Franco');
    await outbound(first, firstName, '¿Me pasás tu apellido?');
    const completed = await processInboundMessage(answer(first, 'Le Blanc'));
    expect(completed.contact.name).toBe('Franco Le Blanc');
  });

  it('preserves the complete first-name field when the requested surname arrives later', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, '¿Me pasás tu nombre?');
    const firstName = await processInboundMessage(answer(first, 'Ana María'));
    expect(firstName.contact.name).toBeNull();
    await outbound(first, firstName, '¿Me pasás tu apellido?');
    expect((await processInboundMessage(answer(first, 'Ríos'))).contact.name).toBe('Ana María Ríos');
  });

  it.each(['No soy Lucía Ríos', 'Mi hermana dice: soy Lucía Ríos'])(
    'does not override contextual rejection with a negated or third-party introduction: %s', async text => {
      const first = envelope();
      const opened = await processInboundMessage(first);
      await outbound(first, opened, fullRequest);
      expect((await processInboundMessage(answer(first, text))).contact.name).toBeNull();
    });

  it.each(['pending', 'missing', 'unproven', 'wrong-destination'] as const)(
    'does not capture from a request whose delivery is %s', async delivery => {
      const first = envelope();
      const opened = await processInboundMessage(first);
      await outbound(first, opened, fullRequest, delivery);
      expect((await processInboundMessage(answer(first, 'Lucía Ríos'))).contact.name).toBeNull();
    });

  // Authority line 191: a local phone never authorizes the backend to infer
  // country/mobile prefixes, even when that inferred candidate was delivered.
  it('rejects a delivered assistant expansion of a customer local number', async () => {
    const first = envelope();
    first.message.text = 'Mi teléfono es 1155550101';
    const opened = await processInboundMessage(first);
    await outbound(first, opened, 'El número completo es +54 9 11 5555 0101?');
    const current = await processInboundMessage(answer(first, 'Si'));
    expect(await confirmDeliveredContactPhone({ turnId: current.turn_id, phone: '+5491155550101' }, db!)).toBe(false);
    expect((await db!`SELECT declared_phone FROM contacts WHERE id=${opened.contact.id}::uuid`)[0].declared_phone)
      .toBe('1155550101');
  });

  it('uses the last sent response, not an older identity request already answered', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    const intervening = await processInboundMessage(answer(first, '¿Cuánto cuesta?'));
    await outbound(first, intervening, '¿Qué curso te interesa?');
    expect((await processInboundMessage(answer(first, 'Lucía Ríos'))).contact.name).toBeNull();
  });

  it('does not reuse a request after an intervening inbound even without a newer outbound', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    await processInboundMessage(answer(first, '¿Cuánto cuesta?'));
    expect((await processInboundMessage(answer(first, 'Lucía Ríos'))).contact.name).toBeNull();
  });

  it('does not borrow a delivered request from another channel conversation', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    expect((await processInboundMessage({ ...answer(first, 'Lucía Ríos'),
      external_conversation_id: `another-${randomUUID()}` })).contact.name).toBeNull();
  });

  it('does not treat a request delivered after the customer timestamp as causal', async () => {
    const first = envelope();
    const opened = await processInboundMessage(first);
    await outbound(first, opened, fullRequest);
    const late = answer(first, 'Lucía Ríos');
    late.message.occurred_at = new Date(Date.now() - 60_000).toISOString();
    expect((await processInboundMessage(late)).contact.name).toBeNull();
  });

  it('does not trust caller metadata as a previously captured surname', async () => {
    const first = envelope();
    first.message.metadata = { contact_name_answer_v1: JSON.stringify({ first_name: null, surname: 'Ríos' }) };
    const opened = await processInboundMessage(first);
    await outbound(first, opened, '¿Me pasás tu nombre?');
    expect((await processInboundMessage(answer(first, 'Lucía'))).contact.name).toBe('Lucía');
  });
});

run('confirmed phone delivery provenance', () => {
  it('accepts an already recorded full number without fabricating a confirmation source', async () => {
    const first = envelope();
    first.message.text = 'Mi teléfono es +54 9 11 5555 0101';
    const current = await processInboundMessage(first);
    expect(await confirmDeliveredContactPhone({ turnId: current.turn_id, phone: '+5491155550101' }, db!)).toBe(true);
    expect((await db!`SELECT declared_phone FROM contacts WHERE id=${current.contact.id}::uuid`)[0].declared_phone)
      .toBe('+5491155550101');
    expect((await db!`SELECT metadata->'confirmed_phone_v1' AS proof FROM messages WHERE id=${current.turn_id}::uuid`)[0].proof)
      .toBeNull();
    expect(await confirmDeliveredContactPhone({ turnId: current.turn_id, phone: '+5491155550102' }, db!)).toBe(false);
  });

  it.each(['pending', 'missing', 'unproven', 'wrong-destination'] as const)(
    'rejects a phone suggestion with %s delivery', async delivery => {
      const first = envelope();
      first.message.text = 'Mi teléfono es 1155550101';
      const opened = await processInboundMessage(first);
      await outbound(first, opened, 'El número completo es +54 9 11 5555 0101?', delivery);
      const current = await processInboundMessage(answer(first, 'Si'));
      expect(await confirmDeliveredContactPhone({ turnId: current.turn_id, phone: '+5491155550101' }, db!)).toBe(false);
      expect((await db!`SELECT declared_phone FROM contacts WHERE id=${opened.contact.id}::uuid`)[0].declared_phone).toBe('1155550101');
    });

  it.each(['different-number', 'stale-suggestion', 'foreign-conversation'] as const)(
    'rejects %s instead of trusting the model value', async scenario => {
      const first = envelope();
      first.message.text = 'Mi teléfono es 1155550101';
      const opened = await processInboundMessage(first);
      if (scenario === 'foreign-conversation') {
        const foreign = envelope();
        const foreignContext = await processInboundMessage(foreign);
        await outbound(foreign, foreignContext, 'El número completo es +54 9 11 5555 0101?');
      } else {
        await outbound(first, opened, scenario === 'different-number'
          ? 'El número completo es +54 9 11 5555 0102?' : 'El número completo es +54 9 11 5555 0101?');
      }
      if (scenario === 'stale-suggestion') {
        const intervening = await processInboundMessage(answer(first, 'Quiero otro curso'));
        await outbound(first, intervening, 'Qué curso te interesa ahora?');
      }
      const current = await processInboundMessage(answer(first, 'Si'));
      expect(await confirmDeliveredContactPhone({ turnId: current.turn_id,
        phone: scenario === 'different-number' ? '+5491155550102' : '+5491155550101' }, db!)).toBe(false);
    });

  it('records the exact source and rolls back the contact update with its surrounding commit', async () => {
    const first = envelope();
    first.identity_owner = 'agent_a_v1';
    first.message.text = 'Mi teléfono es +54 9 11 5555 0101';
    const opened = await processInboundMessage(first);
    const beforeProfile = await loadContactProfileV1(opened.contact.id, db!);
    expect(beforeProfile).not.toBeNull();
    const source = await outbound(first, opened, 'El número completo es +54 9 11 5555 0101?');
    const current = await processInboundMessage(answer(first, 'Si'));
    await expect(db!.begin(async tx => {
      expect(await confirmDeliveredContactPhone({ turnId: current.turn_id, phone: '+5491155550101' }, tx)).toBe(true);
      const inTransaction = await loadContactProfileV1(opened.contact.id, tx);
      expect(inTransaction).toMatchObject({
        version: beforeProfile!.version + 1,
        fields: {
          telefono: {
            value: '+5491155550101',
            source_message_id: current.turn_id,
            confirmation_evidence: {
              kind: 'delivered_phone_confirmation_v1',
              suggested_message_id: source,
            },
          },
        },
      });
      expect((await tx`SELECT metadata->'confirmed_phone_v1' AS proof FROM messages WHERE id=${current.turn_id}::uuid`)[0].proof)
        .toEqual({ phone: '+5491155550101', source_message_id: source });
      throw new Error('remaining proposal rejected');
    })).rejects.toThrow('remaining proposal rejected');
    expect(await loadContactProfileV1(opened.contact.id, db!)).toEqual(beforeProfile);
    expect((await db!`SELECT declared_phone FROM contacts WHERE id=${opened.contact.id}::uuid`)[0].declared_phone).toBeNull();
    expect((await db!`SELECT metadata->'confirmed_phone_v1' AS proof FROM messages WHERE id=${current.turn_id}::uuid`)[0].proof)
      .toBeNull();
  });
});
