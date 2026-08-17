import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { registerMessage, type Message } from '@/lib/services/message.service';

/**
 * Spec 007 — sintetiza el turno inbound que agent_decisions exige por FK,
 * para una llamada que llegó a estado terminal. Nadie escribió este mensaje:
 * es la representación canónica de "la llamada <call_id> terminó", resuelta
 * al mismo contacto/conversación que ya tenía el contacto por WhatsApp.
 *
 * Reusa exactamente las mismas piezas que un turno real (channel_events +
 * messages.source_event_id), así que todo lo que ya exige un turno real
 * (loadTurnPolicy, el trigger de contexto, la FK de agent_decisions) sigue
 * cumplido sin cambios. La idempotencia sale gratis de
 * channel_events_provider_event_uq sobre external_event_id.
 */

export class CallResultTurnConflictError extends Error {
  readonly code = 'CALL_RESULT_TURN_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'CallResultTurnConflictError';
  }
}

export interface SynthesizeCallResultTurnInput {
  readonly call_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly trace_id: string;
}

export interface SynthesizedCallResultTurn {
  readonly message: Message;
  readonly event_id: string;
  readonly reused_existing: boolean;
}

function externalEventIdFor(callId: string): string {
  return `system:call_result:${callId}`;
}

export async function synthesizeCallResultTurn(
  input: SynthesizeCallResultTurnInput,
  db: DbClient
): Promise<SynthesizedCallResultTurn> {
  const externalEventId = externalEventIdFor(input.call_id);

  const conversations = await db<Array<{
    channel_thread_id: string | null;
    provider: string | null;
    integration_id: string | null;
    channel: string;
  }>>`
    SELECT conv.channel_thread_id, ct.provider, ct.integration_id, conv.channel
    FROM conversations AS conv
    LEFT JOIN channel_threads AS ct ON ct.id = conv.channel_thread_id
    WHERE conv.id = ${input.conversation_id}::uuid AND conv.contact_id = ${input.contact_id}::uuid
  `;
  const conversation = conversations[0];
  if (!conversation?.channel_thread_id || !conversation.provider || !conversation.integration_id) {
    throw new CallResultTurnConflictError(
      `Conversation ${input.conversation_id} has no resolved WhatsApp thread; cannot synthesize a system turn`
    );
  }

  const payload = { system: 'post_call_followup', call_id: input.call_id };
  const payloadHash = sha256Hex(payload);

  const inserted = await db<Array<{ id: string }>>`
    INSERT INTO channel_events (
      provider, integration_id, channel, event_kind, direction,
      external_event_id, payload_hash, payload, contact_id, channel_thread_id, status
    )
    VALUES (
      ${conversation.provider}, ${conversation.integration_id}, ${conversation.channel},
      'system_call_result', 'inbound', ${externalEventId},
      decode(${payloadHash}, 'hex'), ${jsonbParam(db, payload)},
      ${input.contact_id}::uuid, ${conversation.channel_thread_id}::uuid, 'processing'
    )
    ON CONFLICT (provider, integration_id, external_event_id) DO NOTHING
    RETURNING id
  `;

  let eventId: string;
  let reusedExisting: boolean;
  if (inserted[0]) {
    eventId = inserted[0].id;
    reusedExisting = false;
  } else {
    const existing = await db<Array<{ id: string; contact_id: string | null }>>`
      SELECT id, contact_id FROM channel_events
      WHERE provider = ${conversation.provider}
        AND integration_id = ${conversation.integration_id}
        AND external_event_id = ${externalEventId}
    `;
    if (!existing[0] || existing[0].contact_id !== input.contact_id) {
      throw new CallResultTurnConflictError(
        `channel_events row for ${externalEventId} exists but does not match contact ${input.contact_id}`
      );
    }
    eventId = existing[0].id;
    reusedExisting = true;
  }

  const existingMessages = await db<Message[]>`
    SELECT * FROM messages WHERE source_event_id = ${eventId}::uuid LIMIT 1
  `;
  if (existingMessages[0]) {
    return { message: existingMessages[0], event_id: eventId, reused_existing: true };
  }

  const { message } = await registerMessage(
    {
      conversation_id: input.conversation_id,
      direction: 'inbound',
      content: '[system:call_result]',
      source_event_id: eventId,
      metadata: { system: 'post_call_followup', call_id: input.call_id },
    },
    {
      db,
      embedding: 'skip',
      audit: {
        event_key: `call:${input.call_id}:system_turn`,
        correlation_id: input.trace_id,
        source_event_id: eventId,
      },
    }
  );

  await db`
    UPDATE channel_events
    SET status = 'processed', processed_at = now()
    WHERE id = ${eventId}::uuid
  `;

  return { message, event_id: eventId, reused_existing: reusedExisting };
}
