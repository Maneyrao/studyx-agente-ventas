import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { ensureAgentOwnedContactProfileV1, loadContactProfileV1, applyContactProfileUpdatesV1 } from '@/lib/repositories/contact-profile.repository';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { loadContactProfileContextV1 } from '@/lib/repositories/contact-profile-context.repository';
import { PostgresRetellContactToolStore } from '@/features/calls/adapters/postgres-retell-tools';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { prepareContactDetailsToolV1, preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import { registerMessage } from '@/lib/services/message.service';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';
import { loadCallIntakeReadinessV1 } from '@/lib/repositories/call-intake-readiness.repository';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); await sql.end(); });

async function fixture() {
  const seeded = await seedConversationForAgentTurn({ intake_complete: true, selected_offering_code: 'entrenamiento_funcional' });
  await withSerializableTransactionOn(db!, tx => ensureAgentOwnedContactProfileV1(seeded.contact_id, tx));
  const callId = randomUUID();
  const context = { call_id: callId, nombre_lead: 'Ana Pérez', curso_interes: 'entrenamiento_funcional',
    pais: 'AR', email_lead: 'before@example.test', resumen_whatsapp: '', prompt_version: 'agent-b-v1' };
  await db!`INSERT INTO call_sessions (id, source_turn_id, contact_id, conversation_id, workspace_id,
    provider, provider_call_id, request_idempotency_key, status, consent_source_message_id,
    context_snapshot, context_hash, prompt_version)
    VALUES (${callId}::uuid, ${seeded.turn_id}::uuid, ${seeded.contact_id}::uuid, ${seeded.conversation_id}::uuid,
      ${seeded.workspace_id}::uuid, 'retell', ${`retell:${callId}`}, ${`profile-call:${callId}`}, 'provider_accepted',
      ${seeded.turn_id}::uuid, ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1')`;
  return { ...seeded, callId };
}

run('canonical contact profile external writers', () => {
  it('promotes an identical voice email only when the customer types it in WhatsApp', async () => {
    const f = await fixture();
    const voiceEmail = 'voice-then-whatsapp@example.test';
    await new PostgresRetellContactToolStore(db!).saveCorrelatedContact({
      callId: f.callId,
      workspaceSlug: 'studyx',
      email: voiceEmail,
      sheets: null,
    });
    await db!`UPDATE conversations SET channel = 'whatsapp' WHERE id = ${f.conversation_id}::uuid`;

    const before = await loadContactProfileV1(f.contact_id, db!);
    expect(await loadCallIntakeReadinessV1(f.contact_id, f.conversation_id, db!)).toMatchObject({
      status: 'needs_input',
      requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
    });

    const [transport] = await db!<Array<{ payload: InboundEnvelope }>>`
      SELECT e.payload FROM messages m JOIN channel_events e ON e.id = m.source_event_id
      WHERE m.id = ${f.second_turn_id}::uuid
    `;
    const inbound = await processInboundMessage({
      ...transport.payload,
      channel: 'whatsapp',
      identity_owner: 'agent_a_v1',
      external_message_id: randomUUID(),
      trace_id: randomUUID(),
      message: {
        ...transport.payload.message,
        text: voiceEmail,
        type: 'text',
        occurred_at: new Date().toISOString(),
      },
    });
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${inbound.batch.id}::uuid`;
    const [claim] = await db!<Array<{ outcome: string; claim_token: string }>>`
      SELECT outcome, claim_token FROM claim_inbound_batch(${inbound.batch.id}::uuid, 'voice-email-promotion', 120000)
    `;
    expect(claim.outcome).toBe('claimed');

    const receipt = await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, {
      turn_id: f.second_turn_id,
      batch_id: inbound.batch.id,
      claim_token: claim.claim_token,
      expected_version: before!.version,
      updates: [{
        field: 'correo',
        value: voiceEmail,
        operation: 'set',
        source_message_id: inbound.turn_id,
        source_quote: voiceEmail,
      }],
    }));

    expect(receipt.accepted_fields).toEqual(['correo']);
    expect(receipt.version).toBe(before!.version + 1);
    const promotedEmail = (await loadContactProfileV1(f.contact_id, db!))?.fields.correo;
    expect(promotedEmail).toMatchObject({
      value: voiceEmail,
      source: 'agent_a_v1',
      source_message_id: inbound.turn_id,
    });
    expect(promotedEmail).not.toHaveProperty('voice_evidence');
    expect(await loadCallIntakeReadinessV1(f.contact_id, f.conversation_id, db!)).toMatchObject({
      status: 'ready',
      requirements: [],
    });

    const replay = await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, {
      turn_id: f.second_turn_id,
      batch_id: inbound.batch.id,
      claim_token: claim.claim_token,
      expected_version: before!.version,
      updates: [{ field: 'correo', value: voiceEmail, operation: 'set',
        source_message_id: inbound.turn_id, source_quote: voiceEmail }],
    }));
    expect(replay).toEqual(receipt);
    expect((await loadContactProfileV1(f.contact_id, db!))?.version).toBe(before!.version + 1);
  });

  it('resolves a delivered email clarification after a correlated voice observation before the next inbound', async () => {
    const f = await fixture();
    const [transport] = await db!<Array<{ provider: string; integration_id: string; phone: string; payload: InboundEnvelope }>>`
      SELECT e.provider, e.integration_id, c.phone, e.payload FROM messages m
      JOIN channel_events e ON e.id = m.source_event_id JOIN contacts c ON c.id = m.contact_id
      WHERE m.id = ${f.second_turn_id}::uuid
    `;
    const finish = async (batchId: string) => {
      await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${batchId}::uuid`;
      const [claim] = await db!<Array<{ outcome: string; claim_token: string }>>`
        SELECT outcome, claim_token FROM claim_inbound_batch(${batchId}::uuid, 'clarification-context', 120000)
      `;
      expect(claim.outcome).toBe('claimed');
      await db!`SELECT * FROM complete_inbound_batch(${batchId}::uuid, ${claim.claim_token}::uuid)`;
    };
    const inbound = (text: string) => processInboundMessage({ ...transport.payload, channel: 'whatsapp',
      identity_owner: 'agent_a_v1', external_message_id: randomUUID(), trace_id: randomUUID(),
      message: { ...transport.payload.message, text, occurred_at: new Date().toISOString() } });
    await finish(f.second_batch_id);
    const { message: question } = await registerMessage({ conversation_id: f.conversation_id,
      direction: 'outbound', content: '¿Cuál es tu correo correcto?', in_reply_to: f.second_turn_id,
      metadata: { contact_profile_requests_v1: [{ fields: ['correo'], purpose: 'identity', mode: 'clarify' }] },
    }, { db: db!, embedding: 'skip' });
    await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
      channel, destination, idempotency_key, state, provider_message_id, submitted_at)
      VALUES (${question.id}::uuid, ${f.conversation_id}::uuid, ${f.contact_id}::uuid, ${transport.provider},
        ${transport.integration_id}, 'whatsapp', ${transport.phone}, ${randomUUID()}, 'submitted', ${randomUUID()}, now())`;
    // Provider timestamps have millisecond precision; PostgreSQL delivery
    // timestamps retain microseconds. Let this simulated reaction happen in
    // a later clock tick than the completed physical delivery.
    await new Promise(resolve => setTimeout(resolve, 2));
    const beforeVoice = await inbound('¿Cuál tenés registrado?');
    expect(beforeVoice.conversation_id).toBe(f.conversation_id);
    const pending = await loadContactProfileContextV1({ contactId: f.contact_id,
      conversationId: f.conversation_id, batchId: beforeVoice.batch.id }, db!);
    expect(pending?.pending_requests).toContainEqual({ message_id: question.id,
      fields: ['correo'], purpose: 'identity', mode: 'clarify' });
    await finish(beforeVoice.batch.id);
    expect(await new PostgresRetellContactToolStore(db!).saveCorrelatedContact({ callId: f.callId,
      workspaceSlug: 'studyx', email: 'clarified-by-voice@example.test', sheets: null })).toMatchObject({ updated: true });
    const profile = await loadContactProfileV1(f.contact_id, db!);
    expect(profile?.fields.correo.source_message_id).toBeNull();
    expect(profile?.fields.correo.voice_evidence?.call_id).toBe(f.callId);
    const afterVoice = await inbound('Gracias');
    const context = await loadContactProfileContextV1({ contactId: f.contact_id,
      conversationId: f.conversation_id, batchId: afterVoice.batch.id }, db!);
    expect(context?.sources.map(source => source.id)).toContain(afterVoice.turn_id);
    expect(context?.pending_requests).not.toContainEqual({ message_id: question.id,
      fields: ['correo'], purpose: 'identity', mode: 'clarify' });
    expect((await loadContactIntakeV1(f.contact_id, db!)).correo).toBe('clarified-by-voice@example.test');
  });

  it('preserves typed compound first names and independent surnames from correlated voice tools', async () => {
    const f = await fixture();
    const store = new PostgresRetellContactToolStore(db!);
    const request = { callId: f.callId, workspaceSlug: 'studyx', nombre: 'Ana María', apellido: 'de la Croix',
      email: 'voice@example.test', sheets: null };
    expect(await store.saveCorrelatedContact(request)).toMatchObject({ updated: true });
    expect(await loadContactIntakeV1(f.contact_id, db!)).toMatchObject({ nombre: 'Ana María', apellido: 'de la Croix', correo: 'voice@example.test' });
    const profile = await loadContactProfileV1(f.contact_id, db!);
    expect(profile?.fields.correo).toMatchObject({ source: 'legacy', source_message_id: null,
      source_quote: null, voice_evidence: { kind: 'retell_tool', call_id: f.callId } });
    expect((await db!`SELECT name, email FROM contacts WHERE id = ${f.contact_id}::uuid`)[0])
      .toEqual({ name: 'Ana María de la Croix', email: 'voice@example.test' });
    expect(await store.saveCorrelatedContact(request)).toMatchObject({ updated: false });
    expect((await loadContactProfileV1(f.contact_id, db!))?.version).toBe(profile?.version);
  });

  it('persists a correlated analysis email without depending on Sheets and records its immutable call event', async () => {
    const f = await fixture();
    const eventId = `retell:webhook:profile:${randomUUID()}`;
    const event = { schema_version: 1 as const, call_id: f.callId, provider: 'retell' as const,
      event_id: eventId, event_type: 'analyzed' as const, sequence: 3, occurred_at: new Date().toISOString(),
      payload: { event_type: 'analyzed' as const, analysis: { result: 'seguimiento_agendado' as const,
        nivel_interes: null, objecion: null, notas: null, email_capturado: 'analysis@example.test' } } };
    const store = new PostgresCallStore(db!);
    expect(await store.appendEvent(event)).toBe('recorded');
    expect((await loadContactIntakeV1(f.contact_id, db!)).correo).toBe('analysis@example.test');
    const profile = await loadContactProfileV1(f.contact_id, db!);
    expect(profile?.fields.correo).toMatchObject({ source: 'legacy', source_message_id: null,
      voice_evidence: { kind: 'retell_analysis', call_id: f.callId, event_key: eventId } });
    const [stored] = await db!`SELECT id FROM call_events WHERE call_id = ${f.callId}::uuid AND event_id = ${eventId}`;
    expect(profile?.fields.correo.voice_evidence?.source_call_event_id).toBe(stored.id);
    expect(await store.appendEvent(event)).toBe('duplicate');
    expect((await loadContactProfileV1(f.contact_id, db!))?.version).toBe(profile?.version);
  });

  it('keeps a newer chat correction when delayed call analysis carries an older observation', async () => {
    const f = await fixture();
    await db!`UPDATE messages SET content = 'chat@example.test' WHERE id = ${f.turn_id}::uuid`;
    const beforeCorrection = await loadContactProfileV1(f.contact_id, db!);
    await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, {
      turn_id: f.turn_id, batch_id: f.batch_id, claim_token: f.claim_token,
      expected_version: beforeCorrection!.version,
      updates: [{ field: 'correo', value: 'chat@example.test', operation: 'correct', source_message_id: f.turn_id, source_quote: 'chat@example.test' }],
    }));
    await new PostgresCallStore(db!).appendEvent({ schema_version: 1, call_id: f.callId, provider: 'retell',
      event_id: `retell:webhook:profile-stale:${randomUUID()}`, event_type: 'analyzed', sequence: 3,
      occurred_at: '2020-01-01T00:00:00Z', payload: { event_type: 'analyzed',
        analysis: { result: 'seguimiento_agendado', nivel_interes: null, objecion: null, notas: null, email_capturado: 'old@example.test' } } });
    expect((await loadContactIntakeV1(f.contact_id, db!)).correo).toBe('chat@example.test');
    expect((await db!`SELECT email FROM contacts WHERE id = ${f.contact_id}::uuid`)[0].email).toBe('chat@example.test');
  });

  it('preserves a chat correction during a call when its untimed analysis arrives after that correction', async () => {
    const f = await fixture();
    const { message } = await registerMessage({ conversation_id: f.conversation_id, direction: 'inbound',
      content: 'during@example.test', metadata: { message_type: 'text' } }, { db: db!, embedding: 'skip' });
    const token = randomUUID();
    await db!`UPDATE messages SET conversation_seq = 3, batch_id = ${f.second_batch_id}::uuid WHERE id = ${message.id}::uuid`;
    await db!`UPDATE inbound_batches SET state = 'claimed', claim_token = ${token}::uuid,
      representative_turn_id = ${message.id}::uuid, claimed_by = 'during-call', claimed_at = now(), lease_until = now() + interval '5 minutes'
      WHERE id = ${f.second_batch_id}::uuid`;
    const beforeCorrection = await loadContactProfileV1(f.contact_id, db!);
    await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, {
      turn_id: message.id, batch_id: f.second_batch_id, claim_token: token,
      expected_version: beforeCorrection!.version,
      updates: [{ field: 'correo', value: 'during@example.test', operation: 'correct', source_message_id: message.id, source_quote: 'during@example.test' }],
    }));
    await new PostgresCallStore(db!).appendEvent({ schema_version: 1, call_id: f.callId, provider: 'retell',
      event_id: `retell:webhook:profile-real-late:${randomUUID()}`, event_type: 'analyzed', sequence: 3,
      occurred_at: new Date().toISOString(), payload: { event_type: 'analyzed', analysis: { result: 'seguimiento_agendado',
        nivel_interes: null, objecion: null, notas: null, email_capturado: 'earlier-in-call@example.test' } } });
    expect((await loadContactIntakeV1(f.contact_id, db!)).correo).toBe('during@example.test');
  });

  it('refuses V3 prepared identity writes for an owned canonical profile with a structured rejection', async () => {
    const f = await fixture();
    const preparation = await prepareContactDetailsToolV1({ db: db!, turn_id: f.turn_id,
      conversation_id: f.conversation_id, contact_id: f.contact_id }, { first_name: 'Other', last_name: 'Person' });
    await expect(commitAgentTurnV3(db!, { turn_id: f.turn_id, trace_id: randomUUID(),
      effective_prompt_sha256: f.release_manifest.prompt_sha256, release_manifest: f.release_manifest,
      decision: { schema_version: 3, blocks: [{ type: 'narrative', text: 'Guardado.' }],
        commit_preparations: [preparation.preparation_id!], used_memory_ids: [],
        state_patch: { expected_state_version: f.state_version, set: {} }, response_type: 'commercial_reply' } }))
      .rejects.toMatchObject({ rejection: { violations: [{ code: 'CONTACT_PROFILE_CANONICAL_READ_ONLY', subject: 'commit_preparations' }] } });
    expect((await loadContactIntakeV1(f.contact_id, db!)).nombre).toBe('Ana');
    expect((await db!`SELECT count(*)::integer AS count FROM agent_decisions WHERE turn_id = ${f.turn_id}::uuid`)[0].count).toBe(0);
  });

  it('keeps V3 payment authorization incomplete when a compound first name has no canonical surname', async () => {
    const f = await fixture();
    await new PostgresRetellContactToolStore(db!).saveCorrelatedContact({ callId: f.callId, workspaceSlug: 'studyx', nombre: 'Ana María', sheets: null });
    const beforeRetraction = await loadContactProfileV1(f.contact_id, db!);
    await withSerializableTransactionOn(db!, tx => applyContactProfileUpdatesV1(tx, { turn_id: f.turn_id,
      batch_id: f.batch_id, claim_token: f.claim_token, expected_version: beforeRetraction!.version,
      updates: [{ field: 'apellido', value: null, operation: 'retract', source_message_id: f.turn_id, source_quote: 'Hola' }] }));
    expect((await loadContactIntakeV1(f.contact_id, db!)).apellido).toBeNull();
    const preparation = await preparePaymentLinkToolV1({ db: db!, turn_id: f.turn_id, conversation_id: f.conversation_id },
      { offering_code: 'entrenamiento_funcional', payment_plan: 'one_time' },
      { resolver: { resolve: () => 'https://buy.stripe.com/test_example' } });
    expect(preparation.success).toBe(true);
    await expect(commitAgentTurnV3(db!, { turn_id: f.turn_id, trace_id: randomUUID(),
      effective_prompt_sha256: f.release_manifest.prompt_sha256, release_manifest: f.release_manifest,
      decision: { schema_version: 3, blocks: [{ type: 'narrative', text: 'Pago.' }, { type: 'artifact', preparation_id: preparation.preparation_id! }],
        commit_preparations: [preparation.preparation_id!], used_memory_ids: [],
        state_patch: { expected_state_version: f.state_version, set: { stage: 'payment_link_sent', selected_payment_plan: 'one_time' } }, response_type: 'commercial_reply' } }))
      .rejects.toMatchObject({ rejection: { violations: [{ code: 'MISSING_INTAKE' }] } });
  });
});
