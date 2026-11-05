import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import type { TelegramSendMessageInput } from '@/features/calls/adapters/telegram-bot-api.client';
import { openLocalTestDatabase } from '../helpers/db';
import { seedWrittenCallIntakeV1 } from '../helpers/call-intake-fixtures';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, DecisionPolicyError } from '@/lib/services/decision.service';
import { reserveCallForDecision } from '@/features/calls/application/request-call';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';

/**
 * The atomic half of the A→B bridge, against a real database: a Decision v4
 * with `request_call_now` reserves exactly one call session in the same
 * transaction as the decision, with backend-derived consent — and every
 * refusal path reserves nothing at all.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const seededCallIntake = new Set<string>();

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
  if (!seededCallIntake.has(identity.conversation)) {
    await seedWrittenCallIntakeV1({
      phone: identity.phone,
      correo: `ana.${randomUUID()}@example.test`,
      ...(identity.phone.startsWith('+999')
        ? { telefono: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}` }
        : {}),
    }, db!);
    seededCallIntake.add(identity.conversation);
  }
  const context = await processInboundMessage(envelope(identity, text));
  const [workspace] = await sql<Array<{ id: string }>>`
    SELECT id FROM workspaces WHERE slug = 'studyx' AND status = 'active' LIMIT 1
  `;
  if (!workspace) throw new Error('CALL_HANDOFF_WORKSPACE_MISSING');
  const memberships = await sql<Array<{ lifecycle_status: string; source_channel: string | null }>>`
    SELECT lifecycle_status, source_channel
    FROM workspace_contacts
    WHERE workspace_id = ${workspace.id}::uuid
      AND contact_id = ${context.contact.id}::uuid
  `;
  expect(memberships).toEqual([{ lifecycle_status: 'active', source_channel: 'whatsapp' }]);
  await sql`
    INSERT INTO sales_context_states (
      workspace_id, contact_id, conversation_id, stage
    ) VALUES (
      ${workspace.id}::uuid, ${context.contact.id}::uuid,
      ${context.conversation_id}::uuid, 'exploring'
    )
    ON CONFLICT (workspace_id, contact_id) DO NOTHING
  `;
  return context.turn_id;
}

const CONFIRMATION = 'Recibí tu solicitud de llamada.';

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

async function markAwaitingCallAvailability(turnId: string) {
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, call_preference,
      call_offer_status, call_offer_count, awaiting_reply, stage, source_turn_id
    )
    SELECT workspace.id, message.conversation_id, message.contact_id,
           'call', 'accepted', 0, 'call_or_chat', 'exploring', NULL::uuid
    FROM messages AS message
    JOIN workspaces AS workspace ON workspace.slug = 'studyx' AND workspace.status = 'active'
    WHERE message.id = ${turnId}::uuid
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE
    SET call_preference = 'call', call_offer_status = 'accepted',
        call_offer_count = 0, awaiting_reply = 'call_or_chat',
        stage = 'exploring', source_turn_id = EXCLUDED.source_turn_id,
        version = conversation_sales_context_states_v1.version + 1, updated_at = now()
  `;
}

function commitPreparedAvailabilityCall(turnId: string, response = CONFIRMATION, revocation?: 'repair' | 'operational') {
  return commitAgentDecision({
    turn_id: turnId,
    trace_id: randomUUID(),
    authorized_offering_code: null,
    authorized_payment_plan: null,
    conversation_pipeline_v1: null,
    agent_turn_v2: {
      schema_version: 2,
      ...(revocation ? { conversation_only: true } : {}),
      ...(revocation === 'operational' ? { operational_continuity: 'call_consent_revoked' } : {}),
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: revocation ? 'decline_call' : 'request_call', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: { messages: [response], call_offer: null },
        proposed_action: revocation ? { type: 'none' } : { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        profile_updates: [], profile_requests: [], repair_of: null,
      },
    },
    supports_multi_outbound: true,
    decision: { ...callConfirmation('direct_request'), response },
    model: {
      provider: 'botpress', model: 'deterministic:direct-call-availability-v1',
      prompt_version: 'studyx-agent-a-brain-plannerless-test',
    },
  });
}

const QUALIFIED_GUIDANCE = 'Te ayudo a revisar si encaja con lo que buscás.';
const NATURAL_CALL_OFFER = 'Y si querés, te llamo y lo vemos.';

function commitPreparedCallOffer(turnId: string) {
  return commitAgentDecision({
    turn_id: turnId,
    trace_id: randomUUID(),
    authorized_offering_code: null,
    authorized_payment_plan: null,
    conversation_pipeline_v1: null,
    agent_turn_v2: {
      schema_version: 2,
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'marketing_digital',
          confidence: 1,
        },
        response: { messages: [QUALIFIED_GUIDANCE], call_offer: NATURAL_CALL_OFFER },
        proposed_action: { type: 'none' },
        used_fact_ids: [],
        used_memory_ids: [],
        memory_candidates: [],
        profile_updates: [],
        profile_requests: [],
        repair_of: null,
      },
    },
    supports_multi_outbound: true,
    decision: {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: `${QUALIFIED_GUIDANCE}\n\n${NATURAL_CALL_OFFER}`,
      response_type: 'call_offer',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      reason_code: 'CALL_OFFER_PROPOSED',
      confidence: 1,
      retrieval_used: null,
    },
    model: {
      provider: 'botpress', model: 'vitest-terminal-call-reoffer',
      prompt_version: 'studyx-agent-a-brain-plannerless-test',
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
  it('persists a new offer after a terminal call from inherited course-selected state', async () => {
    const identity = newIdentity();
    const firstTurn = await seedTurn(identity, 'Llamame ahora');
    const first = await commit(firstTurn, callConfirmation('direct_request'));
    const callId = first.call_request!.call_id;

    await db!`
      UPDATE call_sessions
      SET status = 'no_answer', analysis_status = 'completed',
          result = 'buzon_de_voz', completed_at = now(), updated_at = now()
      WHERE id = ${callId}::uuid
    `;
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, selected_offering_code,
        stage, call_preference, call_offer_status, call_offer_count,
        awaiting_reply, source_turn_id
      )
      SELECT workspace.id, message.conversation_id, message.contact_id,
             'marketing_digital', 'course_selected', 'call', 'accepted', 0,
             'none', message.id
      FROM messages AS message
      JOIN workspaces AS workspace ON workspace.slug = 'studyx' AND workspace.status = 'active'
      WHERE message.id = ${firstTurn}::uuid
      ON CONFLICT (workspace_id, conversation_id) DO UPDATE
      SET selected_offering_code = 'marketing_digital', stage = 'course_selected',
          call_preference = 'call', call_offer_status = 'accepted',
          call_offer_count = 0, awaiting_reply = 'none',
          source_turn_id = EXCLUDED.source_turn_id,
          version = conversation_sales_context_states_v1.version + 1,
          updated_at = now()
    `;

    const offerTurn = await seedTurn(identity, 'Contame si Marketing me puede servir');
    const committed = await commitPreparedCallOffer(offerTurn);
    expect(committed.status).toBe('committed');

    const replay = await commitPreparedCallOffer(offerTurn);
    expect(replay.status).toBe('duplicate');

    const state = await db!<Array<{
      stage: string;
      call_preference: string;
      call_offer_status: string;
      call_offer_count: number;
      awaiting_reply: string;
      events: number;
    }>>`
      SELECT state.stage, state.call_preference, state.call_offer_status,
             state.call_offer_count, state.awaiting_reply,
             (SELECT count(*)::int
                FROM conversation_sales_context_state_events_v1 AS event
               WHERE event.workspace_id = state.workspace_id
                 AND event.conversation_id = state.conversation_id
                 AND event.source_turn_id = ${offerTurn}::uuid) AS events
      FROM conversation_sales_context_states_v1 AS state
      WHERE state.conversation_id = (
        SELECT conversation_id FROM messages WHERE id = ${offerTurn}::uuid
      )
    `;
    expect(state).toEqual([{
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      call_offer_count: 1,
      awaiting_reply: 'call_or_chat',
      events: 1,
    }]);
  });

  it('the Agent Turn availability path reserves once and points at the exact affirmative message', async () => {
    const identity = newIdentity();
    const acceptanceTurn = await seedTurn(identity, 'Sí, dale');
    await seedTurn(identity, 'gracias');
    await markAwaitingCallAvailability(acceptanceTurn);

    const committed = await commitPreparedAvailabilityCall(acceptanceTurn);
    expect(committed.status).toBe('committed');
    expect(await sessionsByTurn(acceptanceTurn)).toEqual([
      expect.objectContaining({
        consent_source_message_id: acceptanceTurn,
        offered_by_decision_id: null,
      }),
    ]);

    const replay = await commitPreparedAvailabilityCall(acceptanceTurn);
    expect(replay.status).toBe('duplicate');
    expect(await sessionsByTurn(acceptanceTurn)).toHaveLength(1);
  });

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
    const salesState = await db!<Array<{ stage: string }>>`
      SELECT stage FROM sales_context_states WHERE contact_id = (
        SELECT contact_id FROM messages WHERE id = ${turnId}::uuid
      )
    `;
    expect(salesState).toEqual([{ stage: 'handoff' }]);
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

  it('a direct request buried inside a batch still reserves the call', async () => {
    const identity = newIdentity();
    // Three messages land in the same inbound window; the batch's
    // representative turn is the FIRST one, whose text alone carries no
    // consent. The buried "llamame" must still authorize the reservation.
    const representativeTurn = await seedTurn(identity, '¿Los sábados de 15 a 17 es en vivo?');
    await seedTurn(identity, 'llamame y lo vemos');
    await seedTurn(identity, 'gracias!');

    const result = await commit(representativeTurn, callConfirmation('direct_request'));
    expect(result.call_request?.call_id).toBeDefined();
    expect(await sessionsByTurn(representativeTurn)).toHaveLength(1);
  });

  it('a decline after a buried request in the same batch blocks the call', async () => {
    const identity = newIdentity();
    // The newest decisive message wins: the customer asked and then took it
    // back inside the same burst. Consent must NOT ride on the first message.
    const representativeTurn = await seedTurn(identity, 'llamame');
    await seedTurn(identity, 'no, mejor no me llames');

    await expect(commit(representativeTurn, callConfirmation('direct_request')))
      .rejects.toBeInstanceOf(DecisionPolicyError);
    expect(await sessionsByTurn(representativeTurn)).toHaveLength(0);
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
    // Rechazar voz mantiene WhatsApp abierto, pero la guardia de consentimiento
    // de llamada igualmente impide reservar o commitear la llamada.
    let reason: string | null = null;
    try {
      await commit(turnId, callConfirmation('accepted_offer'));
    } catch (error) {
      reason = (error as DecisionPolicyError).reason;
    }
    expect(reason).toBe('CALL_EXPLICITLY_DECLINED');
    expect(await sessionsByTurn(turnId)).toHaveLength(0);
    const committed = await db!<Array<{ id: string }>>`
      SELECT id FROM agent_decisions WHERE turn_id = ${turnId}::uuid
    `;
    expect(committed).toHaveLength(0);
  });

  it.each(['no', 'no, mejor no'])(
    'a trailing short refusal (%s) blocks the call and persists no consent',
    async (refusal) => {
      const identity = newIdentity();
      const representativeTurn = await seedTurn(identity, 'sí, dale');
      await seedTurn(identity, refusal);

      await expectRejected(
        representativeTurn,
        callConfirmation('direct_request'),
        'CALL_EXPLICITLY_DECLINED',
      );
    },
  );

  it.each(['ahora no', 'por ahora no', 'prefiero que no'])(
    'the Agent Turn availability path honors a later contextual refusal (%s)',
    async (refusal) => {
      const identity = newIdentity();
      const representativeTurn = await seedTurn(identity, 'Sí, dale');
      await seedTurn(identity, refusal);
      await markAwaitingCallAvailability(representativeTurn);

      await expect(commitPreparedAvailabilityCall(representativeTurn)).rejects.toMatchObject({
        reason: expect.stringContaining('ACTION_NOT_AUTHORIZED'),
      });
      const repaired = await commitPreparedAvailabilityCall(representativeTurn, 'Seguimos por acá.', 'repair');
      expect(repaired).toMatchObject({ status: 'committed', call_request: null });
      expect(await sessionsByTurn(representativeTurn)).toHaveLength(0);
      const [persisted] = await db!`SELECT call_preference,call_offer_status
        FROM conversation_sales_context_states_v1 WHERE conversation_id=(
          SELECT conversation_id FROM messages WHERE id=${representativeTurn}::uuid)`;
      expect(persisted).toMatchObject({ call_preference: 'chat', call_offer_status: 'declined' });
    },
  );

  it('persists revoked consent after exhausted repair and cannot reuse it on a later bare yes', async () => {
    const identity = newIdentity();
    const turn = await seedTurn(identity, 'Sí, dale');
    await seedTurn(identity, 'ahora no');
    await markAwaitingCallAvailability(turn);
    await expect(commitPreparedAvailabilityCall(turn)).rejects.toMatchObject({ code: 'DECISION_REJECTED' });
    const receipt = await commitPreparedAvailabilityCall(turn, 'Seguimos por acá.', 'operational');
    expect(receipt).toMatchObject({ status: 'committed', call_request: null });
    expect(receipt.outbound?.content).toBe('Seguimos por acá.');
    expect((await commitPreparedAvailabilityCall(turn, 'Seguimos por acá.', 'operational')).status).toBe('duplicate');
    expect(await sessionsByTurn(turn)).toHaveLength(0);
    const nextTurn = await seedTurn(identity, 'sí');
    await expect(commitPreparedAvailabilityCall(nextTurn)).rejects.toMatchObject({ code: 'DECISION_REJECTED' });
    expect(await sessionsByTurn(nextTurn)).toHaveLength(0);
    const [state] = await db!`SELECT call_preference,call_offer_status,awaiting_reply FROM conversation_sales_context_states_v1
      WHERE conversation_id=(SELECT conversation_id FROM messages WHERE id=${nextTurn}::uuid)`;
    expect(state).toMatchObject({ call_preference: 'chat', call_offer_status: 'declined', awaiting_reply: 'none' });
    const anotherYes = await seedTurn(identity, 'sí');
    await expect(commitPreparedAvailabilityCall(anotherYes)).rejects.toMatchObject({ code: 'DECISION_REJECTED' });
    expect(await sessionsByTurn(anotherYes)).toHaveLength(0);
    const [audit] = await db!`SELECT payload FROM audit_log WHERE action='agent.decision.committed' AND payload->>'turn_id'=${turn}`;
    expect(audit.payload.operational_continuity).toBe('call_consent_revoked');
  });

  it('rejects an outdated revocation receipt after a new availability authorization', async () => {
    const identity = newIdentity();
    const turn = await seedTurn(identity, 'Sí, dale');
    await seedTurn(identity, 'ahora no');
    await markAwaitingCallAvailability(turn);
    await expect(commitPreparedAvailabilityCall(turn)).rejects.toMatchObject({ code: 'DECISION_REJECTED' });
    await seedTurn(identity, 'Sí, puedo atender ahora');
    await expect(commitPreparedAvailabilityCall(turn, 'Seguimos por acá.', 'operational'))
      .rejects.toMatchObject({ code: 'DECISION_REJECTED' });
    expect(await sessionsByTurn(turn)).toHaveLength(0);
  });

  it('rejects false dispatch prose after later consent was revoked', async () => {
    const identity = newIdentity();
    const turn = await seedTurn(identity, 'Sí, dale');
    await seedTurn(identity, 'ahora no');
    await markAwaitingCallAvailability(turn);
    await expect(commitPreparedAvailabilityCall(turn,
      'Perfecto. Registré la llamada; nuestra asesora intenta comunicarse ahora.'))
      .rejects.toMatchObject({ code: 'DECISION_REJECTED', reason: expect.stringContaining('AGENT_TURN_V2_REJECTED') });
    expect(await sessionsByTurn(turn)).toHaveLength(0);
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

  it('an explicit direct request overrides a stale accepted-offer label', async () => {
    const identity = newIdentity();
    const offerTurn = await seedTurn(identity, 'Quiero saber precios');
    const offered = await commit(offerTurn, callOffer());
    await db!`
      UPDATE agent_decisions
      SET created_at = created_at - interval '16 minutes'
      WHERE id = ${offered.decision_id}::uuid
    `;

    const directTurn = await seedTurn(identity, 'Llamame');
    const committed = await commit(directTurn, callConfirmation('accepted_offer'));

    expect(committed.call_request).not.toBeNull();
    expect(await sessionsByTurn(directTurn)).toEqual([
      expect.objectContaining({ offered_by_decision_id: null }),
    ]);
  });

  it('an incomplete durable profile is refused even when the caller supplies a spoofed phone argument', async () => {
    const identity = newIdentity();
    const context = await processInboundMessage({
      ...envelope(identity, 'Llamame ahora'),
      identity_owner: 'agent_a_v1',
    });
    await expect(reserveCallForDecision(db!, {
      turn_id: context.turn_id,
      trace_id: randomUUID(),
      decision_id: randomUUID(),
      contact_id: context.contact.id,
      conversation_id: context.conversation_id,
      contact_name: 'Dato no canónico',
      phone: '+5491199999999',
      consent_messages: [{ id: context.turn_id, content: 'Llamame ahora' }],
      course_of_interest: null,
      prompt_version: 'studyx-agent-a-sales-bridge-v1',
    })).rejects.toMatchObject({ reason: 'CALL_INTAKE_INCOMPLETE' });
    expect(await sessionsByTurn(context.turn_id)).toHaveLength(0);
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

  // 2026-11-05 (5b138536): «termina en 8, no en 7» y la llamada salió al 4497.
  it('a proposed phone correction blocks the call until confirmed, then the dispatch carries the corrected number', async () => {
    const identity = newIdentity();
    const corrected = `${identity.phone.slice(0, -1)}${identity.phone.endsWith('8') ? '7' : '8'}`;
    const correctionTurn = await seedTurn(identity, `me confundí, mi número termina en ${corrected.slice(-1)}`);
    const suggest = async (afterTurn: string) => {
      const [turn] = await db!<Array<{ conversation_id: string; contact_id: string; phone: string }>>`
        SELECT m.conversation_id, m.contact_id, c.phone FROM messages m JOIN contacts c ON c.id = m.contact_id
        WHERE m.id = ${afterTurn}::uuid`;
      const [reply] = await db!<Array<{ id: string }>>`
        INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to)
        VALUES (${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'outbound',
          ${`Entonces sería ${corrected}, ¿me confirmás?`}, ${afterTurn}::uuid) RETURNING id`;
      await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
        channel, destination, idempotency_key, state, provider_message_id, submitted_at)
        VALUES (${reply.id}::uuid, ${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'botpress', 'vitest-call-handoff',
          'whatsapp', ${turn.phone}, ${randomUUID()}, 'submitted', ${randomUUID()}, now())`;
    };
    await suggest(correctionTurn);
    const callAgain = await seedTurn(identity, 'Llamame ahora');
    await expectRejected(callAgain, callConfirmation('direct_request'), 'CALL_PHONE_CONFIRMATION_PENDING');

    const yes = await seedTurn(identity, 'sí');
    const { confirmDeliveredContactPhone } = await import('@/lib/repositories/contact-phone-confirmation.repository');
    expect(await db!.begin(tx => confirmDeliveredContactPhone({ turnId: yes, phone: corrected }, tx))).toBe(true);
    const callNow = await seedTurn(identity, 'Llamame ahora');
    const committed = await commit(callNow, callConfirmation('direct_request'));
    expect(committed.call_request).not.toBeNull();
    const claim = await new PostgresCallStore(db!).claimDispatch(committed.call_request!.call_id, 'vitest-worker');
    expect(JSON.stringify(claim)).toContain(corrected);
    expect(JSON.stringify(claim)).not.toContain(`"${identity.phone}"`);
  });

  // Golden replay 7448925 c05–c07: the correction was proposed, the next reply asked
  // «¿Puedes atender ahora?» without the number, and the call went to the old one.
  it('a correction proposed two replies ago still blocks the call until confirmed', async () => {
    const identity = newIdentity();
    const corrected = `${identity.phone.slice(0, -1)}${identity.phone.endsWith('8') ? '7' : '8'}`;
    const deliver = async (afterTurn: string, content: string) => {
      const [turn] = await db!<Array<{ conversation_id: string; contact_id: string; phone: string }>>`
        SELECT m.conversation_id, m.contact_id, c.phone FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.id = ${afterTurn}::uuid`;
      const [reply] = await db!<Array<{ id: string }>>`
        INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to)
        VALUES (${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'outbound', ${content}, ${afterTurn}::uuid) RETURNING id`;
      await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
        channel, destination, idempotency_key, state, provider_message_id, submitted_at)
        VALUES (${reply.id}::uuid, ${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'botpress', 'vitest-call-handoff',
          'whatsapp', ${turn.phone}, ${randomUUID()}, 'submitted', ${randomUUID()}, now())`;
    };
    const correction = await seedTurn(identity, `termina en ${corrected.slice(-1)}, no en ${identity.phone.slice(-1)}`);
    await deliver(correction, `Entonces tu número correcto es ${corrected}, ¿me lo confirmás?`);
    const again = await seedTurn(identity, 'me volves a llamar?');
    await deliver(again, 'Claro. ¿Puedes atender ahora?');
    const callTurn = await seedTurn(identity, 'Llamame ahora');
    await expectRejected(callTurn, callConfirmation('direct_request'), 'CALL_PHONE_CONFIRMATION_PENDING');
  });

  it('a delivered price reply never counts as a pending phone correction', async () => {
    const identity = newIdentity();
    const priceTurn = await seedTurn(identity, 'cuánto sale?');
    const [turn] = await db!<Array<{ conversation_id: string; contact_id: string; phone: string }>>`
      SELECT m.conversation_id, m.contact_id, c.phone FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.id = ${priceTurn}::uuid`;
    const [reply] = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to)
      VALUES (${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'outbound',
        'Son USD 360.000 (12 x 30.000) o 450.000 - 30 de anticipo.', ${priceTurn}::uuid) RETURNING id`;
    await db!`INSERT INTO outbound_deliveries (message_id, conversation_id, contact_id, provider, integration_id,
      channel, destination, idempotency_key, state, provider_message_id, submitted_at)
      VALUES (${reply.id}::uuid, ${turn.conversation_id}::uuid, ${turn.contact_id}::uuid, 'botpress', 'vitest-call-handoff',
        'whatsapp', ${turn.phone}, ${randomUUID()}, 'submitted', ${randomUUID()}, now())`;
    const callTurn = await seedTurn(identity, 'Llamame ahora');
    expect((await commit(callTurn, callConfirmation('direct_request'))).call_request).not.toBeNull();
  });

  it('an active call blocks a second reservation for the same contact', async () => {
    const identity = newIdentity();
    const firstTurn = await seedTurn(identity, 'Llamame ahora');
    const first = await commit(firstTurn, callConfirmation('direct_request'));
    expect(first.call_request).not.toBeNull();

    const secondTurn = await seedTurn(identity, 'Llamame ya');
    await expectRejected(secondTurn, callConfirmation('direct_request'), 'ACTIVE_CALL_IN_PROGRESS');
  });

  it('expires a provider-accepted call that never started and permits a fresh request', async () => {
    const identity = newIdentity();
    const firstTurn = await seedTurn(identity, 'Llamame ahora');
    const first = await commit(firstTurn, callConfirmation('direct_request'));
    const staleCallId = first.call_request!.call_id;

    await db!`
      UPDATE call_sessions
      SET status = 'provider_accepted',
          provider_call_id = ${`stale:${staleCallId}`},
          provider_accepted_at = now() - interval '16 minutes'
      WHERE id = ${staleCallId}::uuid
    `;

    const identityRows = await db!<Array<{ contact_id: string; conversation_id: string }>>`
      SELECT contact_id, conversation_id
      FROM messages
      WHERE id = ${firstTurn}::uuid
    `;
    const facts = await new PostgresOrchestrationStore(db!).loadClaimedCallFacts(identityRows[0]);
    expect(facts.active_call).toBeNull();

    const secondTurn = await seedTurn(identity, 'Quiero que me llames');
    const second = await commit(secondTurn, callConfirmation('direct_request'));
    expect(second.call_request?.call_id).toBeDefined();
    expect(second.call_request?.call_id).not.toBe(staleCallId);

    const rows = await db!<Array<{ id: string; status: string; error_code: string | null }>>`
      SELECT id, status, error_code
      FROM call_sessions
      WHERE id IN (${staleCallId}::uuid, ${second.call_request!.call_id}::uuid)
      ORDER BY created_at
    `;
    expect(rows).toEqual([
      { id: staleCallId, status: 'timed_out', error_code: 'CALL_START_TIMEOUT' },
      { id: second.call_request!.call_id, status: 'requested', error_code: null },
    ]);
  });
});

run('agent a → agent b end to end', () => {
  it('two concurrent dispatches send exactly one Telegram message', async () => {
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

    const sendMessage = vi.fn(async (input: TelegramSendMessageInput) => {
      void input;
      return { messageId: '77', acceptedAt: new Date().toISOString() };
    });
    const dbA = openLocalTestDatabase();
    const dbB = openLocalTestDatabase();
    try {
      const buildDeps = (client: NonNullable<typeof db>) => {
        const receipts = new PostgresContextReceiptStore(client, {
          expectedChatId: chatId,
          expectedUserId: userId,
        });
        const provider = new TelegramSimVoiceProvider({
          receipts,
          destinationResolver: { resolve: async () => ({ chatId, userId }) },
          telegram: { sendMessage, answerCallbackQuery: vi.fn(async () => undefined) },
          nonce: () => `nonce_${callId.replaceAll('-', '').slice(0, 16)}`,
        });
        return { store: new PostgresCallStore(client), provider };
      };
      const receiptsSetup = new PostgresContextReceiptStore(db!, {
        expectedChatId: chatId,
        expectedUserId: userId,
      });
      await receiptsSetup.registerBinding({ chatId, userId, startedAt: new Date().toISOString() });

      const [first, second] = await Promise.all([
        dispatchCall({ callId, workerId: 'race-a' }, buildDeps(dbA)),
        dispatchCall({ callId, workerId: 'race-b' }, buildDeps(dbB)),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toContain('provider_accepted');
      // The loser either observed the winner's terminal state or hit the lease.
      expect(statuses.every((status) => ['provider_accepted', 'busy'].includes(status))).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      await dbA.end();
      await dbB.end();
    }
  });

  it('an ambiguous dispatch outcome never redials automatically', async () => {
    const identity: Identity = {
      ...newIdentity(),
      phone: `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`,
    };
    const turnId = await seedTurn(identity, 'Llamame ahora');
    const committed = await commit(turnId, callConfirmation('direct_request'));
    const callId = committed.call_request!.call_id;

    const store = new PostgresCallStore(db!);
    const unimplemented = async () => {
      throw new Error('not exercised in this test');
    };
    const timeoutProvider = {
      placeCall: vi.fn(async () => {
        // Unknown outcome: the provider timed out with the result unknowable.
        throw new Error('ETIMEDOUT');
      }),
      findCallByInternalId: unimplemented,
      cancelCall: unimplemented,
    };

    const first = await dispatchCall({ callId, workerId: 'ambiguous-1' }, { store, provider: timeoutProvider });
    expect(first.status).toBe('dispatch_ambiguous');

    // A later dispatch attempt must NOT place a new provider call: ambiguous
    // is terminal for the dispatcher; only explicit reconciliation may act.
    const retryProvider = {
      placeCall: vi.fn(async () => ({ providerCallId: 'x', acceptedAt: new Date().toISOString() })),
      findCallByInternalId: unimplemented,
      cancelCall: unimplemented,
    };
    const retry = await dispatchCall({ callId, workerId: 'ambiguous-2' }, { store, provider: retryProvider });
    expect(retry.status).toBe('dispatch_ambiguous');
    expect(retryProvider.placeCall).not.toHaveBeenCalled();

    const session = await db!<Array<{ status: string }>>`
      SELECT status FROM call_sessions WHERE id = ${callId}::uuid
    `;
    expect(session[0].status).toBe('dispatch_ambiguous');
  });

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
      destinationResolver: { resolve: async () => ({ chatId, userId }) },
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
