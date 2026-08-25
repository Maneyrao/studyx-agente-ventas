import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { sql } from '@/lib/db/orchestrator';

/**
 * postgres.js resolves a parameter's type from the cast that follows its slot.
 * When that cast is `::jsonb` the driver applies its own JSON serialization, so
 * handing it an already-stringified payload stores a JSON *string* instead of
 * the intended document:
 *
 *   jsonb_typeof(${JSON.stringify([])}::jsonb) -> 'string'
 *   jsonb_typeof(${sql.json([])})              -> 'array'
 *
 * `agent_decisions.memory_candidates` carries CHECK (jsonb_typeof = 'array'),
 * so the double encoding turns every decision commit into a 23514. The other
 * jsonb columns accept the string silently and quietly break trace-ability
 * (invariant 7). These tests pin the canonical shape of every jsonb payload the
 * ingest/decision path writes.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-jsonb',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Quiero saber el precio del curso de ventas',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
    ...overrides,
  };
}

async function jsonbTypeOf(table: string, column: string, id: string): Promise<string | null> {
  const rows = await db!<Array<{ kind: string | null }>>`
    SELECT jsonb_typeof(${db!(column)}) AS kind
    FROM ${db!(table)}
    WHERE id = ${id}::uuid
  `;
  return rows[0]?.kind ?? null;
}

run('canonical jsonb persistence', () => {
  it('stores the inbound channel event payload as a jsonb object', async () => {
    const inbound = envelope();
    const result = await processInboundMessage(inbound);

    const events = await db!<Array<{ id: string; kind: string | null; external_user_id: unknown }>>`
      SELECT
        ce.id,
        jsonb_typeof(ce.payload) AS kind,
        ce.payload -> 'external_user_id' AS external_user_id
      FROM channel_events AS ce
      JOIN messages AS m ON m.source_event_id = ce.id
      WHERE m.id = ${result.turn_id}::uuid
    `;

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('object');
    // A JSON string would make the -> operator return null instead of the value.
    expect(events[0].external_user_id).toBe(inbound.external_user_id);
  });

  it('stores message metadata as a queryable jsonb object', async () => {
    const inbound = envelope();
    const result = await processInboundMessage(inbound);

    expect(await jsonbTypeOf('messages', 'metadata', result.turn_id)).toBe('object');

    const rows = await db!<Array<{ external_message_id: string | null }>>`
      SELECT metadata ->> 'external_message_id' AS external_message_id
      FROM messages
      WHERE id = ${result.turn_id}::uuid
    `;
    expect(rows[0].external_message_id).toBe(inbound.external_message_id);
  });

  it('stores the channel thread metadata as a jsonb object', async () => {
    const inbound = envelope();
    await processInboundMessage(inbound);

    const rows = await db!<Array<{ kind: string | null; external_user_id: string | null }>>`
      SELECT
        jsonb_typeof(metadata) AS kind,
        metadata ->> 'external_user_id' AS external_user_id
      FROM channel_threads
      WHERE external_conversation_id = ${inbound.external_conversation_id}
    `;
    expect(rows[0].kind).toBe('object');
    expect(rows[0].external_user_id).toBe(inbound.external_user_id);
  });

  it('stores audit payloads as jsonb objects', async () => {
    const inbound = envelope();
    const result = await processInboundMessage(inbound);

    const rows = await db!<Array<{ kind: string | null }>>`
      SELECT jsonb_typeof(payload) AS kind
      FROM audit_log
      WHERE entity_type = 'message' AND entity_id = ${result.turn_id}::uuid
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.kind === 'object')).toBe(true);
  });

  it('commits a decision whose memory_candidates survive as a jsonb array', async () => {
    const inbound = envelope();
    const turn = await processInboundMessage(inbound);

    const committed = await commitAgentDecision({
      turn_id: turn.turn_id,
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: 'Anoté tu interés para continuar la conversación.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [
          {
            type: 'preference',
            key: 'interest',
            value: 'curso de ventas',
            source_quote: 'Quiero saber el precio del curso de ventas',
            confidence: 0.9,
          },
        ],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'ANSWER_DURATION',
        confidence: 0.9,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v1' },
    });

    expect(committed.status).toBe('committed');

    const rows = await db!<Array<{ kind: string | null; first_key: string | null }>>`
      SELECT
        jsonb_typeof(memory_candidates) AS kind,
        memory_candidates -> 0 ->> 'key' AS first_key
      FROM agent_decisions
      WHERE id = ${committed.decision_id}::uuid
    `;
    expect(rows[0].kind).toBe('array');
    expect(rows[0].first_key).toBe('interest');
  });

  it('stores the outbox payload as a jsonb object addressable by trace_id', async () => {
    const inbound = envelope();
    const turn = await processInboundMessage(inbound);
    const traceId = randomUUID();

    const committed = await commitAgentDecision({
      turn_id: turn.turn_id,
      trace_id: traceId,
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te comparto la información del curso.',
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'ANSWER_INFO',
        confidence: 0.8,
      },
      model: { provider: 'botpress', model: 'test-model', prompt_version: 'v1' },
    });

    const rows = await db!<Array<{ kind: string | null; trace_id: string | null }>>`
      SELECT
        jsonb_typeof(oe.payload) AS kind,
        oe.payload ->> 'trace_id' AS trace_id
      FROM outbox_events AS oe
      JOIN outbound_deliveries AS od ON od.id = oe.delivery_id
      WHERE od.message_id = ${committed.outbound!.id}::uuid
    `;
    expect(rows[0].kind).toBe('object');
    expect(rows[0].trace_id).toBe(traceId);
  });

  it('records explicit opt-out evidence as a jsonb object', async () => {
    const inbound = envelope({
      message: {
        type: 'text',
        text: 'baja',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const result = await processInboundMessage(inbound);
    expect(result.policy.reason).toBe('EXPLICIT_OPT_OUT_ACK_ONLY');

    const rows = await db!<Array<{ kind: string | null; text: string | null }>>`
      SELECT jsonb_typeof(ce.evidence) AS kind, ce.evidence ->> 'text' AS text
      FROM consent_events AS ce
      JOIN messages AS m ON m.source_event_id = ce.source_event_id
      WHERE m.id = ${result.turn_id}::uuid
    `;
    expect(rows[0].kind).toBe('object');
    expect(rows[0].text).toBe('baja');
  });
});
