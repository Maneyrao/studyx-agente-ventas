import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import { sql } from '@/lib/db/orchestrator';
import { getRecentMessages } from '@/lib/services/memory.service';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  PostgresKnowledgeRetriever,
  PostgresMemoryRetriever,
} from '@/features/orchestration/adapters/postgres-retrievers';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { projectAgentAMemories } from '@/features/memory/application/project-agent-a-memories';
import { auditLog } from '@/lib/audit/logger';

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

function reply(turnId: string, traceId = randomUUID(), content = 'Te cuento las opciones disponibles') {
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

  it('binds every persisted outbound and its outbox payload to the same verified egress manifest', async () => {
    const accepted = await processInboundMessage(envelope());
    const committed = await commitAgentDecision(reply(accepted.turn_id));

    expect(committed.outbound?.authorized_egress).toBeDefined();
    expect(verifyAuthorizedEgress({
      content: committed.outbound!.content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });

    const rows = await db!<Array<{
      message_manifest: unknown;
      outbox_manifest: unknown;
    }>>`
      SELECT
        m.metadata -> 'authorized_egress' AS message_manifest,
        oe.payload -> 'authorized_egress' AS outbox_manifest
      FROM messages AS m
      JOIN outbound_deliveries AS od ON od.message_id = m.id
      JOIN outbox_events AS oe ON oe.delivery_id = od.id
      WHERE m.id = ${committed.outbound!.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].message_manifest).toEqual(committed.outbound!.authorized_egress);
    expect(rows[0].outbox_manifest).toEqual(committed.outbound!.authorized_egress);
  });

  it.each([
    ['an untyped URL', 'Mirá https://attacker.example/promo', 'EGRESS_UNAUTHORIZED_URL'],
  ])('rejects %s before persisting a decision or outbox', async (_case, content, reason) => {
    const accepted = await processInboundMessage(envelope());

    await expect(commitAgentDecision(reply(accepted.turn_id, randomUUID(), content)))
      .rejects.toMatchObject({ reason });

    const counts = await db!<Array<{ decisions: number; deliveries: number; outbox: number }>>`
      SELECT
        (SELECT count(*)::integer FROM agent_decisions WHERE turn_id = ${accepted.turn_id}::uuid) AS decisions,
        (SELECT count(*)::integer FROM outbound_deliveries AS od
          JOIN messages AS m ON m.id = od.message_id
          WHERE m.in_reply_to = ${accepted.turn_id}::uuid) AS deliveries,
        (SELECT count(*)::integer FROM outbox_events AS oe
          JOIN outbound_deliveries AS od ON od.id = oe.delivery_id
          JOIN messages AS m ON m.id = od.message_id
          WHERE m.in_reply_to = ${accepted.turn_id}::uuid) AS outbox
    `;
    expect(counts[0]).toEqual({ decisions: 0, deliveries: 0, outbox: 0 });
  });

  it.each([
    ['invented price', 'El precio total es USD 999.'],
    ['invented duration', 'El curso tiene 99 clases.'],
  ])('replaces an %s with a safe answer instead of returning 422', async (_case, content) => {
    const accepted = await processInboundMessage(envelope());
    const committed = await commitAgentDecision(reply(accepted.turn_id, randomUUID(), content));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toMatch(/no tengo ese dato confirmado/i);
    expect(committed.outbound?.content).not.toBe(content);
  });

  it('verifies the persisted manifest again before returning a duplicate outbound', async () => {
    const accepted = await processInboundMessage(envelope());
    const input = reply(accepted.turn_id);
    const committed = await commitAgentDecision(input);

    await db!`
      UPDATE messages
      SET metadata = jsonb_set(metadata, '{authorized_egress,content_hash}', to_jsonb(${'0'.repeat(64)}::text))
      WHERE id = ${committed.outbound!.id}::uuid
    `;

    await expect(commitAgentDecision({ ...input, trace_id: randomUUID() }))
      .rejects.toMatchObject({ reason: 'EGRESS_HASH_MISMATCH' });
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

  it('rejects a URL-bearing or price-bearing memory candidate before it ever reaches selected_memories', async () => {
    const accepted = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'Prefiero pagar por este link y con este presupuesto',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    const committed = await commitAgentDecision({
      turn_id: accepted.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: 'Dale, te confirmo por acá.',
        response_type: 'commercial_reply',
        confidence: 0.9,
        reason_code: 'MEMORY_GUARD_TEST',
        business_action: null,
        memory_candidates: [
          {
            type: 'preference',
            key: 'payment_channel',
            value: 'Prefiere pagar por este link https://example.com/promo-link',
            source_quote: 'Prefiero pagar por este link https://example.com/promo-link',
            confidence: 0.9,
          },
          {
            type: 'constraint',
            key: 'budget_hint',
            value: 'Sólo puede pagar USD 50.00 por mes',
            source_quote: 'Sólo puede pagar USD 50.00 por mes',
            confidence: 0.85,
          },
          {
            type: 'constraint',
            key: 'price_offer_dollars',
            value: 'Quiere pagar 100 dolares',
            source_quote: 'Quiere pagar 100 dolares',
            confidence: 0.88,
          },
          {
            type: 'constraint',
            key: 'price_offer_usd_shorthand',
            value: 'Ofrece u$s 360 por el curso',
            source_quote: 'Ofrece u$s 360 por el curso',
            confidence: 0.87,
          },
          // Spanish time expressions: decimal-shaped, but no currency
          // context — must be KEPT, not filtered. Chat scenario 20 depends
          // on capturing exactly these schedule preferences.
          {
            type: 'preference',
            key: 'study_hours',
            value: 'Prefiere estudiar de 20.30 a 22.00 hs',
            source_quote: 'Prefiere estudiar de 20.30 a 22.00 hs',
            confidence: 0.9,
          },
          {
            type: 'preference',
            key: 'preferred_shift',
            value: 'Turno de las 8,30',
            source_quote: 'turno de las 8,30',
            confidence: 0.9,
          },
          {
            type: 'preference',
            key: 'schedule_memory_guard',
            value: 'night',
            source_quote: 'Prefiero pagar por este link y con este presupuesto',
            confidence: 0.9,
          },
        ],
        missing_information: [],
        next_state: 'completed',
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v-memory-guard' },
    });
    expect(committed.status).toBe('committed');
    // The canonical commit only enqueues durable projection jobs. Run the
    // same bounded worker used by reconciliation before asserting the
    // selected-memory projection.
    await projectAgentAMemories({ limit: 10 }, { db: db!, audit: auditLog });

    const memories = await db!<Array<{ memory_key: string }>>`
      SELECT memory_key FROM selected_memories WHERE decision_id = ${committed.decision_id}::uuid
    `;
    // Neither a URL-bearing nor a currency-context price-bearing candidate
    // lands in selected_memories, in ANY status
    // (proposed/accepted/rejected/active) — they never reach
    // `selectMemories` at all. A decimal-shaped time expression with NO
    // currency context is not price-like and must be kept, same as any
    // other clean candidate.
    expect(memories.map((row) => row.memory_key).sort()).toEqual(
      ['preferred_shift', 'schedule_memory_guard', 'study_hours'].sort()
    );

    const audits = await db!<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM audit_log
      WHERE entity_id = ${committed.decision_id}::uuid AND action = 'agent.decision.memory_candidate_rejected'
    `;
    expect(audits).toHaveLength(4);
    expect(audits.flatMap((row) => row.payload.rejected as unknown[])).toEqual([
      { type: 'preference', key: 'payment_channel', reason: 'URL_OR_PRICE_LIKE' },
      { type: 'constraint', key: 'budget_hint', reason: 'URL_OR_PRICE_LIKE' },
      { type: 'constraint', key: 'price_offer_dollars', reason: 'URL_OR_PRICE_LIKE' },
      { type: 'constraint', key: 'price_offer_usd_shorthand', reason: 'URL_OR_PRICE_LIKE' },
    ]);
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

  it('allows the one current opt-out acknowledgement after ingestion already blocked and revoked the contact', async () => {
    const result = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'No me escribas más',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    await db!`
      UPDATE contacts
      SET lifecycle_status = 'blocked', blocked_at = now(), blocked_reason = 'explicit-opt-out'
      WHERE id = ${result.contact.id}::uuid
    `;

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

    expect(acknowledgement.status).toBe('committed');
    expect(acknowledgement.outbound?.status).toBe('pending');
  });

  it('authorizes the first opt-out acknowledgement when the eligible message is later in the same batch', async () => {
    const firstEnvelope = envelope({
      message: {
        type: 'text',
        text: 'Quiero información de los cursos',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const first = await processInboundMessage(firstEnvelope);
    const optOut = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Dame de baja',
        occurred_at: new Date(Date.now() + 100).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });

    expect(optOut.batch.id).toBe(first.batch.id);
    expect(optOut.policy.allowed_response_types).toEqual(['opt_out_ack']);

    const acknowledgement = await commitAgentDecision({
      ...reply(first.turn_id),
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

    expect(acknowledgement.status).toBe('committed');
    expect(acknowledgement.outbound?.status).toBe('pending');
  });

  it('still rejects a normal reply when consent was revoked by an older turn', async () => {
    const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await processInboundMessage(envelope({
      phone_e164: phone,
      message: {
        type: 'text',
        text: 'No me escribas más',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    const later = await processInboundMessage(envelope({
      phone_e164: phone,
      message: {
        type: 'text',
        text: 'Quiero información',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    await expect(commitAgentDecision(reply(later.turn_id))).rejects.toMatchObject({
      reason: 'CONSENT_REVOKED',
    });
  });

  it('allows only the first opt-out acknowledgement and suppresses repeated opt-out messages', async () => {
    const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const first = await processInboundMessage(envelope({
      phone_e164: phone,
      message: {
        type: 'text',
        text: 'Dame de baja',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    const repeated = await processInboundMessage(envelope({
      phone_e164: phone,
      message: {
        type: 'text',
        text: 'Sacame de la lista definitivamente, por favor',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    expect(first.policy).toMatchObject({
      may_respond: true,
      allowed_response_types: ['opt_out_ack'],
      reason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
    });
    expect(repeated.policy).toMatchObject({
      may_respond: false,
      allowed_response_types: [],
      reason: 'CONSENT_REVOKED',
    });
  });

  it('keeps WhatsApp consent open when the customer declines only a call', async () => {
    const callDecline = envelope({
      message: {
        type: 'text',
        text: 'No me llames, prefiero que me asesores por WhatsApp',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });

    const result = await processInboundMessage(callDecline);
    expect(result.contact.consent_status).not.toBe('revoked');
    expect(result.policy.allowed_response_types).toContain('commercial_reply');
    expect(result.policy.allowed_response_types).not.toContain('opt_out_ack');
  });

  it('distinguishes an unambiguous written opt-out from a channel-scoped call refusal', async () => {
    const writtenOptOut = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'Dejen de escribirme',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    const callOnly = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'No me contactes por teléfono, escribime por WhatsApp',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    expect(writtenOptOut.contact.consent_status).toBe('revoked');
    expect(writtenOptOut.policy.allowed_response_types).toEqual(['opt_out_ack']);
    expect(callOnly.contact.consent_status).not.toBe('revoked');
    expect(callOnly.policy.allowed_response_types).toContain('commercial_reply');
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

  it('commits the inbound without any derived work on the ingest path', async () => {
    // Fase 3: retrieval and summarization moved to the claim. A message that
    // explicitly references the past used to trigger a vector search here — the
    // worst case, since a burst of five such messages paid five embeddings and
    // produced one answer. Ingest must now be pure persistence.
    const priorKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await processInboundMessage(
        envelope({
          message: {
            type: 'text',
            text: 'Como te dije antes, quiero retomar la compra',
            occurred_at: new Date().toISOString(),
            reply_to_external_message_id: null,
          },
        })
      );

      // A missing embedding key cannot affect ingest, because ingest no longer
      // calls the provider at all.
      expect(result.status).toBe('accepted');
      expect(result.batch.id).toEqual(expect.any(String));
      expect('context' in result).toBe(false);

      const persisted = await db!`SELECT id FROM messages WHERE id = ${result.turn_id}::uuid`;
      expect(persisted).toHaveLength(1);

      // Selective memory: a canonical message is not queued for vectorization.
      const queued = await db!`
        SELECT message_id FROM message_embeddings WHERE message_id = ${result.turn_id}::uuid
      `;
      expect(queued).toHaveLength(0);
    } finally {
      if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = priorKey;
    }
  });
});

/**
 * Fase 4 — pago, batch y latencia (docs/contracts/agent-a-operational-mvp.md
 * §4, §7, §8). A `send_payment_link` action is revalidated in the backend —
 * never trusted from the model — and closing the batch is a separate step
 * that must never duplicate the decision it follows.
 */
run('Fase 4 — pago y cierre de batch', () => {
  const PAYMENT_WORKSPACE_SLUG = `test-payment-lifecycle-${randomUUID().slice(0, 8)}`;
  const PAYMENT_LINK_12M = 'https://buy.stripe.com/test_12m_lifecycle';
  const savedEnv: Partial<Record<string, string>> = {};

  /** Deterministic stand-in for the embedding provider; no network key needed. */
  function fakeEmbedding(): Promise<number[]> {
    return Promise.resolve(Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)));
  }

  const claimDeps = {
    store: orchestrationStore,
    embedding: { embed: fakeEmbedding },
    memory: new PostgresMemoryRetriever(sql),
    knowledge: new PostgresKnowledgeRetriever(sql),
    limits: DEFAULT_CONTEXT_LIMITS,
  };

  beforeAll(async () => {
    const workspace = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${PAYMENT_WORKSPACE_SLUG}, 'Payment Lifecycle Test')
      RETURNING id
    `;
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency, delivery, metadata
      ) VALUES
        (
          ${workspace[0].id}::uuid, 'course_test', 'Curso Test', 'course', 'active',
          'Offering canónico exclusivo del test', 'fixed', 360, 'USD',
          ${db!.json({ classes: 16, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Tecnología' })}
        ),
        (
          ${workspace[0].id}::uuid, 'course_other', 'Curso Distinto', 'course', 'active',
          'Offering diferente para probar aislamiento', 'fixed', 500, 'USD',
          ${db!.json({ classes: 20, modality: 'presencial', certification: false })},
          ${db!.json({})}
        ),
        (
          ${workspace[0].id}::uuid, 'redes_informaticas', 'Redes Informáticas', 'course', 'active',
          'Offering canónico para copia comercial', 'fixed', 360, 'USD',
          ${db!.json({ classes: 16, modality: 'online', certification: null })},
          ${db!.json({})}
        ),
        (
          ${workspace[0].id}::uuid, 'decoracion_interiores', 'Decoración de Interiores', 'course', 'active',
          'Offering canónico para copia comercial', 'fixed', 360, 'USD',
          ${db!.json({ classes: 34, modality: 'online', certification: null })},
          ${db!.json({})}
        )
    `;
    for (const key of ['BUSINESS_WORKSPACE_SLUG', 'PAYMENT_LINK_12M', 'PAYMENT_LINK_6M', 'PAYMENT_LINK_CONTADO']) {
      savedEnv[key] = process.env[key];
    }
    process.env.BUSINESS_WORKSPACE_SLUG = PAYMENT_WORKSPACE_SLUG;
    process.env.PAYMENT_LINK_12M = PAYMENT_LINK_12M;
    process.env.PAYMENT_LINK_6M = 'https://buy.stripe.com/test_6m_lifecycle';
    process.env.PAYMENT_LINK_CONTADO = 'https://buy.stripe.com/test_contado_lifecycle';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function paymentInbound() {
    return envelope({
      message: {
        type: 'text',
        text: 'Quiero pagar en 12 cuotas',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
  }

  function paymentDecision(turnId: string, overrides: { responseText?: string; traceId?: string } = {}) {
    return {
      turn_id: turnId,
      trace_id: overrides.traceId ?? randomUUID(),
      authorized_offering_code: 'course_test',
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: overrides.responseText ?? 'Perfecto, te paso el link del plan de 12 cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_12' as const,
          offering_sku: 'course_test',
        },
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed' as const,
        reason_code: 'PLAN_CHOSEN',
        confidence: 0.95,
        retrieval_used: null,
      },
      model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v4-payment' },
    };
  }

  function groundedReply(
    turnId: string,
    content: string,
    authorizedOfferingCode: string | null | undefined
  ) {
    return {
      ...reply(turnId, randomUUID(), content),
      ...(authorizedOfferingCode === undefined
        ? {}
        : { authorized_offering_code: authorizedOfferingCode }),
    };
  }

  it('persists the initial commercial state as exploring', async () => {
    const accepted = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'Quiero estudiar algo',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    await commitAgentDecision(reply(
      accepted.turn_id,
      randomUUID(),
      'Te ayudo a explorar las opciones disponibles.',
    ));

    const states = await db!<Array<{ stage: string; selected_payment_plan: string | null }>>`
      SELECT state.stage, state.selected_payment_plan
      FROM sales_context_states AS state
      JOIN messages AS turn ON turn.contact_id = state.contact_id
      WHERE turn.id = ${accepted.turn_id}::uuid
    `;
    expect(states).toEqual([{ stage: 'exploring', selected_payment_plan: null }]);
  });

  it('closes only a genuinely deferred commercial conversation', async () => {
    const accepted = await processInboundMessage(envelope({
      message: {
        type: 'text',
        text: 'Por ahora no me voy a anotar, lo voy a pensar.',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));

    await commitAgentDecision({
      turn_id: accepted.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 4,
        intent: 'commercial_decline',
        kind: 'reply',
        response: 'Entendido. Cuando quieras retomarlo, seguimos por acá.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'DETERMINISTIC_DEFERRED_CLOSE',
        confidence: 1,
        retrieval_used: null,
      },
      model: { provider: 'botpress', model: 'deterministic', prompt_version: 'v4-close' },
    });

    const states = await db!<Array<{ stage: string }>>`
      SELECT state.stage
      FROM sales_context_states AS state
      JOIN messages AS turn ON turn.contact_id = state.contact_id
      WHERE turn.id = ${accepted.turn_id}::uuid
    `;
    expect(states).toEqual([{ stage: 'closed' }]);
  });

  it('re-derives and persists a plan selection without sending a payment link', async () => {
    const accepted = await processInboundMessage(paymentInbound());

    const committed = await commitAgentDecision({
      turn_id: accepted.turn_id,
      trace_id: randomUUID(),
      authorized_offering_code: 'course_test',
      authorized_payment_plan: 'monthly_12',
      decision: {
        schema_version: 4,
        intent: 'commercial',
        kind: 'reply',
        response: 'Perfecto, elegiste 12 cuotas. Cuando quieras, pedime el link seguro.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
        reason_code: 'DETERMINISTIC_PAYMENT_SELECTION',
        confidence: 1,
        retrieval_used: null,
      },
      model: { provider: 'botpress', model: 'deterministic', prompt_version: 'v4-payment' },
    });

    expect(committed.outbound?.content).not.toContain('https://');
    const states = await db!<Array<{
      stage: string;
      selected_offering_code: string | null;
      selected_payment_plan: string | null;
    }>>`
      SELECT state.stage, state.selected_offering_code, state.selected_payment_plan
      FROM sales_context_states AS state
      JOIN messages AS turn ON turn.contact_id = state.contact_id
      WHERE turn.id = ${accepted.turn_id}::uuid
    `;
    expect(states).toEqual([{
      stage: 'plan_selected',
      selected_offering_code: 'course_test',
      selected_payment_plan: 'monthly_12',
    }]);
  });

  it('rejects a claim-authorized plan that the current batch did not select', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    const forged = {
      ...reply(accepted.turn_id),
      authorized_offering_code: 'course_test',
      authorized_payment_plan: 'monthly_6' as const,
    };

    await expect(commitAgentDecision(forged)).rejects.toMatchObject({
      code: 'DECISION_REJECTED',
      reason: 'PAYMENT_PLAN_MISMATCH',
    });
  });

  it.each([
    ['price', 'El precio de Curso Test es USD 360.', { kind: 'price', value: 'usd 360' }],
    ['classes', 'El curso de Curso Test tiene 16 clases.', { kind: 'duration', value: '16 clases' }],
    ['modality', 'La modalidad de Curso Test es online.', { kind: 'modality', value: 'online' }],
  ])('authorizes the canonical %s fact for the exact active offering', async (_case, content, fact) => {
    const accepted = await processInboundMessage(envelope());

    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      content,
      'course_test'
    ));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe(content);
    expect(committed.outbound?.authorized_egress).toMatchObject({
      authorized_urls: [],
      protected_facts: [fact],
    });
    expect(verifyAuthorizedEgress({
      content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });
  });

  it('authorizes a deterministic list only when every offering exists in the canonical catalog', async () => {
    const accepted = await processInboundMessage(envelope());
    const content = 'Tenemos Curso Test, Curso Distinto.';
    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      content,
      undefined,
    ));

    expect(committed.outbound?.content).toBe(content);
    expect(committed.outbound?.authorized_egress.protected_facts).toEqual([{
      kind: 'offering',
      value: 'tenemos curso test, curso distinto',
    }]);
  });

  it('preserves a canonical academy name in an otherwise harmless Gemini answer', async () => {
    const accepted = await processInboundMessage(envelope());
    const content = 'Tenemos cursos de Tecnología. ¿Qué te gustaría aprender?';
    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      content,
      undefined,
    ));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe(content);
    expect(committed.outbound?.content).not.toMatch(/no tengo ese dato confirmado/i);
    expect(verifyAuthorizedEgress({
      content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });
  });

  it.each([
    [
      'Redes Informáticas',
      'redes_informaticas',
      'Te cuento sobre Redes Informáticas. El curso de Redes Informáticas tiene 16 clases. La modalidad de Redes Informáticas es online.',
    ],
    [
      'Decoración de Interiores',
      'decoracion_interiores',
      'El curso de Decoración de Interiores tiene 34 clases. La certificación de Decoración de Interiores no está especificada en la información disponible.',
    ],
  ])('commits the canonical full-pipeline response for %s instead of the safe fallback', async (
    _displayName,
    offeringCode,
    content,
  ) => {
    const accepted = await processInboundMessage(envelope());
    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      content,
      offeringCode,
    ));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe(content);
    expect(committed.outbound?.content).not.toMatch(/no tengo ese dato confirmado/i);
    expect(verifyAuthorizedEgress({
      content: committed.outbound!.content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });
  });

  it('replaces an unsupported offering claim with one safe deterministic fallback', async () => {
    const accepted = await processInboundMessage(envelope());
    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      'Sí, ofrecemos Programación en Python.',
      undefined,
    ));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toMatch(/no tengo ese dato confirmado/i);
    expect(committed.outbound?.content).not.toMatch(/programación en python/i);
    expect(verifyAuthorizedEgress({
      content: committed.outbound!.content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });
  });

  it.each([
    ['a different existing course code', 'El precio es USD 360.', 'course_other'],
    ['an offering absent from the snapshot', 'El precio es USD 360.', 'missing_course'],
    ['no authorized course code', 'El precio es USD 360.', undefined],
    ['a different value', 'El precio es USD 361.', 'course_test'],
  ])('replaces a protected fact backed by %s with a safe answer', async (
    _case,
    content,
    authorizedOfferingCode
  ) => {
    const accepted = await processInboundMessage(envelope());

    const committed = await commitAgentDecision(groundedReply(
      accepted.turn_id,
      content,
      authorizedOfferingCode
    ));

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toMatch(/no tengo ese dato confirmado/i);
    expect(committed.outbound?.content).not.toBe(content);
  });

  it('materializes only the configured URL and strips any model-authored one', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    const auditCanary = `private-${randomUUID()}@example.test`;
    const rogueUrl = `https://evil.example.com/steal?email=${encodeURIComponent(auditCanary)}`;

    const committed = await commitAgentDecision(paymentDecision(accepted.turn_id, {
      responseText: `Perfecto, acá tenés el link: ${rogueUrl}`,
    }));

    expect(committed.status).toBe('committed');
    const content = committed.outbound!.content;
    expect(content).toContain(PAYMENT_LINK_12M);
    expect(content).not.toContain(rogueUrl);
    // Only the canonical URL survives — the model-authored one is gone, not
    // just deduplicated alongside it.
    expect(content.match(/https?:\/\/\S+/g)).toEqual([PAYMENT_LINK_12M]);
    expect(committed.outbound!.authorized_egress).toMatchObject({
      schema_version: 1,
      authorized_urls: [PAYMENT_LINK_12M],
      protected_facts: [{ kind: 'price', value: 'usd 30' }],
    });
    expect(verifyAuthorizedEgress({
      content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });

    const stored = await db!<Array<{ business_action: unknown }>>`
      SELECT business_action FROM agent_decisions WHERE id = ${committed.decision_id}::uuid
    `;
    // Action + plan only — never a link or a price.
    expect(stored[0].business_action).toEqual({
      type: 'send_payment_link',
      plan_code: 'monthly_12',
      offering_sku: 'course_test',
    });

    const audits = await db!<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM audit_log
      WHERE entity_id = ${committed.decision_id}::uuid AND action = 'agent.decision.payment_link_urls_stripped'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({
      stripped_url_count: 1,
      stripped_url_evidence: [{
        scheme: 'https',
        host_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        value_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }],
    });
    expect(JSON.stringify(audits[0].payload)).not.toContain(auditCanary);
    expect(JSON.stringify(audits[0].payload)).not.toContain('evil.example.com');
    expect(JSON.stringify(audits[0].payload)).not.toContain('/steal');
  });

  it('rejects a catalog-valid payment SKU that differs from the claim-authorized SKU', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    const mismatched = {
      ...paymentDecision(accepted.turn_id),
      authorized_offering_code: 'course_other',
    };

    await expect(commitAgentDecision(mismatched)).rejects.toMatchObject({
      code: 'DECISION_REJECTED',
      reason: 'OFFERING_MISMATCH',
    });

    const persisted = await db!<Array<{ decisions: number; outbound: number }>>`
      SELECT
        count(ad.id)::integer AS decisions,
        count(ad.outbound_message_id)::integer AS outbound
      FROM messages AS turn
      LEFT JOIN agent_decisions AS ad ON ad.turn_id = turn.id
      WHERE turn.id = ${accepted.turn_id}::uuid
    `;
    expect(persisted[0]).toEqual({ decisions: 0, outbound: 0 });
  });

  it('resumes one exact deferred plan on a later explicit "ahora sí" turn', async () => {
    const firstEnvelope = envelope({
      message: {
        type: 'text',
        text: 'Confirmo 6 cuotas para Decoración de Interiores, pero mandámelo después.',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const first = await processInboundMessage(firstEnvelope);
    const deferredDecision = {
      ...paymentDecision(first.turn_id),
      authorized_offering_code: 'decoracion_interiores',
      decision: {
        ...paymentDecision(first.turn_id).decision,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_6' as const,
          offering_sku: 'decoracion_interiores',
        },
      },
    };
    await expect(commitAgentDecision(deferredDecision)).rejects.toMatchObject({
      reason: 'AMBIGUOUS_OR_ABSENT_CHOICE',
    });
    await db!`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${first.batch.id}::uuid
    `;

    const resumed = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Ahora sí, mandámelo.',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const resumedDecision = {
      ...paymentDecision(resumed.turn_id),
      authorized_offering_code: 'decoracion_interiores',
      decision: {
        ...paymentDecision(resumed.turn_id).decision,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_6' as const,
          offering_sku: 'decoracion_interiores',
        },
      },
    };

    const committed = await commitAgentDecision(resumedDecision);
    expect(committed.outbound?.content).toContain('https://buy.stripe.com/test_6m_lifecycle');
  });

  it('resumes the durable selected plan on a later explicit link request', async () => {
    const firstEnvelope = paymentInbound();
    const first = await processInboundMessage(firstEnvelope);
    await commitAgentDecision({
      turn_id: first.turn_id,
      trace_id: randomUUID(),
      authorized_offering_code: 'course_test',
      authorized_payment_plan: 'monthly_12',
      decision: {
        schema_version: 4,
        intent: 'commercial',
        kind: 'reply',
        response: 'Perfecto, elegiste 12 cuotas. Cuando quieras, pedime el link seguro.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
        reason_code: 'DETERMINISTIC_PAYMENT_SELECTION',
        confidence: 1,
        retrieval_used: null,
      },
      model: { provider: 'botpress', model: 'deterministic', prompt_version: 'v4-payment' },
    });
    await db!`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${first.batch.id}::uuid
    `;

    const resumed = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Ahora sí, pasame el link.',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const committed = await commitAgentDecision(paymentDecision(resumed.turn_id));

    expect(committed.outbound?.content).toContain(PAYMENT_LINK_12M);
    const states = await db!<Array<{ stage: string; selected_payment_plan: string | null }>>`
      SELECT state.stage, state.selected_payment_plan
      FROM sales_context_states AS state
      JOIN messages AS turn ON turn.contact_id = state.contact_id
      WHERE turn.id = ${resumed.turn_id}::uuid
    `;
    expect(states).toEqual([{ stage: 'payment_link_sent', selected_payment_plan: 'monthly_12' }]);
  });

  it.each([
    ['mismatched claim SKU', 'Confirmo nuevamente las 12 cuotas.', 'course_other'],
    ['current intent veto', 'Confirmo 12 cuotas, pero solo consultaba.', 'course_test'],
  ])('revalidates %s before acknowledging a prior payment link', async (_case, text, authorizedSku) => {
    const firstEnvelope = paymentInbound();
    const first = await processInboundMessage(firstEnvelope);
    await commitAgentDecision(paymentDecision(first.turn_id));
    await db!`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${first.batch.id}::uuid
    `;
    const second = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text,
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });

    await expect(commitAgentDecision({
      ...paymentDecision(second.turn_id),
      authorized_offering_code: authorizedSku,
    })).rejects.toMatchObject({ code: 'DECISION_REJECTED' });

    const decisions = await db!<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM agent_decisions WHERE turn_id = ${second.turn_id}::uuid
    `;
    expect(decisions[0].count).toBe(0);
  });

  it('does not emit the same payment link twice in one conversation', async () => {
    const firstEnvelope = paymentInbound();
    const first = await processInboundMessage(firstEnvelope);
    const firstCommit = await commitAgentDecision(paymentDecision(first.turn_id));
    await db!`
      UPDATE inbound_batches
      SET state = 'completed', completed_at = now(), updated_at = now()
      WHERE id = ${first.batch.id}::uuid
    `;

    const second = await processInboundMessage({
      ...firstEnvelope,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Confirmo nuevamente las 12 cuotas',
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: firstEnvelope.external_message_id,
      },
    });
    const secondCommit = await commitAgentDecision(paymentDecision(second.turn_id));

    expect(firstCommit.outbound?.content).toContain(PAYMENT_LINK_12M);
    expect(secondCommit.outbound?.content).toMatch(/ya te compartí el link/i);
    expect(secondCommit.outbound?.content).not.toContain(PAYMENT_LINK_12M);

    const rows = await db!<Array<{ payment_actions: number; link_messages: number }>>`
      SELECT
        count(*) FILTER (
          WHERE ad.business_action ->> 'type' = 'send_payment_link'
        )::integer AS payment_actions,
        count(*) FILTER (
          WHERE om.content LIKE ${`%${PAYMENT_LINK_12M}%`}
        )::integer AS link_messages
      FROM agent_decisions AS ad
      JOIN messages AS turn ON turn.id = ad.turn_id
      LEFT JOIN messages AS om ON om.id = ad.outbound_message_id
      WHERE turn.conversation_id = ${first.conversation_id}::uuid
    `;
    expect(rows[0]).toEqual({ payment_actions: 1, link_messages: 1 });
  });

  it('produces one decision and one outbound under replay of the same inbound', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    const input = paymentDecision(accepted.turn_id);

    const first = await commitAgentDecision(input);
    const replay = await commitAgentDecision({ ...input, trace_id: randomUUID() });

    expect(first.status).toBe('committed');
    expect(replay.status).toBe('duplicate');
    expect(replay.decision_id).toBe(first.decision_id);
    expect(replay.outbound?.id).toBe(first.outbound?.id);
    expect(replay.outbound?.authorized_egress).toEqual(first.outbound?.authorized_egress);

    const counts = await db!<Array<{ decisions: number; deliveries: number }>>`
      SELECT
        (SELECT count(*)::integer FROM agent_decisions WHERE turn_id = ${accepted.turn_id}::uuid) AS decisions,
        (SELECT count(*)::integer FROM outbound_deliveries WHERE message_id = ${first.outbound!.id}::uuid) AS deliveries
    `;
    expect(counts[0]).toEqual({ decisions: 1, deliveries: 1 });
  });

  it('closes the batch to completed on commit, and never duplicates it on replay', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${accepted.batch.id}::uuid`;

    const claimed = await claimBatch(
      { batch_id: accepted.batch.id, claimed_by: 'vitest-payment', trace_id: randomUUID() },
      claimDeps
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    const committed = await commitClaimedDecision(
      {
        ...paymentDecision(claimed.turn_id),
        batch_id: claimed.batch.id,
        claim_token: claimed.batch.claim_token,
      },
      { store: orchestrationStore }
    );
    expect(committed.status).toBe('committed');
    expect(committed.batch_completion).toBe('completed');

    const batchRow = await db!<Array<{ state: string; lease_until: string | null }>>`
      SELECT state, lease_until FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid
    `;
    expect(batchRow[0]).toEqual({ state: 'completed', lease_until: null });

    // A replay of the same decision must not duplicate anything, and the
    // batch must stay completed — never revert to `claimed`.
    const replay = await commitClaimedDecision(
      {
        ...paymentDecision(claimed.turn_id, { traceId: randomUUID() }),
        batch_id: claimed.batch.id,
        claim_token: claimed.batch.claim_token,
      },
      { store: orchestrationStore }
    );
    expect(replay.status).toBe('duplicate');
    expect(replay.batch_completion).toBe('duplicate');

    const batchRowAfterReplay = await db!<Array<{ state: string }>>`
      SELECT state FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid
    `;
    expect(batchRowAfterReplay[0].state).toBe('completed');
  });

  function ambiguousInbound() {
    return envelope({
      message: {
        type: 'text',
        text: 'Quiero comprar el curso ya',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
  }

  it('a completeBatch stale_claim pauses without duplicating the decision or outbound', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${accepted.batch.id}::uuid`;

    const claimed = await claimBatch(
      { batch_id: accepted.batch.id, claimed_by: 'vitest-payment-close-fail', trace_id: randomUUID() },
      claimDeps
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    // A claim_token that does not match the one the store actually issued —
    // simulates the close arriving after another workflow already stole (or
    // otherwise advanced) this batch's lease.
    const wrongClaimToken = randomUUID();
    const input = paymentDecision(claimed.turn_id);

    const first = await commitClaimedDecision(
      { ...input, batch_id: claimed.batch.id, claim_token: wrongClaimToken },
      { store: orchestrationStore }
    );
    // The decision itself commits normally: closing the batch is a SEPARATE
    // step, and its failure must never look like a decision failure.
    expect(first.status).toBe('committed');
    expect(first.batch_completion).toBe('stale_claim');

    const batchRow = await db!<Array<{ state: string }>>`
      SELECT state FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid
    `;
    // Paused, not completed: left for the daily reconciler, never silently
    // marked done.
    expect(batchRow[0].state).toBe('claimed');

    // Retrying (same wrong token) must not duplicate anything: the decision
    // replay collapses to `duplicate`, and the close keeps failing the same
    // way — never a thrown exception that could look like the commit itself
    // failed.
    const retry = await commitClaimedDecision(
      { ...input, trace_id: randomUUID(), batch_id: claimed.batch.id, claim_token: wrongClaimToken },
      { store: orchestrationStore }
    );
    expect(retry.status).toBe('duplicate');
    expect(retry.decision_id).toBe(first.decision_id);
    expect(retry.outbound?.id).toBe(first.outbound?.id);
    expect(retry.batch_completion).toBe('stale_claim');

    const counts = await db!<Array<{ decisions: number; deliveries: number }>>`
      SELECT
        (SELECT count(*)::integer FROM agent_decisions WHERE turn_id = ${claimed.turn_id}::uuid) AS decisions,
        (SELECT count(*)::integer FROM outbound_deliveries WHERE message_id = ${first.outbound!.id}::uuid) AS deliveries
    `;
    expect(counts[0]).toEqual({ decisions: 1, deliveries: 1 });
  });

  it('a thrown completeBatch error pauses without duplicating, and is logged instead of surfaced', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${accepted.batch.id}::uuid`;

    const claimed = await claimBatch(
      { batch_id: accepted.batch.id, claimed_by: 'vitest-payment-close-throw', trace_id: randomUUID() },
      claimDeps
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    // Only `completeBatch` is exercised by `commitClaimedDecision` — every
    // other OrchestrationStore method is irrelevant to this test.
    const failingStore = {
      completeBatch: async () => {
        throw new Error('SIMULATED_CLOSE_FAILURE');
      },
    } as unknown as typeof orchestrationStore;

    const committed = await commitClaimedDecision(
      { ...paymentDecision(claimed.turn_id), batch_id: claimed.batch.id, claim_token: claimed.batch.claim_token },
      { store: failingStore }
    );
    expect(committed.status).toBe('committed');
    expect(committed.batch_completion).toBe('error');

    const batchRow = await db!<Array<{ state: string }>>`
      SELECT state FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid
    `;
    expect(batchRow[0].state).toBe('claimed');

    const counts = await db!<Array<{ decisions: number }>>`
      SELECT count(*)::integer AS decisions FROM agent_decisions WHERE turn_id = ${claimed.turn_id}::uuid
    `;
    expect(counts[0].decisions).toBe(1);
  });

  it('a send_payment_link refusal (422) leaves the batch claimed and persists nothing; a corrected clarification afterwards commits and completes it', async () => {
    const accepted = await processInboundMessage(ambiguousInbound());
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${accepted.batch.id}::uuid`;

    const claimed = await claimBatch(
      { batch_id: accepted.batch.id, claimed_by: 'vitest-payment-refusal', trace_id: randomUUID() },
      claimDeps
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    // The batch's own message never names a plan — `allowed_payment_plan`
    // cannot be derived, so the action must be refused, not guessed at.
    await expect(commitClaimedDecision(
      { ...paymentDecision(claimed.turn_id), batch_id: claimed.batch.id, claim_token: claimed.batch.claim_token },
      { store: orchestrationStore }
    )).rejects.toMatchObject({ reason: 'AMBIGUOUS_OR_ABSENT_CHOICE' });

    const afterRefusal = await db!<Array<{ decisions: number; deliveries: number; batch_state: string }>>`
      SELECT
        (SELECT count(*)::integer FROM agent_decisions WHERE turn_id = ${claimed.turn_id}::uuid) AS decisions,
        (SELECT count(*)::integer FROM outbound_deliveries od
           JOIN agent_decisions ad ON ad.outbound_message_id = od.message_id
           WHERE ad.turn_id = ${claimed.turn_id}::uuid) AS deliveries,
        (SELECT state FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid) AS batch_state
    `;
    // Ruling: the throw-to-422 path stays as is (matches request_call_now's
    // existing refusal pattern) — nothing persisted, batch left `claimed`
    // for the daily reconciler, never silently advanced.
    expect(afterRefusal[0]).toEqual({ decisions: 0, deliveries: 0, batch_state: 'claimed' });

    // Corrected retry: per spec §4.1 ("Una elección ausente o ambigua obliga
    // a clarificar"), the agent clarifies instead of re-attempting the same
    // ambiguous action — and the batch's claim is still live, so it commits
    // normally and completes the batch it left open.
    const clarified = await commitClaimedDecision(
      {
        turn_id: claimed.turn_id,
        trace_id: randomUUID(),
        decision: {
          schema_version: 4 as const,
          intent: 'commercial' as const,
          kind: 'clarify' as const,
          response: '¿Preferís 12 cuotas, 6 cuotas o pago al contado?',
          response_type: 'clarification' as const,
          business_action: null,
          memory_candidates: [],
          missing_information: ['payment_plan'],
          next_state: 'waiting_user' as const,
          reason_code: 'CLARIFY_PLAN',
          confidence: 0.9,
          retrieval_used: null,
        },
        model: { provider: 'botpress' as const, model: 'test-model', prompt_version: 'v4-payment' },
        batch_id: claimed.batch.id,
        claim_token: claimed.batch.claim_token,
      },
      { store: orchestrationStore }
    );
    expect(clarified.status).toBe('committed');
    expect(clarified.batch_completion).toBe('completed');

    const finalBatch = await db!<Array<{ state: string }>>`
      SELECT state FROM inbound_batches WHERE id = ${claimed.batch.id}::uuid
    `;
    expect(finalBatch[0].state).toBe('completed');
  });
});
