import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { sendOutboundMessage } from '@/features/messaging/application/send-outbound-message';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { AuthorizedEgressContentAuthorizer } from '@/features/messaging/adapters/authorized-egress-content-authorizer';
import type { MessageChannel } from '@/features/messaging/ports/message-channel';
import type { CallStatus } from '@/features/calls/domain/call-state';
import type { CallResult } from '@/lib/contracts/call-event';
import { sql } from '@/lib/db/orchestrator';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { mapRetellLifecycleEvent } from '@/features/calls/adapters/retell-lifecycle';
import { recordCallEvent } from '@/features/calls/application/record-call-event';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import type { VoiceProvider } from '@/features/calls/ports/voice-provider';
import { enqueueLeadProjection, leadProjectionKey } from '@/lib/services/projection.service';

/**
 * Spec 007 (B → A) against a real database. Unit tests already cover
 * `decidePostCallFollowup` as a pure function (tests/unit/calls/post-call-followup.test.ts)
 * and pgTAP covers the schema constraints directly. What's missing is the
 * wiring: does the cron, running against real call_sessions/channel_events/
 * contacts rows, actually produce (or withhold) exactly the effect the spec
 * requires? Each test here asserts a row count, not just "no error was thrown".
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const store = new PostgresPostCallFollowupStore(sql);
const postCallChannel: MessageChannel = {
  channel: 'whatsapp',
  provider: 'whatsapp_cloud',
  integrationId: 'post-call-test',
  maxTextLength: 4096,
  async sendText(input) {
    return { providerMessageId: `wamid.${input.correlationId}`, acceptedAt: new Date().toISOString() };
  },
};

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(text: string): InboundEnvelope {
  const identity = randomUUID();
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: 'vitest-post-call-followup',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+549${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
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

/**
 * Creates a real WhatsApp contact/conversation (via the same ingestion path
 * production uses, so `conversations.channel_thread_id` is genuinely
 * resolved) and a `call_sessions` row already in a terminal state, aged past
 * the cron's grace window.
 */
async function seedTerminalCall(overrides: {
  status: CallStatus;
  result?: CallResult | null;
  analysis_status?: 'pending' | 'completed' | 'failed';
  ageMinutes?: number;
  provider?: 'telegram_sandbox' | 'retell';
}) {
  const context = await processInboundMessage(envelope('dale, llamame'));
  const workspaces = await sql<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`post-call-${randomUUID()}`}, 'Post-call test', 'sandbox', 'active')
    RETURNING id
  `;
  await sql`
    INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status)
    VALUES (${workspaces[0].id}::uuid, ${context.contact.id}::uuid, 'active')
  `;
  await sql`
    INSERT INTO conversation_sales_context_states_v1 (workspace_id, conversation_id, contact_id)
    VALUES (${workspaces[0].id}::uuid, ${context.conversation_id}::uuid, ${context.contact.id}::uuid)
  `;
  const callId = randomUUID();
  const callContext = {
    call_id: callId,
    nombre_lead: '',
    curso_interes: 'Python',
    pais: '',
    email_lead: '',
    resumen_whatsapp: 'Llamada preautorizada.',
    prompt_version: 'agent-b-v1',
  };
  const ageMinutes = overrides.ageMinutes ?? 10;

  await sql`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider, request_idempotency_key,
      status, result, analysis_status, consent_source_message_id, context_snapshot, context_hash,
      prompt_version, requested_at, completed_at, updated_at
    ) VALUES (
      ${callId}::uuid, ${context.turn_id}::uuid, ${context.contact.id}::uuid, ${context.conversation_id}::uuid,
      ${overrides.provider ?? 'telegram_sandbox'}, ${`voice-call:${callId}`}, ${overrides.status},
      ${overrides.result ?? null}, ${overrides.analysis_status ?? 'completed'},
      ${context.turn_id}::uuid, ${sql.json(callContext)}, decode(${hashCallContext(callContext)}, 'hex'),
      'agent-b-v1',
      now() - make_interval(mins => ${ageMinutes}),
      now() - make_interval(mins => ${ageMinutes}),
      now() - make_interval(mins => ${ageMinutes})
    )
  `;

  return {
    callId,
    contactId: context.contact.id,
    conversationId: context.conversation_id,
    providerCallId: `retell-${callId}`,
    workspaceId: workspaces[0].id,
  };
}

async function revokeConsent(contactId: string) {
  await sql`
    SELECT * FROM record_contact_permission_event(
      ${'test:' + randomUUID()},
      ${contactId}::uuid,
      'whatsapp',
      'revoked',
      'test_setup',
      null,
      ${sql.json({ reason: 'pre-blocked for FR-5 fixture' })},
      now()
    )
  `;
}

async function sweep(traceId = randomUUID(), graceSeconds = 60) {
  // `listPendingFollowups` orders oldest-first with no per-test scoping, so a
  // generous limit keeps this test's own fixture from being crowded out by
  // whatever else is pending in the shared disposable DB (e.g. FR-4/FR-5's
  // fixtures are deliberately left with no channel_events row forever, since
  // that's the correct "no message" outcome, and accumulate across runs).
  return runPostCallFollowup(
    { trace_id: traceId, grace_seconds: graceSeconds, limit: 500 },
    {
      store,
      sendOutbound: (input) => sendOutboundMessage(input, {
        identities: new PostgresChannelIdentityStore(sql),
        channels: { whatsapp: postCallChannel },
        preferenceOrder: ['whatsapp'],
        contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
        sideEffectAuthorizer: { authorize: async () => ({ allowed: true as const, reason: null }) },
        db: sql,
      }),
    },
  );
}

async function systemCallResultEventCount(callId: string) {
  const rows = await sql<Array<{ count: string }>>`
    SELECT count(*)::text AS count FROM channel_events
    WHERE event_kind = 'system_call_result'
      AND external_event_id = ${'system:call_result:' + callId}
  `;
  return Number(rows[0].count);
}

async function syntheticMessageCount(callId: string) {
  const rows = await sql<Array<{ count: string }>>`
    SELECT count(*)::text AS count FROM messages WHERE metadata->>'call_id' = ${callId}
  `;
  return Number(rows[0].count);
}

async function agentDecisionCountForCall(callId: string) {
  const rows = await sql<Array<{ count: string }>>`
    SELECT count(*)::text AS count
    FROM agent_decisions ad
    JOIN messages m ON m.id = ad.turn_id
    WHERE m.metadata->>'call_id' = ${callId}
  `;
  return Number(rows[0].count);
}

async function outboundDeliveryCountForConversation(conversationId: string) {
  const rows = await sql<Array<{ count: string }>>`
    SELECT count(*)::text AS count
    FROM outbound_deliveries od
    JOIN messages m ON m.id = od.message_id
    WHERE m.conversation_id = ${conversationId}::uuid
  `;
  return Number(rows[0].count);
}

async function consentStatus(contactId: string) {
  const rows = await sql<Array<{ consent_status: string | null }>>`
    SELECT consent_status FROM contact_channel_permissions
    WHERE contact_id = ${contactId}::uuid AND channel = 'whatsapp'
  `;
  return rows[0]?.consent_status ?? null;
}

run('post-call-followup cron (spec 007, B -> A)', () => {
  it('FR-1: a second cron run over the same terminal call emits no second message (idempotent on channel_events UNIQUE)', async () => {
    const { callId, conversationId } = await seedTerminalCall({
      status: 'completed',
      result: 'seguimiento_agendado',
      analysis_status: 'completed',
    });

    const first = await sweep(randomUUID(), 0);
    // The sweep is a global, unscoped query (`listPendingFollowups` has no
    // per-test filter), so `sent`/`skipped`/`revoked` aggregate over whatever
    // else is pending in the shared disposable DB at the time. The real
    // assertion is what happened to THIS call, plus the row counts below.
    expect(first.findings.find((f) => f.call_id === callId)?.action).toBe('send');
    expect(await systemCallResultEventCount(callId)).toBe(1);
    expect(await syntheticMessageCount(callId)).toBe(1);
    expect(await agentDecisionCountForCall(callId)).toBe(0);
    expect(await outboundDeliveryCountForConversation(conversationId)).toBe(1);

    const second = await sweep(randomUUID(), 0);
    // The antijoin in listPendingFollowups no longer selects this call at
    // all once channel_events has its row, so the second run doesn't even
    // examine it -- but the row counts are the real assertion here, not the
    // sweep's own bookkeeping.
    expect(second.findings.find((f) => f.call_id === callId)).toBeUndefined();

    expect(await systemCallResultEventCount(callId)).toBe(1);
    expect(await syntheticMessageCount(callId)).toBe(1);
    expect(await agentDecisionCountForCall(callId)).toBe(0);
    expect(await outboundDeliveryCountForConversation(conversationId)).toBe(1);
  });

  it('FR-3: result = no_contactar emits no message and revokes the contact', async () => {
    const { callId, contactId, conversationId } = await seedTerminalCall({
      status: 'completed',
      result: 'no_contactar',
      analysis_status: 'completed',
    });

    expect(await consentStatus(contactId)).not.toBe('revoked');

    const result = await sweep();
    expect(result.findings.find((f) => f.call_id === callId)).toMatchObject({
      action: 'revoke_contact',
      reason: 'DO_NOT_CONTACT',
    });

    // The system turn is still synthesized (it anchors the revocation with
    // idempotent evidence) but it must never produce an agent_decision or an
    // outbound WhatsApp message.
    expect(await systemCallResultEventCount(callId)).toBe(1);
    expect(await agentDecisionCountForCall(callId)).toBe(0);
    expect(await outboundDeliveryCountForConversation(conversationId)).toBe(0);
    expect(await consentStatus(contactId)).toBe('revoked');
  });

  it('Task 3: pidio_no_contactar revokes before a different analysis result can send follow-up', async () => {
    const fixture = await seedTerminalCall({
      status: 'completed',
      result: 'seguimiento_agendado',
      analysis_status: 'completed',
      provider: 'retell',
    });
    await new PostgresCallStore(sql).appendEvent({
      schema_version: 1,
      event_id: `retell:call_analyzed:${fixture.providerCallId}`,
      call_id: fixture.callId,
      event_type: 'analyzed',
      sequence: 3,
      occurred_at: new Date().toISOString(),
      provider: 'retell',
      payload: {
        event_type: 'analyzed',
        analysis: {
          result: 'seguimiento_agendado',
          nivel_interes: 'alto',
          objecion: null,
          notas: 'La persona pidió no recibir más contactos.',
          pidio_no_contactar: true,
        },
      },
    });

    const result = await sweep();
    expect(result.findings.find((finding) => finding.call_id === fixture.callId)).toMatchObject({
      action: 'revoke_contact',
      reason: 'DO_NOT_CONTACT',
    });
    expect(await consentStatus(fixture.contactId)).toBe('revoked');
    expect(await outboundDeliveryCountForConversation(fixture.conversationId)).toBe(0);
  });

  it('Task 3: pago_confirmado from Retell cannot manufacture a sale without canonical payment proof', async () => {
    const fixture = await seedTerminalCall({
      status: 'completed',
      result: 'venta_confirmada',
      analysis_status: 'completed',
      provider: 'retell',
    });
    await new PostgresCallStore(sql).appendEvent({
      schema_version: 1,
      event_id: `retell:call_analyzed:${fixture.providerCallId}`,
      call_id: fixture.callId,
      event_type: 'analyzed',
      sequence: 3,
      occurred_at: new Date().toISOString(),
      provider: 'retell',
      payload: {
        event_type: 'analyzed',
        analysis: {
          result: 'venta_confirmada',
          nivel_interes: 'alto',
          objecion: null,
          notas: 'El análisis afirma que pagó.',
          pago_confirmado: true,
        },
      },
    });

    const result = await sweep();
    expect(result.findings.find((finding) => finding.call_id === fixture.callId)).toMatchObject({
      action: 'send',
      reason: 'SALE_CLAIMED_PAYMENT_UNVERIFIED',
    });
    await expect(sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM payments
      WHERE workspace_id = ${fixture.workspaceId}::uuid
        AND contact_id = ${fixture.contactId}::uuid
        AND status = 'paid'
    `).resolves.toEqual([{ count: '0' }]);
  });

  it('FR-4: status = cancelled emits no message', async () => {
    const { callId, conversationId } = await seedTerminalCall({
      status: 'cancelled',
      result: null,
      analysis_status: 'pending',
    });

    const result = await sweep();
    expect(result.findings.find((f) => f.call_id === callId)).toMatchObject({
      action: 'skip',
      reason: 'CALL_CANCELLED',
    });

    // A cancelled call never even gets a synthesized system turn: skip
    // short-circuits before synthesizeCallResultTurn runs.
    expect(await systemCallResultEventCount(callId)).toBe(0);
    expect(await syntheticMessageCount(callId)).toBe(0);
    expect(await outboundDeliveryCountForConversation(conversationId)).toBe(0);
  });

  it('FR-5: a contact already blocked/opt-out at cron time gets no message', async () => {
    const { callId, contactId, conversationId } = await seedTerminalCall({
      status: 'completed',
      result: 'seguimiento_agendado',
      analysis_status: 'completed',
    });

    await revokeConsent(contactId);
    expect(await consentStatus(contactId)).toBe('revoked');

    const result = await sweep();
    expect(result.findings.find((f) => f.call_id === callId)).toMatchObject({
      action: 'skip',
      reason: 'CONTACT_BLOCKED',
    });

    // Blocked-contact check runs before the verdict is even computed, so no
    // system turn, no channel_events row, no message at all.
    expect(await systemCallResultEventCount(callId)).toBe(0);
    expect(await syntheticMessageCount(callId)).toBe(0);
    expect(await outboundDeliveryCountForConversation(conversationId)).toBe(0);
  });

  it('Task 5 E2E: lead projection + Retell lifecycle + physical follow-up replay once', async () => {
    const fixture = await seedTerminalCall({
      status: 'requested',
      result: null,
      analysis_status: 'pending',
      provider: 'retell',
      ageMinutes: 0,
    });

    const dispatch = await dispatchCall(
      { callId: fixture.callId, workerId: `e2e-${fixture.callId}` },
      {
        store: new PostgresCallStore(sql),
        provider: {
          async placeCall() {
            return { providerCallId: fixture.providerCallId, acceptedAt: new Date().toISOString() };
          },
          async findCallByInternalId() { return { providerCallId: fixture.providerCallId }; },
          async cancelCall() {},
        } satisfies VoiceProvider,
      },
    );
    expect(dispatch).toEqual({ status: 'provider_accepted', providerCallId: fixture.providerCallId });

    await enqueueLeadProjection({
      workspaceId: fixture.workspaceId,
      contactId: fixture.contactId,
      spreadsheetId: `e2e-sheet-${fixture.callId}`,
      tabName: 'Leads',
      sourceOrder: 2,
      sourceKey: `agent-a:${fixture.callId}`,
      nombre: 'Ariana',
      apellido: 'Paz',
      email: 'ariana.paz@example.test',
      cursoInteres: 'Curso E2E',
      ultimaSenal: 'complete_lead',
      traceId: randomUUID(),
    }, { sql });

    const callStore = new PostgresCallStore(sql);
    const metadata = {
      internal_call_id: fixture.callId,
      contact_id: fixture.contactId,
      conversation_id: fixture.conversationId,
    };
    const lifecycle = [
      {
        event: 'call_started' as const,
        call: { call_id: fixture.providerCallId, metadata, start_timestamp: Date.now() - 2_000 },
      },
      {
        event: 'call_ended' as const,
        call: {
          call_id: fixture.providerCallId,
          metadata,
          end_timestamp: Date.now() - 1_000,
          disconnection_reason: 'user_hangup',
        },
      },
      {
        event: 'call_analyzed' as const,
        call: {
          call_id: fixture.providerCallId,
          metadata,
          end_timestamp: Date.now(),
          call_analysis: {
            call_summary: 'E2E summary',
            custom_analysis_data: { resultado: 'seguimiento_agendado' as const, nivel_interes: 'medio' as const },
          },
        },
      },
    ];
    for (const raw of lifecycle) {
      const event = mapRetellLifecycleEvent(raw, fixture.callId);
      await recordCallEvent(event, { store: callStore });
      await recordCallEvent(event, { store: callStore });
    }

    const first = await sweep(randomUUID(), 0);
    expect(first.findings.find((finding) => finding.call_id === fixture.callId)).toMatchObject({ action: 'send' });
    const second = await sweep(randomUUID(), 0);
    expect(second.findings.find((finding) => finding.call_id === fixture.callId)).toBeUndefined();

    await expect(sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM call_events WHERE call_id = ${fixture.callId}::uuid
    `).resolves.toEqual([{ count: '3' }]);
    expect(await systemCallResultEventCount(fixture.callId)).toBe(1);
    expect(await outboundDeliveryCountForConversation(fixture.conversationId)).toBe(1);
    await expect(sql<Array<{ payload: Record<string, string> }>>`
      SELECT payload FROM sheet_projection_rows
      WHERE projection_key = ${leadProjectionKey(fixture.workspaceId, fixture.contactId)}
    `).resolves.toEqual([{
      payload: {
        nombre: 'Ariana',
        apellido: 'Paz',
        mail: 'ariana.paz@example.test',
        tipo_de_curso: 'Curso E2E',
      },
    }]);
  });

  it('binds followup payment proof to the conversation workspace, not oldest contact membership', async () => {
    const fixture = await seedTerminalCall({ status: 'completed', result: 'venta_confirmada' });
    const newerWorkspace = await sql<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, environment, status)
      VALUES (${`post-call-newer-${randomUUID()}`}, 'Post-call newer', 'sandbox', 'active')
      RETURNING id
    `;
    const newerWorkspaceId = newerWorkspace[0].id;
    await sql`
      INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status)
      VALUES (${newerWorkspaceId}::uuid, ${fixture.contactId}::uuid, 'active')
    `;
    const offerings = await sql<Array<{ id: string }>>`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency
      ) VALUES
        (${fixture.workspaceId}::uuid, ${`old-course-${fixture.callId}`}, 'Old course', 'course', 'active', 'Old', 'fixed', 10, 'USD'),
        (${newerWorkspaceId}::uuid, ${`new-course-${fixture.callId}`}, 'New course', 'course', 'active', 'New', 'fixed', 10, 'USD')
      RETURNING id
    `;
    await sql`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, selected_offering_code
      ) VALUES (
        ${newerWorkspaceId}::uuid, ${fixture.conversationId}::uuid, ${fixture.contactId}::uuid,
        ${`new-course-${fixture.callId}`}
      )
    `;
    await sql`
      INSERT INTO payments (
        workspace_id, contact_id, offering_id, amount, currency, status,
        provider, environment, checkout_mode, idempotency_key, paid_at
      ) VALUES (
        ${fixture.workspaceId}::uuid, ${fixture.contactId}::uuid, ${offerings[0].id}::uuid,
        10, 'USD', 'paid', 'fake', 'test', 'payment', ${`paid-${fixture.callId}`}, now()
      )
    `;

    const pending = await store.listPendingFollowups({ limit: 500, grace_seconds: 0 });
    expect(pending.find((call) => call.call_id === fixture.callId)?.workspace_id).toBe(newerWorkspaceId);
    await expect(store.hasVerifiedPayment(fixture.contactId, newerWorkspaceId)).resolves.toBe(false);
    await expect(store.hasVerifiedPayment(fixture.contactId, fixture.workspaceId)).resolves.toBe(true);
  });
});
