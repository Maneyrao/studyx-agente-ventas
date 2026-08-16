import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import type { TelegramSendMessageInput } from '@/features/calls/adapters/telegram-bot-api.client';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, DecisionPolicyError } from '@/lib/services/decision.service';
import { reserveCallForDecision } from '@/features/calls/application/request-call';
import { sql } from '@/lib/db/orchestrator';

/**
 * The atomic half of the A→B bridge, against a real database: a Decision v4
 * with `request_call_now` reserves exactly one call session in the same
 * transaction as the decision, with backend-derived consent — and every
 * refusal path reserves nothing at all.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

interface Identity {
  phone: string;
  conversation: string;
  user: string;
}

function newIdentity(): Identity {
  const seed = randomUUID();
  return {
    phone: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    conversation: `conversation-${seed}`,
    user: `user-${seed}`,
  };
}

function envelope(identity: Identity, text: string): InboundEnvelope {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-call-handoff',
    external_message_id: `message-${randomUUID()}`,
    external_conversation_id: identity.conversation,
    external_user_id: identity.user,
    phone_e164: identity.phone,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  } as InboundEnvelope;
}

async function seedTurn(identity: Identity, text: string): Promise<string> {
  const context = await processInboundMessage(envelope(identity, text));
  return context.turn_id;
}

const CONFIRMATION = 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.';

function callConfirmation(reason: 'direct_request' | 'accepted_offer') {
  return {
    schema_version: 4 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response: CONFIRMATION,
    response_type: 'call_confirmation' as const,
    business_action: { type: 'request_call_now' as const, reason, course_of_interest: 'Python' },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed' as const,
    reason_code: 'CALL_CONSENT_ACCEPTED',
    confidence: 1,
    retrieval_used: null,
  };
}

function callOffer() {
  return {
    schema_version: 4 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response: '¿Querés que te llamemos a este número?',
    response_type: 'call_offer' as const,
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user' as const,
    reason_code: 'CALL_OFFER_PROPOSED',
    confidence: 1,
    retrieval_used: null,
  };
}

function commit(turnId: string, decision: Record<string, unknown>) {
  return commitAgentDecision({
    turn_id: turnId,
    trace_id: randomUUID(),
    decision: decision as never,
    model: {
      provider: 'botpress',
      model: 'vitest',
      prompt_version: 'studyx-agent-a-sales-bridge-v1',
    },
  });
}

async function sessionsByTurn(turnId: string) {
  return db!<Array<{
    id: string;
    status: string;
    consent_source_message_id: string;
    offered_by_decision_id: string | null;
    context_hash_hex: string;
  }>>`
    SELECT id, status, consent_source_message_id, offered_by_decision_id,
           encode(context_hash, 'hex') AS context_hash_hex
    FROM call_sessions WHERE source_turn_id = ${turnId}::uuid
  `;
}

run('agent a call handoff — reservation', () => {
  it('a direct request reserves exactly one session with derived consent', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Llamame ahora');

    const result = await commit(turnId, callConfirmation('direct_request'));

    expect(result.status).toBe('committed');
    expect(result.call_request).not.toBeNull();
    const sessions = await sessionsByTurn(turnId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(result.call_request!.call_id);
    expect(sessions[0].status).toBe('requested');
    expect(sessions[0].consent_source_message_id).toBe(turnId);
    expect(sessions[0].offered_by_decision_id).toBeNull();

    const events = await db!<Array<{ event_type: string }>>`
      SELECT event_type FROM call_events WHERE call_id = ${sessions[0].id}::uuid
    `;
    expect(events).toEqual([{ event_type: 'requested' }]);
  });

  it('ten identical replays return the same call_id and keep one session', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Llamame ahora');
    const decision = callConfirmation('direct_request');

    const first = await commit(turnId, decision);
    const callId = first.call_request!.call_id;
    for (let i = 0; i < 9; i += 1) {
      const replay = await commit(turnId, decision);
      expect(replay.status).toBe('duplicate');
      expect(replay.call_request?.call_id).toBe(callId);
    }
    expect(await sessionsByTurn(turnId)).toHaveLength(1);
  });

  it('two concurrent commits agree on one call_id', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Llamame ahora');
    const decision = callConfirmation('direct_request');

    const [a, b] = await Promise.all([commit(turnId, decision), commit(turnId, decision)]);
    expect(a.call_request?.call_id).toBeDefined();
    expect(a.call_request?.call_id).toBe(b.call_request?.call_id);
    expect(await sessionsByTurn(turnId)).toHaveLength(1);
  });

  it('an accepted open offer reserves once and links the offer decision', async () => {
    const identity = newIdentity();
    const offerTurn = await seedTurn(identity, 'Quiero saber precios de Python');
    const offered = await commit(offerTurn, callOffer());
    expect(offered.status).toBe('committed');
    // High intent without consent: an offer alone never creates a session.
    expect(offered.call_request).toBeNull();
    expect(await sessionsByTurn(offerTurn)).toHaveLength(0);

    const acceptTurn = await seedTurn(identity, 'sí');
    const accepted = await commit(acceptTurn, callConfirmation('accepted_offer'));
    expect(accepted.call_request).not.toBeNull();
    const sessions = await sessionsByTurn(acceptTurn);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].offered_by_decision_id).toBe(offered.decision_id);
  });
});

run('agent a call handoff — refusals reserve nothing', () => {
  async function expectRejected(turnId: string, decision: Record<string, unknown>, reason: string) {
    await expect(commit(turnId, decision)).rejects.toMatchObject(
      expect.objectContaining({ reason }) as never,
    );
    expect(await sessionsByTurn(turnId)).toHaveLength(0);
    const committed = await db!<Array<{ id: string }>>`
      SELECT id FROM agent_decisions WHERE turn_id = ${turnId}::uuid
    `;
    expect(committed).toHaveLength(0);
  }

  it('a bare "sí" without an open offer is rejected', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'sí');
    await expectRejected(turnId, callConfirmation('accepted_offer'), 'CALL_OFFER_MISSING');
  });

  it('a negation beats any affirmative word', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Sí, pero no me llames');
    // "no me llames" ya revoca consentimiento en el ingest, así que la
    // guardia más temprana (CONSENT_REVOKED) puede ganarle a la de consenso
    // de voz (CALL_EXPLICITLY_DECLINED). Cualquiera de las dos vale: lo
    // inviolable es que no se commitea decisión ni se reserva llamada.
    let reason: string | null = null;
    try {
      await commit(turnId, callConfirmation('accepted_offer'));
    } catch (error) {
      reason = (error as DecisionPolicyError).reason;
    }
    expect(['CALL_EXPLICITLY_DECLINED', 'CONSENT_REVOKED']).toContain(reason);
    expect(await sessionsByTurn(turnId)).toHaveLength(0);
    const committed = await db!<Array<{ id: string }>>`
      SELECT id FROM agent_decisions WHERE turn_id = ${turnId}::uuid
    `;
    expect(committed).toHaveLength(0);
  });

  it('an expired offer no longer authorizes the acceptance', async () => {
    const identity = newIdentity();
    const offerTurn = await seedTurn(identity, 'Quiero saber precios');
    const offered = await commit(offerTurn, callOffer());
    await db!`
      UPDATE agent_decisions
      SET created_at = created_at - interval '16 minutes'
      WHERE id = ${offered.decision_id}::uuid
    `;
    const acceptTurn = await seedTurn(identity, 'sí');
    await expectRejected(acceptTurn, callConfirmation('accepted_offer'), 'CALL_OFFER_EXPIRED');
  });

  it('an absent or unparseable phone is refused fail-closed', async () => {
    // La base ya fuerza E.164 en contacts.phone, así que esta defensa del
    // dominio se prueba directamente: es la que corta si esa invariante
    // cambiara o el dato llegara degradado.
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Llamame ahora');
    for (const phone of [null, 'sin-telefono', '54911']) {
      await expect(
        reserveCallForDecision(db!, {
          turn_id: turnId,
          trace_id: randomUUID(),
          decision_id: randomUUID(),
          contact_id: randomUUID(),
          conversation_id: randomUUID(),
          contact_name: null,
          phone,
          turn_text: 'Llamame ahora',
          course_of_interest: null,
          prompt_version: 'studyx-agent-a-sales-bridge-v1',
        }),
      ).rejects.toMatchObject({ reason: 'CALL_PHONE_INVALID' });
    }
    expect(await sessionsByTurn(turnId)).toHaveLength(0);
  });

  it('a blocked contact cannot request a call', async () => {
    const identity = newIdentity();
    const turnId = await seedTurn(identity, 'Llamame ahora');
    await db!`
      UPDATE contacts SET lifecycle_status = 'blocked', blocked_at = now()
      WHERE phone = ${identity.phone}
    `;
    await expect(commit(turnId, callConfirmation('direct_request'))).rejects.toBeInstanceOf(
      DecisionPolicyError,
    );
    expect(await sessionsByTurn(turnId)).toHaveLength(0);
  });

  it('an active call blocks a second reservation for the same contact', async () => {
    const identity = newIdentity();
    const firstTurn = await seedTurn(identity, 'Llamame ahora');
    const first = await commit(firstTurn, callConfirmation('direct_request'));
    expect(first.call_request).not.toBeNull();

    const secondTurn = await seedTurn(identity, 'Llamame ya');
    await expectRejected(secondTurn, callConfirmation('direct_request'), 'ACTIVE_CALL_IN_PROGRESS');
  });
});

run('agent a → agent b end to end', () => {
  it('dispatches the reserved call to Telegram B with a verifiable context hash', async () => {
    // Identidad sandbox: sandbox_identities exige el prefijo sintético +999.
    const identity: Identity = {
      ...newIdentity(),
      phone: `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`,
    };
    const turnId = await seedTurn(identity, 'Llamame ahora');
    const committed = await commit(turnId, callConfirmation('direct_request'));
    const callId = committed.call_request!.call_id;

    const contactRows = await db!<Array<{ contact_id: string }>>`
      SELECT contact_id FROM messages WHERE id = ${turnId}::uuid
    `;
    const userId = `user-${randomUUID()}`;
    const chatId = `chat-${randomUUID()}`;
    await db!`
      INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES ('telegram_sandbox', ${userId}, ${contactRows[0].contact_id}::uuid, ${identity.phone})
    `;

    const receipts = new PostgresContextReceiptStore(db!, {
      expectedChatId: chatId,
      expectedUserId: userId,
    });
    await receipts.registerBinding({ chatId, userId, startedAt: new Date().toISOString() });
    const telegram = {
      sendMessage: vi.fn(async (input: TelegramSendMessageInput) => {
        void input;
        return { messageId: '99', acceptedAt: new Date().toISOString() };
      }),
      answerCallbackQuery: vi.fn(async () => undefined),
    };
    const provider = new TelegramSimVoiceProvider({
      receipts,
      destinationResolver: receipts,
      telegram,
      nonce: () => `nonce_${callId.replaceAll('-', '').slice(0, 16)}`,
    });
    const store = new PostgresCallStore(db!);

    const first = await dispatchCall({ callId, workerId: 'e2e-1' }, { store, provider });
    expect(first.status).toBe('provider_accepted');
    const replay = await dispatchCall({ callId, workerId: 'e2e-replay' }, { store, provider });
    expect(replay).toEqual(first);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);

    // B's receipt proves it loaded exactly the persisted context: the ack's
    // hash is recomputed from the transported payload and must match the
    // session's stored hash byte for byte.
    const evidence = await db!<Array<{ receipt_hash: string; session_hash: string; status: string }>>`
      SELECT encode(r.context_hash, 'hex') AS receipt_hash,
             encode(s.context_hash, 'hex') AS session_hash,
             s.status
      FROM call_context_receipts AS r
      JOIN call_sessions AS s ON s.id = r.call_id
      WHERE r.call_id = ${callId}::uuid
    `;
    expect(evidence).toHaveLength(1);
    expect(evidence[0].receipt_hash).toBe(evidence[0].session_hash);
    expect(evidence[0].status).toBe('provider_accepted');
  });
});
