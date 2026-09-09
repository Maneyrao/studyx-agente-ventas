import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { mapRetellLifecycleEvent } from '@/features/calls/adapters/retell-lifecycle';
import { recordCallEvent } from '@/features/calls/application/record-call-event';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { handleRetellWebhook } from '@/features/calls/application/retell-webhook';
import { hashCallContext } from '@/features/calls/domain/call-context';
import type { CallStatus } from '@/features/calls/domain/call-state';
import { RetellCallCorrelationError } from '@/features/calls/ports/retell-call-correlation-store';
import type { VoiceProvider } from '@/features/calls/ports/voice-provider';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture(input: {
  provider?: 'retell' | 'telegram_sandbox';
  providerCallId?: string | null;
  status?: CallStatus;
} = {}) {
  const callId = randomUUID();
  const phone = `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
  `;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame') RETURNING id
  `;
  const context = {
    call_id: callId,
    nombre_lead: '',
    curso_interes: 'Python',
    pais: '',
    email_lead: '',
    resumen_whatsapp: 'Llamada preautorizada.',
    prompt_version: 'agent-b-v1',
  };
  const provider = input.provider ?? 'retell';
  const status = input.status ?? 'dispatch_ambiguous';
  const providerCallId = input.providerCallId ?? null;
  await db!`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider, provider_call_id,
      request_idempotency_key, status, consent_source_message_id, context_snapshot,
      context_hash, prompt_version
    ) VALUES (
      ${callId}::uuid, ${messages[0].id}::uuid, ${contacts[0].id}::uuid,
      ${conversations[0].id}::uuid, ${provider}, ${providerCallId}, ${`voice-call:${callId}`},
      ${status}, ${messages[0].id}::uuid, ${db!.json(context)},
      decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1'
    )
  `;
  return {
    callId,
    contactId: contacts[0].id,
    conversationId: conversations[0].id,
  };
}

function wrapper(
  event: 'call_started' | 'call_ended' | 'call_analyzed',
  providerCallId: string,
  ids: Awaited<ReturnType<typeof fixture>>,
) {
  return {
    event,
    call: {
      call_id: providerCallId,
      metadata: {
        internal_call_id: ids.callId,
        contact_id: ids.contactId,
        conversation_id: ids.conversationId,
      },
      start_timestamp: 1_788_960_000_000,
      end_timestamp: 1_788_960_060_000,
      disconnection_reason: 'user_hangup',
      transcript: 'must not persist',
      recording_url: 'https://example.invalid/must-not-persist',
      call_analysis: {
        call_summary: 'Terminó sin interés.',
        custom_analysis_data: {
          resultado: 'no_interesado',
          nivel_interes: 'bajo',
          objecion_principal: 'precio',
        },
      },
    },
  };
}

run('Retell call lifecycle persistence', () => {
  it.each([
    ['call_started', 'in_progress'],
    ['call_ended', 'completed'],
  ] as const)('keeps dispatch accepted when %s wins the provider attach race', async (event, expectedStatus) => {
    const ids = await fixture({ status: 'requested' });
    const providerCallId = `retell:${randomUUID()}`;
    const clients = openIndependentLocalTestDatabases(2);
    let releaseProvider!: () => void;
    let signalProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const provider: VoiceProvider = {
      placeCall: async () => {
        signalProviderStarted();
        await providerRelease;
        return { providerCallId, acceptedAt: '2026-09-09T15:00:00.000Z' };
      },
      findCallByInternalId: async () => null,
      cancelCall: async () => undefined,
    };

    try {
      const dispatch = dispatchCall(
        { callId: ids.callId, workerId: `race-${event}` },
        { store: new PostgresCallStore(clients[0]), provider },
      );
      await providerStarted;

      const rawBody = JSON.stringify(wrapper(event, providerCallId, ids));
      const apiKey = 'retell-race-test-key';
      const timestamp = 1_788_960_060_000;
      const digest = createHmac('sha256', apiKey)
        .update(rawBody + String(timestamp), 'utf8')
        .digest('hex');
      const response = await handleRetellWebhook(new Request('http://localhost/retell/eventos', {
        method: 'POST',
        headers: { 'x-retell-signature': `v=${timestamp},d=${digest}` },
        body: rawBody,
      }), {
        apiKey,
        calls: new PostgresCallStore(clients[1]),
        now: () => new Date(timestamp),
      });
      expect(response.status).toBe(204);

      const beforeResume = await db!<Array<{
        status: string;
        provider_call_id: string;
        provider_accepted_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
      }>>`
        SELECT status, provider_call_id, provider_accepted_at, started_at, completed_at
        FROM call_sessions WHERE id = ${ids.callId}::uuid
      `;
      releaseProvider();
      await expect(dispatch).resolves.toEqual({
        status: 'provider_accepted',
        providerCallId,
      });
      const afterResume = await db!<typeof beforeResume>`
        SELECT status, provider_call_id, provider_accepted_at, started_at, completed_at
        FROM call_sessions WHERE id = ${ids.callId}::uuid
      `;
      expect(afterResume[0]).toEqual(beforeResume[0]);
      expect(afterResume[0].status).toBe(expectedStatus);
      expect(afterResume[0].provider_call_id).toBe(providerCallId);
    } finally {
      releaseProvider?.();
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('heals the create/attach race only with exact Retell tenant correlation', async () => {
    const ids = await fixture({ status: 'dispatch_ambiguous' });
    const providerCallId = `retell:${randomUUID()}`;
    const store = new PostgresCallStore(db!);

    await expect(store.resolveRetellCall({
      providerCallId,
      metadata: {
        internalCallId: ids.callId,
        contactId: ids.contactId,
        conversationId: ids.conversationId,
      },
    })).resolves.toEqual({ callId: ids.callId });
    await expect(store.resolveRetellCall({ providerCallId, metadata: null }))
      .resolves.toEqual({ callId: ids.callId });

    const rows = await db!<Array<{ provider_call_id: string; status: string }>>`
      SELECT provider_call_id, status FROM call_sessions WHERE id = ${ids.callId}::uuid
    `;
    expect(rows[0]).toEqual({ provider_call_id: providerCallId, status: 'provider_accepted' });

    await expect(store.resolveRetellCall({
      providerCallId,
      metadata: {
        internalCallId: ids.callId,
        contactId: randomUUID(),
        conversationId: ids.conversationId,
      },
    })).rejects.toEqual(expect.objectContaining<Partial<RetellCallCorrelationError>>({
      code: 'CALL_CORRELATION_MISMATCH',
    }));
    await expect(store.resolveRetellCall({
      providerCallId: `retell:${randomUUID()}`,
      metadata: {
        internalCallId: ids.callId,
        contactId: ids.contactId,
        conversationId: ids.conversationId,
      },
    })).rejects.toEqual(expect.objectContaining<Partial<RetellCallCorrelationError>>({
      code: 'CALL_PROVIDER_ID_CONFLICT',
    }));
  });

  it('attaches a provider call found while reconciling an ambiguous dispatch', async () => {
    const ids = await fixture({ status: 'dispatch_ambiguous' });
    const providerCallId = `retell:${randomUUID()}`;
    const store = new PostgresCallStore(db!);

    await expect(store.attachProviderCall(
      ids.callId,
      providerCallId,
      '2026-09-09T15:00:00.000Z',
    )).resolves.toBeUndefined();
    await expect(db!<Array<{ status: string; provider_call_id: string }>>`
      SELECT status, provider_call_id FROM call_sessions WHERE id = ${ids.callId}::uuid
    `).resolves.toEqual([{ status: 'provider_accepted', provider_call_id: providerCallId }]);
  });

  it('rejects a cross-provider internal ID even when all metadata IDs match', async () => {
    const ids = await fixture({ provider: 'telegram_sandbox', status: 'dispatching' });
    const store = new PostgresCallStore(db!);
    await expect(store.resolveRetellCall({
      providerCallId: `retell:${randomUUID()}`,
      metadata: {
        internalCallId: ids.callId,
        contactId: ids.contactId,
        conversationId: ids.conversationId,
      },
    })).rejects.toEqual(expect.objectContaining<Partial<RetellCallCorrelationError>>({
      code: 'CALL_CORRELATION_NOT_FOUND',
    }));
  });

  it('rejects a different provider ID and does not reopen failed or cancelled sessions', async () => {
    const store = new PostgresCallStore(db!);
    const existingProviderId = `retell:${randomUUID()}`;
    const dispatching = await fixture({
      providerCallId: existingProviderId,
      status: 'dispatching',
    });
    await expect(store.attachProviderCall(
      dispatching.callId,
      `retell:${randomUUID()}`,
      '2026-09-09T15:00:00.000Z',
    )).rejects.toThrow('CALL_DISPATCH_FENCE_LOST');
    const unchanged = await db!<Array<{ status: string; provider_call_id: string }>>`
      SELECT status, provider_call_id FROM call_sessions WHERE id = ${dispatching.callId}::uuid
    `;
    expect(unchanged[0]).toEqual({ status: 'dispatching', provider_call_id: existingProviderId });

    for (const status of ['failed', 'cancelled'] as const) {
      const providerCallId = `retell:${randomUUID()}`;
      const ids = await fixture({ providerCallId, status });
      await expect(store.attachProviderCall(
        ids.callId,
        providerCallId,
        '2026-09-09T15:00:00.000Z',
      )).rejects.toThrow('CALL_DISPATCH_FENCE_LOST');
      const rows = await db!<Array<{ status: string; provider_call_id: string }>>`
        SELECT status, provider_call_id FROM call_sessions WHERE id = ${ids.callId}::uuid
      `;
      expect(rows[0]).toEqual({ status, provider_call_id: providerCallId });
    }
  });

  it('deduplicates replay, rejects changed replay, and reaches one final state out of order', async () => {
    const providerCallId = `retell:${randomUUID()}`;
    const ids = await fixture({ providerCallId, status: 'provider_accepted' });
    const store = new PostgresCallStore(db!);
    const analyzed = mapRetellLifecycleEvent(wrapper('call_analyzed', providerCallId, ids), ids.callId);
    const ended = mapRetellLifecycleEvent(wrapper('call_ended', providerCallId, ids), ids.callId);
    const started = mapRetellLifecycleEvent(wrapper('call_started', providerCallId, ids), ids.callId);

    await recordCallEvent(analyzed, { store });
    await recordCallEvent(ended, { store });
    await recordCallEvent(started, { store });
    await expect(recordCallEvent(ended, { store })).resolves.toMatchObject({ persistence: 'duplicate' });
    await expect(store.appendEvent({ ...ended, sequence: 99 })).rejects.toThrow('CALL_EVENT_REPLAY_CONFLICT');

    const sessions = await db!<Array<{ status: string; analysis_status: string; result: string | null }>>`
      SELECT status, analysis_status, result FROM call_sessions WHERE id = ${ids.callId}::uuid
    `;
    expect(sessions[0]).toEqual({
      status: 'completed',
      analysis_status: 'completed',
      result: 'no_interesado',
    });
    const events = await db!<Array<{ event_type: string; payload: Record<string, unknown> }>>`
      SELECT event_type, payload FROM call_events WHERE call_id = ${ids.callId}::uuid ORDER BY sequence
    `;
    expect(events.map((event) => event.event_type)).toEqual(['started', 'ended', 'analyzed']);
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('transcript');
    expect(JSON.stringify(events)).not.toContain('recording');
  });
});
