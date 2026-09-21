import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XendraVoiceProvider } from '@/features/calls/adapters/xendra-voice.provider';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresRetellOrchestrationStore } from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { PostgresRetellContactToolStore } from '@/features/calls/adapters/postgres-retell-tools';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import {
  handleRetellToolRequest,
  type RetellToolDependencies,
  type RetellToolName,
} from '@/features/calls/application/retell-tools';
import { handleXendraRelayedRetellWebhook } from '@/features/calls/application/retell-webhook';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { AuthorizedEgressContentAuthorizer } from '@/features/messaging/adapters/authorized-egress-content-authorizer';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { sendOutboundMessage } from '@/features/messaging/application/send-outbound-message';
import type { MessageChannel, SendTextInput } from '@/features/messaging/ports/message-channel';
import { leadProjectionKey } from '@/lib/services/projection.service';
import {
  commitAgentDecision,
  recordDeliveryReport,
  type CommitDecisionResult,
} from '@/lib/services/decision.service';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';
import { openLocalTestDatabase } from '../helpers/db';
import { startFakeXendraServer, type FakeXendraServer } from '../fixtures/fake-xendra-server';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const orchestratorSecret = 'e2e-xendra-orchestrator-secret';
const toolsSecret = 'e2e-xendra-tools-secret';
const paymentUrl = 'https://buy.stripe.com/test-e2e-monthly-12';
const fixedNow = new Date('2026-09-13T18:00:00.000Z');

const previousEnvironment = {
  voiceProvider: process.env.VOICE_PROVIDER,
  workspaceSlug: process.env.BUSINESS_WORKSPACE_SLUG,
  spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  tabName: process.env.GOOGLE_SHEETS_TAB_NAME,
};

beforeAll(() => {
  process.env.VOICE_PROVIDER = 'xendra';
  process.env.BUSINESS_WORKSPACE_SLUG = 'studyx';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'fake-xendra-e2e-sheet';
  process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';
});

afterAll(async () => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('VOICE_PROVIDER', previousEnvironment.voiceProvider);
  restore('BUSINESS_WORKSPACE_SLUG', previousEnvironment.workspaceSlug);
  restore('GOOGLE_SHEETS_SPREADSHEET_ID', previousEnvironment.spreadsheetId);
  restore('GOOGLE_SHEETS_TAB_NAME', previousEnvironment.tabName);
  await db?.end();
  await sql.end();
});

interface ChatIdentity {
  readonly phone: string;
  readonly externalConversationId: string;
  readonly externalUserId: string;
  sequence: number;
}

interface AgentACall {
  readonly callId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly identity: ChatIdentity;
  readonly confirmation: CommitDecisionResult;
}

function chatIdentity(): ChatIdentity {
  const identity = randomUUID();
  const digits = identity.replace(/\D/gu, '').slice(0, 9).padEnd(9, '1');
  return {
    phone: `+5491${digits}`,
    externalConversationId: `tg-conversation-${identity}`,
    externalUserId: `tg-user-${identity}`,
    sequence: 0,
  };
}

function inbound(identity: ChatIdentity, text: string): InboundEnvelope {
  identity.sequence += 1;
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'telegram',
    integration_id: 'telegram-xendra-e2e',
    external_message_id: `tg-message-${identity.externalUserId}-${identity.sequence}`,
    external_conversation_id: identity.externalConversationId,
    external_user_id: identity.externalUserId,
    phone_e164: identity.phone,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text,
      occurred_at: new Date(fixedNow.getTime() + identity.sequence * 1_000).toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
  };
}

function decision(response: string, responseType: 'call_offer' | 'call_confirmation' | 'commercial_reply', action: Record<string, unknown> | null) {
  return {
    schema_version: 4 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response,
    response_type: responseType,
    business_action: action,
    memory_candidates: [],
    missing_information: [],
    next_state: responseType === 'call_offer' ? 'waiting_user' as const : 'completed' as const,
    reason_code: responseType === 'call_offer' ? 'CALL_OFFER_PROPOSED' : 'CALL_CONSENT_ACCEPTED',
    confidence: 1,
    retrieval_used: null,
  };
}

async function commitTurn(turnId: string, proposed: ReturnType<typeof decision>) {
  return commitAgentDecision({
    turn_id: turnId,
    trace_id: randomUUID(),
    decision: proposed as never,
    model: {
      provider: 'botpress',
      model: 'vitest-deterministic',
      prompt_version: 'studyx-agent-a-sales-bridge-v1',
    },
  });
}

async function markVisible(committed: CommitDecisionResult, providerMessageId: string) {
  if (!committed.outbound) throw new Error('E2E_OUTBOUND_MISSING');
  const report = await recordDeliveryReport({
    outbound_id: committed.outbound.id,
    trace_id: randomUUID(),
    status: 'submitted_to_botpress',
    botpress_message_id: providerMessageId,
    replayed: false,
    error_code: null,
    delivery_attempt: committed.outbound.delivery_attempt,
  });
  expect(report.delivery_status).toBe('submitted_to_botpress');
}

async function bindStudyxContext(input: {
  readonly contactId: string;
  readonly conversationId: string;
  readonly sourceTurnId: string;
  readonly selectedPaymentPlan: 'monthly_12' | null;
}) {
  const workspaces = await db!<Array<{ id: string; slug: string }>>`
    SELECT id, slug FROM workspaces WHERE slug = 'studyx' AND status = 'active' LIMIT 1
  `;
  if (!workspaces[0]) throw new Error('E2E_STUDYX_WORKSPACE_MISSING');
  await db!`
    UPDATE contacts SET name = 'Ana Pérez' WHERE id = ${input.contactId}::uuid
  `;
  await db!`
    UPDATE messages SET conversation_seq = 1 WHERE id = ${input.sourceTurnId}::uuid
  `;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status, source_channel)
    VALUES (${workspaces[0].id}::uuid, ${input.contactId}::uuid, 'active', 'telegram')
    ON CONFLICT (workspace_id, contact_id)
    DO UPDATE SET lifecycle_status = 'active', source_channel = 'telegram'
  `;
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, selected_offering_code, selected_payment_plan
    ) VALUES (
      ${workspaces[0].id}::uuid, ${input.conversationId}::uuid, ${input.contactId}::uuid,
      'fotografia_profesional', ${input.selectedPaymentPlan}
    )
    ON CONFLICT (workspace_id, conversation_id)
    DO UPDATE SET selected_offering_code = EXCLUDED.selected_offering_code,
                  selected_payment_plan = EXCLUDED.selected_payment_plan
  `;
  await db!`
    INSERT INTO sales_context_states (workspace_id, contact_id, conversation_id, stage)
    VALUES (${workspaces[0].id}::uuid, ${input.contactId}::uuid, ${input.conversationId}::uuid, 'exploring')
    ON CONFLICT (workspace_id, contact_id) DO NOTHING
  `;
  await db!`
    INSERT INTO contact_channel_permissions (contact_id, channel, consent_status)
    VALUES (${input.contactId}::uuid, 'telegram', 'granted')
    ON CONFLICT (contact_id, channel)
    DO UPDATE SET consent_status = 'granted', updated_at = now()
  `;
  return { workspaceId: workspaces[0].id, workspaceSlug: workspaces[0].slug };
}

async function createAgentACall(input: {
  readonly acceptedOffer: boolean;
  readonly selectedPaymentPlan: 'monthly_12' | null;
}): Promise<AgentACall> {
  const identity = chatIdentity();
  const first = await processInboundMessage(inbound(
    identity,
    input.acceptedOffer ? 'Quiero saber sobre Fotografía Profesional' : 'Llamame ahora',
  ));
  const workspace = await bindStudyxContext({
    contactId: first.contact.id,
    conversationId: first.conversation_id,
    sourceTurnId: first.turn_id,
    selectedPaymentPlan: input.selectedPaymentPlan,
  });

  let confirmationTurnId = first.turn_id;
  if (input.acceptedOffer) {
    const offer = await commitTurn(first.turn_id, decision(
      '¿Querés que te llamemos a este número para verlo juntos?',
      'call_offer',
      null,
    ));
    expect(offer.call_request).toBeNull();
    await markVisible(offer, `bp-offer-${offer.decision_id}`);
    const accepted = await processInboundMessage(inbound(identity, 'Sí, llamame'));
    confirmationTurnId = accepted.turn_id;
  }

  const confirmation = await commitTurn(confirmationTurnId, decision(
    'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
    'call_confirmation',
    {
      type: 'request_call_now',
      reason: input.acceptedOffer ? 'accepted_offer' : 'direct_request',
      course_of_interest: 'fotografia_profesional',
    },
  ));
  expect(confirmation.call_request?.call_id).toBeDefined();
  await markVisible(confirmation, `bp-confirmation-${confirmation.decision_id}`);

  return {
    callId: confirmation.call_request!.call_id,
    contactId: first.contact.id,
    conversationId: first.conversation_id,
    ...workspace,
    identity,
    confirmation,
  };
}

function xendraProvider(server: FakeXendraServer, timeoutMs = 1_000) {
  return new XendraVoiceProvider({
    voiceProvider: 'xendra',
    callUrl: server.callUrl,
    orchestratorSecret,
    advisorName: 'Sofía',
    closerNumber: '+5491144445555',
    telegramCanaryContactIds: [],
    requestTimeoutMs: timeoutMs,
  }, {
    now: () => fixedNow,
    sandboxLookup: { findSandboxProvider: async () => null },
  });
}

function metadata(call: AgentACall) {
  return {
    lead_id: call.contactId,
    conversation_id: call.conversationId,
  };
}

async function relay(
  call: AgentACall,
  providerCallId: string,
  event: 'call_started' | 'call_ended' | 'call_analyzed',
  secret = orchestratorSecret,
) {
  const base = {
    call_id: providerCallId,
    metadata: metadata(call),
  };
  const body = event === 'call_started'
    ? { event, call: { ...base, start_timestamp: fixedNow.getTime() } }
    : event === 'call_ended'
      ? {
          event,
          call: {
            ...base,
            start_timestamp: fixedNow.getTime(),
            end_timestamp: fixedNow.getTime() + 60_000,
            disconnection_reason: 'user_hangup',
            transcript: 'este texto no debe persistirse',
            recording_url: 'https://example.invalid/no-persistir',
          },
        }
      : {
          event,
          call: {
            ...base,
            end_timestamp: fixedNow.getTime() + 60_000,
            transcript: 'este texto tampoco debe persistirse',
            recording_url: 'https://example.invalid/no-persistir',
            call_analysis: {
              call_summary: 'Le interesa Fotografía y revisará el link enviado.',
              custom_analysis_data: {
                resultado: 'seguimiento_agendado',
                nivel_interes: 'alto',
                objecion_principal: 'precio',
                curso_ofrecido: 'Fotografía Profesional',
                compromiso_pendiente: 'Revisar el link en Telegram.',
              },
            },
          },
        };
  return handleXendraRelayedRetellWebhook(new Request('http://localhost/retell/eventos', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-studyx-orchestrator-secret': secret,
      'x-studyx-event': event,
    },
    body: JSON.stringify(body),
  }), {
    orchestratorSecret,
    calls: new PostgresCallStore(db!),
  });
}

function outboundHarness(call: AgentACall) {
  const sends: SendTextInput[] = [];
  const telegram: MessageChannel = {
    channel: 'telegram',
    provider: 'telegram',
    integrationId: 'telegram-xendra-e2e',
    maxTextLength: 4_096,
    async sendText(input) {
      sends.push(input);
      return {
        providerMessageId: `${input.destination}:payment-link`,
        acceptedAt: fixedNow.toISOString(),
      };
    },
  };
  const sendOutbound = (input: Parameters<typeof sendOutboundMessage>[0]) => sendOutboundMessage(input, {
    identities: new PostgresChannelIdentityStore(db!),
    channels: { telegram },
    preferenceOrder: ['telegram'],
    contentAuthorizer: new AuthorizedEgressContentAuthorizer(),
    sideEffectAuthorizer: { authorize: async () => ({ allowed: true as const, reason: null }) },
    db: db!,
    now: () => fixedNow,
  });
  const orchestration = new PostgresRetellOrchestrationStore(db!, {
    sendOutbound,
    paymentLinkResolver: {
      resolve: (plan) => plan === 'monthly_12' ? paymentUrl : null,
    },
  });
  const dependencies: RetellToolDependencies = {
    apiKey: '',
    requireRetellSignature: false,
    toolsSecret,
    workspaceSlug: call.workspaceSlug,
    calls: new PostgresCallStore(db!),
    business: new PostgresBusinessContextStore(db!),
    contacts: new PostgresRetellContactToolStore(db!),
    sheets: { spreadsheetId: 'fake-xendra-e2e-sheet', tabName: 'Leads' },
    orchestration,
    now: () => fixedNow,
  };
  return { sends, dependencies };
}

async function tool(
  call: AgentACall,
  providerCallId: string,
  name: RetellToolName,
  args: unknown,
  dependencies: RetellToolDependencies,
  secret = toolsSecret,
) {
  const request = new Request(`http://localhost/retell/tools/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-studyx-tools-secret': secret,
    },
    body: JSON.stringify({
      name,
      // Retell includes the conversation accumulated so far in every tool
      // call. Production crossed 32 KiB during a real sales call, so this
      // fixture must exercise the same shape while proving that only bounded
      // structured args reach the orchestration layer.
      call: {
        call_id: providerCallId,
        metadata: metadata(call),
        transcript: 'x'.repeat(96 * 1_024),
      },
      args,
    }),
  });
  const response = await handleRetellToolRequest(request, name, dependencies);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

run('Agent A → Xendra → Agent B → Agent A local smoke', () => {
  it('completes the full journey once and resumes the original Telegram conversation', async () => {
    const call = await createAgentACall({ acceptedOffer: true, selectedPaymentPlan: 'monthly_12' });
    const providerCallId = `call_xendra_${call.callId}`;
    const server = await startFakeXendraServer({ callId: providerCallId });
    try {
      const store = new PostgresCallStore(db!);
      const firstDispatch = await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-first' },
        { store, provider: xendraProvider(server), now: () => fixedNow },
      );
      const dispatchReplay = await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-replay' },
        { store, provider: xendraProvider(server), now: () => fixedNow },
      );
      expect(firstDispatch).toEqual({ status: 'provider_accepted', providerCallId });
      expect(dispatchReplay).toEqual(firstDispatch);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].headers['x-studyx-orchestrator-secret']).toBe(orchestratorSecret);
      expect(server.requests[0].body).toMatchObject({
        telefono: call.identity.phone,
        conversation_id: call.conversationId,
        lead_id: call.contactId,
        variables: {
          nombre_lead: 'Ana Pérez',
          curso_interes: 'fotografia_profesional',
          nombre_asesor: 'Sofía',
          numero_closer: '+5491144445555',
        },
      });

      const summaries = (server.requests[0].body as { variables: { resumen_whatsapp: string } })
        .variables.resumen_whatsapp.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [];
      expect(summaries.length).toBeLessThanOrEqual(6);
      expect(await relay(call, providerCallId, 'call_started')).toMatchObject({ status: 204 });
      expect(await relay(call, providerCallId, 'call_started')).toMatchObject({ status: 204 });

      const outbound = outboundHarness(call);
      const payment = await tool(call, providerCallId, 'enviar_link_pago', {
        curso: 'fotografia_profesional',
        plan_code: 'monthly_12',
      }, outbound.dependencies);
      const paymentReplay = await tool(call, providerCallId, 'enviar_link_pago', {
        curso: 'fotografia_profesional',
        plan_code: 'monthly_12',
      }, outbound.dependencies);
      expect(payment).toMatchObject({
        status: 200,
        body: { ok: true, pago: { enviado: true, canal: 'telegram' } },
      });
      expect(paymentReplay.body).toEqual(payment.body);
      expect(outbound.sends).toHaveLength(1);
      expect(outbound.sends[0]).toMatchObject({
        destination: call.identity.externalConversationId,
        text: expect.stringContaining(paymentUrl),
      });

      const resultArgs = {
        resultado: 'seguimiento_agendado',
        call_summary: 'Le interesa Fotografía y revisará el link de 12 cuotas.',
        user_sentiment: 'positive',
        curso_ofrecido: 'Fotografía Profesional',
        precio_ofrecido: 'USD 360',
        objecion_principal: 'precio',
        nivel_interes: 'alto',
        email_capturado: 'ana.perez@example.test',
        link_pago_enviado: true,
        pago_confirmado: false,
        pidio_humano: false,
        pidio_no_contactar: false,
        pregunto_si_es_ia: false,
        compromiso_pendiente: 'Revisar el link en Telegram.',
      };
      const recorded = await tool(
        call, providerCallId, 'registrar_resultado', resultArgs, outbound.dependencies,
      );
      const recordedReplay = await tool(
        call, providerCallId, 'registrar_resultado', resultArgs, outbound.dependencies,
      );
      expect(recorded.body).toEqual({ ok: true, recorded: true });
      expect(recordedReplay.body).toEqual(recorded.body);

      for (const event of ['call_ended', 'call_analyzed'] as const) {
        expect(await relay(call, providerCallId, event)).toMatchObject({ status: 204 });
        expect(await relay(call, providerCallId, event)).toMatchObject({ status: 204 });
      }

      const resumedInbound = await processInboundMessage(inbound(
        call.identity,
        'Gracias, sigo por acá después de la llamada.',
      ));
      const resumed = await commitTurn(resumedInbound.turn_id, decision(
        'Claro, seguimos por este mismo chat.',
        'commercial_reply',
        null,
      ));
      expect(resumed.status).toBe('committed');
      expect(resumed.outbound?.content).toBe('Claro, seguimos por este mismo chat.');
      const resumeConversation = await db!<Array<{ conversation_id: string }>>`
        SELECT conversation_id FROM messages WHERE id = ${resumed.outbound!.id}::uuid
      `;
      expect(resumeConversation).toEqual([{ conversation_id: call.conversationId }]);

      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM call_sessions
        WHERE conversation_id = ${call.conversationId}::uuid
      `).resolves.toEqual([{ count: '1' }]);
      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM outbound_deliveries
        WHERE idempotency_key = ${`agent-a:retell-payment-link:${call.callId}`}
      `).resolves.toEqual([{ count: '1' }]);
      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM messages
        WHERE conversation_id = ${call.conversationId}::uuid
          AND direction = 'outbound'
          AND content LIKE ${`%${paymentUrl}%`}
      `).resolves.toEqual([{ count: '1' }]);
      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM call_events WHERE call_id = ${call.callId}::uuid
      `).resolves.toEqual([{ count: '5' }]);
      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM sheet_projection_rows
        WHERE projection_key = ${leadProjectionKey(call.workspaceId, call.contactId)}
      `).resolves.toEqual([{ count: '1' }]);
      const finalState = await db!<Array<{
        status: string;
        result: string | null;
        provider_call_id: string;
      }>>`
        SELECT status, result, provider_call_id FROM call_sessions WHERE id = ${call.callId}::uuid
      `;
      expect(finalState).toEqual([{
        status: 'completed',
        result: 'seguimiento_agendado',
        provider_call_id: providerCallId,
      }]);
      const persistedPayload = await db!<Array<{ payload: string }>>`
        SELECT payload::text AS payload FROM call_events WHERE call_id = ${call.callId}::uuid
      `;
      expect(persistedPayload.map((row) => row.payload).join('\n')).not.toContain('no-persistir');
      expect(persistedPayload.map((row) => row.payload).join('\n')).not.toContain('este texto');
    } finally {
      await server.close();
    }
  });

  it('reconciles 409 and keeps auth, identity, plan and payment gates closed', async () => {
    const call = await createAgentACall({ acceptedOffer: false, selectedPaymentPlan: null });
    const providerCallId = `call_xendra_existing_${call.callId}`;
    const server = await startFakeXendraServer({ status: 409, callId: providerCallId });
    try {
      const dispatch = await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-409' },
        { store: new PostgresCallStore(db!), provider: xendraProvider(server), now: () => fixedNow },
      );
      expect(dispatch).toEqual({ status: 'provider_accepted', providerCallId });
      expect(server.requests).toHaveLength(1);

      expect(await relay(call, providerCallId, 'call_started', 'wrong-secret'))
        .toMatchObject({ status: 401 });
      expect(await relay(call, providerCallId, 'call_started')).toMatchObject({ status: 204 });

      const outbound = outboundHarness(call);
      const invalidToolSecret = await tool(
        call, providerCallId, 'verificar_pago', {}, outbound.dependencies, 'wrong-secret',
      );
      expect(invalidToolSecret).toMatchObject({ status: 401, body: { ok: false } });

      const crossed = {
        ...call,
        contactId: randomUUID(),
      };
      const crossedIdentity = await tool(
        crossed, providerCallId, 'verificar_pago', {}, outbound.dependencies,
      );
      expect(crossedIdentity).toMatchObject({
        status: 200,
        body: { ok: false, error: { code: 'CALL_CORRELATION_MISMATCH' } },
      });

      const ambiguousPlan = await tool(call, providerCallId, 'enviar_link_pago', {
        cursos: ['fotografia_profesional'],
        plan: 'cuotas',
        canal: 'telegram',
      }, outbound.dependencies);
      expect(ambiguousPlan).toMatchObject({
        status: 200,
        body: { ok: false, error: { code: 'PLAN_SELECTION_REQUIRED' } },
      });
      expect(outbound.sends).toHaveLength(0);

      const falseSale = await tool(call, providerCallId, 'registrar_resultado', {
        resultado: 'venta_confirmada',
        resumen: 'La persona dijo que pagó, pero el backend no tiene confirmación.',
      }, outbound.dependencies);
      expect(falseSale).toMatchObject({
        status: 200,
        body: { ok: false, error: { code: 'PAYMENT_NOT_VERIFIED' } },
      });
      await expect(db!<Array<{ result: string | null }>>`
        SELECT result FROM call_sessions WHERE id = ${call.callId}::uuid
      `).resolves.toEqual([{ result: null }]);

    } finally {
      await server.close();
    }
  });

  it('makes registrar_resultado no_contactar block every later outbound', async () => {
    const call = await createAgentACall({ acceptedOffer: false, selectedPaymentPlan: null });
    const providerCallId = `call_xendra_opt_out_${call.callId}`;
    const server = await startFakeXendraServer({ callId: providerCallId });
    try {
      await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-opt-out' },
        { store: new PostgresCallStore(db!), provider: xendraProvider(server), now: () => fixedNow },
      );
      expect(await relay(call, providerCallId, 'call_started')).toMatchObject({ status: 204 });
      const outbound = outboundHarness(call);
      const optOut = await tool(call, providerCallId, 'registrar_resultado', {
        resultado: 'no_contactar',
        resumen: 'La persona pidió que no volvamos a contactarla.',
        proximo_paso: 'ninguno',
      }, outbound.dependencies);
      expect(optOut.body).toEqual({ ok: true, recorded: true });
      await expect(db!<Array<{ consent_status: string }>>`
        SELECT consent_status FROM contact_channel_permissions
        WHERE contact_id = ${call.contactId}::uuid AND channel = 'telegram'
      `).resolves.toEqual([{ consent_status: 'revoked' }]);

      const blockedLink = await tool(call, providerCallId, 'enviar_link_pago', {
        curso: 'fotografia_profesional',
        plan_code: 'one_time',
      }, outbound.dependencies);
      expect(blockedLink).toMatchObject({ status: 200, body: { ok: false } });
      expect(outbound.sends).toHaveLength(0);
      await expect(db!<Array<{ count: string }>>`
        SELECT count(*)::text AS count FROM outbound_deliveries
        WHERE idempotency_key = ${`agent-a:retell-payment-link:${call.callId}`}
      `).resolves.toEqual([{ count: '0' }]);
    } finally {
      await server.close();
    }
  });

  it('turns a fake-server timeout into one ambiguous dispatch and never redials', async () => {
    const call = await createAgentACall({ acceptedOffer: false, selectedPaymentPlan: null });
    const server = await startFakeXendraServer({
      callId: 'call_too_late',
      responseDelayMs: 80,
    });
    try {
      const store = new PostgresCallStore(db!);
      const first = await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-timeout' },
        { store, provider: xendraProvider(server, 10), now: () => fixedNow },
      );
      const replay = await dispatchCall(
        { callId: call.callId, workerId: 'xendra-e2e-timeout-replay' },
        { store, provider: xendraProvider(server, 10), now: () => fixedNow },
      );
      expect(first).toEqual({ status: 'dispatch_ambiguous', providerCallId: null });
      expect(replay).toEqual(first);
      expect(server.requests).toHaveLength(1);
      await expect(db!<Array<{ status: string }>>`
        SELECT status FROM call_sessions WHERE id = ${call.callId}::uuid
      `).resolves.toEqual([{ status: 'dispatch_ambiguous' }]);
    } finally {
      await server.close();
    }
  });
});
