import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  processInboundMessage,
  ChannelIdentityConflictError,
  IdempotencyConflictError,
  type InboundEnvelope,
} from '@/lib/services/ingestion.service';
import {
  commitAgentDecision,
  DecisionConflictError,
  recordDeliveryReport,
  DeliveryReportConflictError,
} from '@/lib/services/decision.service';
import { sql } from '@/lib/db/orchestrator';
import { getRecentMessages } from '@/lib/services/memory.service';

const databaseInspection = process.env.TEST_DATABASE_URL;
const run = databaseInspection ? describe : describe.skip;
const db = databaseInspection ? openLocalTestDatabase() : null;

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-emulator',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Quiero conocer el precio del curso de ventas',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
    ...overrides,
  };
}

function reply(turnId: string, traceId = randomUUID(), content = 'El curso cuesta 100 pesos') {
  return {
    turn_id: turnId,
    trace_id: traceId,
    decision: {
      schema_version: 2 as const,
      intent: 'commercial' as const,
      kind: 'reply' as const,
      response: content,
      response_type: 'commercial_reply' as const,
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed' as const,
      reason_code: 'ANSWER_PRICE',
      confidence: 0.92,
    },
    model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v1' },
  };
}

afterAll(async () => {
  await db?.end();
  await sql.end();
});

run('canonical orchestration lifecycle', () => {
  it('deduplicates inbound, decision and delivery without changing canonical IDs', async () => {
    const inbound = envelope();
    const first = await processInboundMessage(inbound);
    const replay = await processInboundMessage({ ...inbound, trace_id: randomUUID() });

    expect(first.status).toBe('accepted');
    expect(replay.status).toBe('duplicate');
    expect(replay.turn_id).toBe(first.turn_id);
    expect(replay.conversation_id).toBe(first.conversation_id);

    const decisionInput = reply(first.turn_id);
    const decision = await commitAgentDecision(decisionInput);
    const decisionReplay = await commitAgentDecision({ ...decisionInput, trace_id: randomUUID() });
    expect(decision.status).toBe('committed');
    expect(decisionReplay.status).toBe('duplicate');
    expect(decisionReplay.decision_id).toBe(decision.decision_id);
    expect(decisionReplay.outbound?.id).toBe(decision.outbound?.id);

    const decidedInboundReplay = await processInboundMessage({ ...inbound, trace_id: randomUUID() });
    expect(decidedInboundReplay.existing_result).toMatchObject({
      decision_id: decision.decision_id,
      outbound_id: decision.outbound?.id,
      next_state: 'completed',
    });

    const outboundId = decision.outbound!.id;
    const report = {
      outbound_id: outboundId,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress' as const,
      botpress_message_id: `bp-${randomUUID()}`,
      replayed: false,
      error_code: null,
    };
    expect((await recordDeliveryReport(report)).status).toBe('recorded');
    expect((await recordDeliveryReport({ ...report, trace_id: randomUUID(), replayed: true })).status).toBe('duplicate');

    const counts = await db!<Array<{ events: number; messages: number; decisions: number; deliveries: number }>>`
      SELECT
        (SELECT count(*)::integer FROM channel_events WHERE external_message_id = ${inbound.external_message_id}) AS events,
        (SELECT count(*)::integer FROM messages WHERE source_event_id IS NOT NULL AND id = ${first.turn_id}::uuid) AS messages,
        (SELECT count(*)::integer FROM agent_decisions WHERE turn_id = ${first.turn_id}::uuid) AS decisions,
        (SELECT count(*)::integer FROM outbound_deliveries WHERE message_id = ${outboundId}::uuid) AS deliveries
    `;
    expect(counts[0]).toEqual({ events: 1, messages: 1, decisions: 1, deliveries: 1 });
  });

  it('rejects identity reuse with changed inbound or decision payload', async () => {
    const inbound = envelope();
    const accepted = await processInboundMessage(inbound);
    await expect(processInboundMessage({
      ...inbound,
      message: { ...inbound.message, text: 'Contenido distinto' },
    })).rejects.toBeInstanceOf(IdempotencyConflictError);

    const firstDecision = reply(accepted.turn_id);
    await commitAgentDecision(firstDecision);
    await expect(commitAgentDecision(reply(accepted.turn_id, randomUUID(), 'Otra respuesta')))
      .rejects.toBeInstanceOf(DecisionConflictError);
  });

  it('collapses simultaneous identical decisions into one commit and one duplicate', async () => {
    const accepted = await processInboundMessage(envelope());
    const input = reply(accepted.turn_id);
    const results = await Promise.all([
      commitAgentDecision(input),
      commitAgentDecision(input),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['committed', 'duplicate']);
    expect(new Set(results.map((result) => result.decision_id)).size).toBe(1);
    expect(new Set(results.map((result) => result.outbound?.id)).size).toBe(1);
  });

  it('returns one conflict for simultaneous decisions with different payloads', async () => {
    const accepted = await processInboundMessage(envelope());
    const results = await Promise.allSettled([
      commitAgentDecision(reply(accepted.turn_id, randomUUID(), 'Primera respuesta')),
      commitAgentDecision(reply(accepted.turn_id, randomUUID(), 'Segunda respuesta')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(DecisionConflictError) });
  });

  it('persists every immutable Decision v2 field', async () => {
    const accepted = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'Prefiero cursar de noche',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    const committed = await commitAgentDecision({
      ...reply(accepted.turn_id),
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'clarify',
        response: '¿Qué curso querés hacer de noche?',
        response_type: 'clarification',
        confidence: 0.84,
        reason_code: 'MISSING_OFFERING',
        business_action: null,
        memory_candidates: [{
          type: 'preference',
          key: 'schedule',
          value: 'night',
          source_quote: 'Prefiero cursar de noche',
          confidence: 0.96,
        }],
        missing_information: ['offering'],
        next_state: 'waiting_user',
      },
    });

    const rows = await db!<Array<{
      schema_version: number;
      intent: string;
      decision_kind: string;
      response: string | null;
      response_type: string | null;
      business_action: unknown;
      memory_candidates: unknown;
      missing_information: string[];
      next_state: string;
      reason_code: string;
      confidence: number;
    }>>`
      SELECT
        schema_version, intent, decision_kind, response, response_type,
        business_action, memory_candidates, missing_information, next_state,
        reason_code, confidence
      FROM agent_decisions
      WHERE id = ${committed.decision_id}::uuid
    `;
    expect(rows[0]).toEqual({
      schema_version: 2,
      intent: 'commercial',
      decision_kind: 'clarify',
      response: '¿Qué curso querés hacer de noche?',
      response_type: 'clarification',
      business_action: null,
      memory_candidates: [{
        type: 'preference',
        key: 'schedule',
        value: 'night',
        source_quote: 'Prefiero cursar de noche',
        confidence: 0.96,
      }],
      missing_information: ['offering'],
      next_state: 'waiting_user',
      reason_code: 'MISSING_OFFERING',
      confidence: 0.84,
    });
  });

  it.each(['opt_out', 'human_request'] as const)(
    'rejects a direct %s insert with a null response type',
    async (intent) => {
      const accepted = await processInboundMessage(envelope());
      await expect(db!`
        INSERT INTO agent_decisions (
          turn_id, trace_id, schema_version, intent, decision_kind, response,
          response_type, business_action, memory_candidates, missing_information,
          next_state, reason_code, confidence, model_provider, model_name,
          prompt_version, payload_hash
        ) VALUES (
          ${accepted.turn_id}::uuid, ${randomUUID()}::uuid, 2, ${intent}, 'suppress', NULL,
          NULL, NULL, '[]'::jsonb, ARRAY[]::text[],
          ${intent === 'opt_out' ? 'completed' : 'waiting_user'}, 'DIRECT_INVALID', 1,
          'botpress', 'integration-test', 'v2', decode(${''.padStart(64, 'a')}, 'hex')
        )
      `).rejects.toMatchObject({ code: '23514' });
    }
  );

  it('prevents attaching an outbound message to a suppress decision', async () => {
    const accepted = await processInboundMessage(envelope());
    const suppressed = await commitAgentDecision({
      ...reply(accepted.turn_id),
      decision: {
        schema_version: 2,
        intent: 'unknown',
        kind: 'suppress',
        response: null,
        response_type: null,
        confidence: 1,
        reason_code: 'SUPPRESS_TEST',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
      },
    });
    const messages = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to)
      VALUES (
        ${accepted.conversation_id}::uuid,
        ${accepted.contact.id}::uuid,
        'outbound',
        'No debe adjuntarse',
        ${accepted.turn_id}::uuid
      )
      RETURNING id
    `;

    await expect(db!`
      UPDATE agent_decisions
      SET outbound_message_id = ${messages[0].id}::uuid
      WHERE id = ${suppressed.decision_id}::uuid
    `).rejects.toMatchObject({ code: '23514' });
  });

  it('distinguishes opt-out from commercial rejection and only permits an acknowledgement', async () => {
    const optOut = envelope({
      message: {
        type: 'text',
        text: 'No me escribas más',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const result = await processInboundMessage(optOut);
    expect(result.contact.consent_status).toBe('revoked');
    expect(result.policy.allowed_response_types).toEqual(['opt_out_ack']);

    await expect(commitAgentDecision(reply(result.turn_id))).rejects.toMatchObject({
      reason: 'CONSENT_REVOKED',
    });
    const acknowledgement = await commitAgentDecision({
      ...reply(result.turn_id),
      decision: {
        schema_version: 2,
        intent: 'opt_out',
        kind: 'reply',
        response: 'Entendido. No volveremos a contactarte.',
        response_type: 'opt_out_ack',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'OPT_OUT_CONFIRMED',
        confidence: 1,
      },
    });
    expect(acknowledgement.outbound?.status).toBe('pending');
  });

  it('fails closed for a blocked contact', async () => {
    const accepted = await processInboundMessage(envelope());
    await db!`
      UPDATE contacts
      SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'integration-test'
      WHERE id = ${accepted.contact.id}::uuid
    `;
    await expect(commitAgentDecision(reply(accepted.turn_id))).rejects.toMatchObject({
      reason: 'CONTACT_BLOCKED',
    });
  });

  it('never downgrades a submitted delivery after an ambiguous failure report', async () => {
    const accepted = await processInboundMessage(envelope());
    const decision = await commitAgentDecision(reply(accepted.turn_id));
    const outboundId = decision.outbound!.id;
    await recordDeliveryReport({
      outbound_id: outboundId,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${randomUUID()}`,
      replayed: false,
      error_code: null,
    });
    await expect(recordDeliveryReport({
      outbound_id: outboundId,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'AMBIGUOUS_NETWORK_FAILURE',
    })).rejects.toBeInstanceOf(DeliveryReportConflictError);
    const state = await db!<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries WHERE message_id = ${outboundId}::uuid
    `;
    expect(state[0].state).toBe('submitted');
  });

  it('rolls back a reserved provider event on a transaction failure', async () => {
    const externalId = `rollback-${randomUUID()}`;
    await expect(db!.begin(async (tx) => {
      await tx`
        SELECT * FROM reserve_inbound_channel_event(
          'botpress_emulator', 'vitest-emulator', 'whatsapp',
          ${externalId}, ${externalId}, ${externalId},
          decode(${''.padStart(64, 'a')}, 'hex'), '{}'::jsonb
        )
      `;
      throw new Error('FAILPOINT_AFTER_RESERVATION');
    })).rejects.toThrow('FAILPOINT_AFTER_RESERVATION');
    const rows = await db!`SELECT id FROM channel_events WHERE external_event_id = ${externalId}`;
    expect(rows).toHaveLength(0);
  });

  it('rejects a provider conversation rebound to a different phone and rolls the new event back', async () => {
    const firstEnvelope = envelope();
    await processInboundMessage(firstEnvelope);
    const conflicting = envelope({
      external_conversation_id: firstEnvelope.external_conversation_id,
    });
    await expect(processInboundMessage(conflicting)).rejects.toBeInstanceOf(ChannelIdentityConflictError);
    const events = await db!<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM channel_events
      WHERE external_message_id = ${conflicting.external_message_id}
    `;
    expect(events[0].count).toBe(0);
  });

  it('closes the previous provider thread and preserves one open conversation per contact/channel', async () => {
    const firstEnvelope = envelope();
    const first = await processInboundMessage(firstEnvelope);
    const second = await processInboundMessage(envelope({
      phone_e164: firstEnvelope.phone_e164,
    }));
    expect(second.conversation_id).not.toBe(first.conversation_id);
    const rows = await db!<Array<{ open_count: number; closed_count: number }>>`
      SELECT
        count(*) FILTER (WHERE status = 'open')::integer AS open_count,
        count(*) FILTER (WHERE status = 'closed')::integer AS closed_count
      FROM conversations
      WHERE contact_id = ${first.contact.id}::uuid AND channel = 'whatsapp'
    `;
    expect(rows[0].open_count).toBe(1);
    expect(rows[0].closed_count).toBeGreaterThanOrEqual(1);
  });

  it('accepts twenty rapid messages into one open provider conversation', async () => {
    const first = envelope();
    const inputs = Array.from({ length: 20 }, (_, index) => ({
      ...first,
      trace_id: randomUUID(),
      external_message_id: `${first.external_message_id}-${index}`,
      message: { ...first.message, text: `Consulta rápida número ${index}` },
    }));
    const results = await Promise.all(inputs.map(processInboundMessage));
    expect(new Set(results.map((result) => result.conversation_id)).size).toBe(1);
    expect(new Set(results.map((result) => result.turn_id)).size).toBe(20);
    const counts = await db!<Array<{ open_count: number; inbound_count: number }>>`
      SELECT
        (SELECT count(*)::integer FROM conversations
         WHERE contact_id = ${results[0].contact.id}::uuid AND channel = 'whatsapp' AND status = 'open') AS open_count,
        (SELECT count(*)::integer FROM messages
         WHERE conversation_id = ${results[0].conversation_id}::uuid AND direction = 'inbound') AS inbound_count
    `;
    expect(counts[0]).toEqual({ open_count: 1, inbound_count: 20 });
  });

  it('returns the last N messages in stable chronological order', async () => {
    const accepted = await processInboundMessage(envelope());
    await db!`
      INSERT INTO messages (conversation_id, contact_id, direction, content, created_at)
      SELECT
        ${accepted.conversation_id}::uuid,
        ${accepted.contact.id}::uuid,
        'inbound',
        'bulk-' || sequence::text,
        '2030-01-01T00:00:00Z'::timestamptz + make_interval(secs => sequence)
      FROM generate_series(1, 50) AS series(sequence)
    `;
    const recent = await getRecentMessages({ conversation_id: accepted.conversation_id, limit: 10 });
    expect(recent.messages.map((message) => message.content)).toEqual(
      Array.from({ length: 10 }, (_, index) => `bulk-${index + 41}`)
    );
  });

  it('commits inbound first and degrades safely when OpenAI memory is unavailable', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const input = envelope({
        message: {
          type: 'text',
          text: 'Como te dije antes, quiero retomar la compra',
          occurred_at: new Date().toISOString(),
          reply_to_external_message_id: null,
        },
      });
      const result = await processInboundMessage(input);
      expect(result.status).toBe('accepted');
      expect(result.context.long_term_memory).toBeNull();
      expect(result.context.long_term_memory_available).toBe(false);
      const persisted = await db!`SELECT id FROM messages WHERE id = ${result.turn_id}::uuid`;
      expect(persisted).toHaveLength(1);
    } finally {
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
    }
  });
});
