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
            key: 'schedule',
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
    // `commitAgentDecision` awaits `recordTurnMemories` fully before
    // returning (Fase 4 memory selection runs on its own connection but
    // synchronously, after the canonical commit) — no need to wait further.

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
      ['preferred_shift', 'schedule', 'study_hours'].sort()
    );

    const audits = await db!<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM audit_log
      WHERE entity_id = ${committed.decision_id}::uuid AND action = 'agent.decision.memory_candidate_rejected'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.rejected).toEqual([
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
    // A bare workspace row is enough: these tests always pass
    // `offering_sku: null`, so the canonical offering revalidation never
    // needs a seeded offering to pass.
    await db!`INSERT INTO workspaces (slug, display_name) VALUES (${PAYMENT_WORKSPACE_SLUG}, 'Payment Lifecycle Test')`;
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
      decision: {
        schema_version: 4 as const,
        intent: 'commercial' as const,
        kind: 'reply' as const,
        response: overrides.responseText ?? 'Perfecto, te paso el link del plan de 12 cuotas.',
        response_type: 'commercial_reply' as const,
        business_action: {
          type: 'send_payment_link' as const,
          plan_code: 'monthly_12' as const,
          offering_sku: null,
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

  it('materializes only the configured URL and strips any model-authored one', async () => {
    const accepted = await processInboundMessage(paymentInbound());
    const rogueUrl = 'https://evil.example.com/steal';

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

    const stored = await db!<Array<{ business_action: unknown }>>`
      SELECT business_action FROM agent_decisions WHERE id = ${committed.decision_id}::uuid
    `;
    // Action + plan only — never a link or a price.
    expect(stored[0].business_action).toEqual({
      type: 'send_payment_link',
      plan_code: 'monthly_12',
      offering_sku: null,
    });

    const audits = await db!<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM audit_log
      WHERE entity_id = ${committed.decision_id}::uuid AND action = 'agent.decision.payment_link_urls_stripped'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.stripped_urls).toEqual([rogueUrl]);
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
