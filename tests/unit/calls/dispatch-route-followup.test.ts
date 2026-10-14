import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DispatchClaim, DispatchableCall } from '@/features/calls/ports/call-store';
import type { PostCallFollowupStore } from '@/features/calls/ports/post-call-followup-store';
import type { SendOutboundMessageInput } from '@/features/messaging/application/send-outbound-message';

const mockedModules = [
  'next/server',
  '@/lib/config',
  '@/lib/db/orchestrator',
  '@/features/calls/adapters/postgres-call-store',
  '@/features/calls/adapters/postgres-post-call-followup-store',
  '@/features/messaging/adapters/managed-outbound',
  '@/features/calls/adapters/agent-a-post-call-narrative',
  '@/app/api/agent/calls/[call_id]/dispatch/route-dependencies',
];

afterEach(() => {
  for (const name of mockedModules) vi.doUnmock(name);
  vi.resetModules();
});

async function harness(options: {
  providerStatus?: number; busy?: boolean; failFollowup?: boolean;
  setupFailure?: 'configuration' | 'constructor';
  initialStatus?: 'provider_accepted' | 'dispatch_ambiguous';
  composer?: () => Promise<string>;
} = {}) {
  const { XendraVoiceProvider } = await import('@/features/calls/adapters/xendra-voice.provider');
  const callId = randomUUID();
  const call: DispatchableCall = {
    id: callId, contactId: randomUUID(), conversationId: randomUUID(),
    phoneE164: '+5491123456789', status: options.initialStatus ?? 'requested',
    providerCallId: options.initialStatus === 'provider_accepted' ? 'provider-call-existing' : null,
    requestIdempotencyKey: `voice-call:${callId}`,
    context: {
      call_id: callId, nombre_lead: 'Lucas', curso_interes: 'Python', pais: 'AR',
      email_lead: '', resumen_whatsapp: 'Solicitó una llamada.', prompt_version: 'agent-b-v1',
    },
  };
  let dispatchError: string | null = null;
  let followupCompleted = false;
  let dialAttempts = 0;
  const deliveries = new Map<string, SendOutboundMessageInput>();
  const composeFollowup = options.composer ?? (async () => 'Lucas, no llegó a iniciarse la llamada. Seguimos con Python por aquí?');
  const backgroundTasks: Array<() => Promise<void>> = [];
  vi.doMock('next/server', () => ({ after: (work: () => Promise<void>) => { backgroundTasks.push(work); } }));
  let narrative: string | null = null;
  const followupStore: PostCallFollowupStore = {
    async loadNarrativeContext() { return {
      academy_name: 'StudyX',
      customer: { contact_intake: { nombre: 'Lucas', apellido: null, correo: null, telefono: null } },
      selected_course: { code: 'python', name: 'Python' }, selected_payment_plan: null, history: [],
      call_context: { course_interest: 'Python', conversation_summary: null }, analysis: null, failure_code: null,
    }; },
    async readFollowupNarrative() { return narrative; },
    async commitFollowupNarrative(_call, text) { narrative ??= text; return narrative; },
    async listPendingFollowups(input) {
      if (options.failFollowup) throw new Error('FOLLOWUP_DATABASE_UNAVAILABLE');
      if (input.call_id !== callId || input.grace_seconds !== 0 || call.status !== 'failed' || followupCompleted) return [];
      return [{
        call_id: callId, contact_id: call.contactId, conversation_id: call.conversationId,
        workspace_id: randomUUID(), channel: 'whatsapp', provider: 'retell', status: call.status,
        result: null, analysis_status: 'pending', prompt_version: 'agent-b-v1',
        disconnection_reason: null, provider_disconnection_reason: null,
      }];
    },
    async isContactBlocked() { return false; },
    async hasVerifiedPayment() { return false; },
    async revokeContact() {},
    async markFollowupCompleted() { followupCompleted = true; },
  };
  const sendOutbound = async (input: SendOutboundMessageInput) => {
    deliveries.set(input.idempotencyKey, input);
    return { outcome: 'sent' as const, deliveryId: randomUUID(), providerMessageId: 'followup-1', channel: 'whatsapp' as const, reason: null };
  };
  const provider = new XendraVoiceProvider({
    voiceProvider: 'xendra', callUrl: 'https://xendra.test/api/studyx/llamar',
    orchestratorSecret: 'test-secret', advisorName: '', closerNumber: '',
    telegramCanaryContactIds: [], requestTimeoutMs: 100,
  }, {
    sandboxLookup: { findSandboxProvider: async () => null },
    fetch: async () => {
      dialAttempts += 1;
      return Response.json({ call_id: 'provider-call-1' }, { status: options.providerStatus ?? 503 });
    },
  });
  vi.doMock('@/lib/config', () => ({ loadVoiceDispatchConfig: () => {
    if (options.setupFailure === 'configuration') throw new Error('MISSING_XENDRA_CONFIG:test-private-detail');
    return {};
  } }));
  vi.doMock('@/lib/db/orchestrator', () => ({ sql: {} }));
  vi.doMock('@/features/calls/adapters/postgres-call-store', () => ({
    PostgresCallStore: class {
      async claimDispatch(): Promise<DispatchClaim> {
        if (options.busy) return { outcome: 'busy', providerCallId: null };
        if (call.status === 'failed' || call.status === 'dispatch_ambiguous') return { outcome: call.status, providerCallId: null };
        if (call.status === 'provider_accepted') return { outcome: 'provider_accepted', providerCallId: call.providerCallId! };
        return { outcome: 'claimed', call };
      }
      async attachProviderCall(_id: string, providerCallId: string) { call.status = 'provider_accepted'; call.providerCallId = providerCallId; }
      async markDispatchFailed(_id: string, code: string) { call.status = 'failed'; dispatchError = code; }
      async markDispatchAmbiguous() { call.status = 'dispatch_ambiguous'; }
    },
  }));
  vi.doMock('@/features/calls/adapters/postgres-post-call-followup-store', () => ({
    PostgresPostCallFollowupStore: class { constructor() { return followupStore; } },
  }));
  vi.doMock('@/features/calls/adapters/agent-a-post-call-narrative', () => ({ createAgentAPostCallComposer: () => composeFollowup }));
  vi.doMock('@/features/messaging/adapters/managed-outbound', () => ({ createManagedOutboundSender: () => sendOutbound }));
  vi.doMock('@/app/api/agent/calls/[call_id]/dispatch/route-dependencies', () => ({ buildDispatchVoiceProvider: () => {
    if (options.setupFailure === 'constructor') throw new Error('PROVIDER_CONSTRUCTION_FAILED:test-private-detail');
    return provider;
  } }));
  const { POST } = await import('@/app/api/agent/calls/[call_id]/dispatch/route');
  return {
    call, deliveries, followupStore, sendOutbound, composeFollowup, backgroundTasks,
    flushBackground: async () => { while (backgroundTasks.length) await backgroundTasks.shift()!(); },
    get dispatchError() { return dispatchError; },
    get dialAttempts() { return dialAttempts; },
    get followupCompleted() { return followupCompleted; },
    dispatch: () => POST(new Request(`http://localhost/api/agent/calls/${callId}/dispatch`, {
      method: 'POST', headers: { 'x-request-id': randomUUID() },
    }), { params: Promise.resolve({ call_id: callId }) }),
  };
}

describe('dispatch failure follow-up boundary', () => {
  it('returns the durable failure before a deferred composer resolves and sends through the scheduled lifetime', async () => {
    let release: (text: string) => void = () => {};
    let started = false;
    const deferred = new Promise<string>((resolve) => { release = resolve; });
    const h = await harness({ composer: async () => { started = true; return deferred; } });
    const request = h.dispatch();
    try {
      const response = await Promise.race([request, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50))]);
      expect(response?.status).toBe(502);
      expect(h.call.status).toBe('failed');
      expect(h.backgroundTasks).toHaveLength(1);
      expect(started).toBe(false);
      expect(h.deliveries.size).toBe(0);
      const background = h.flushBackground();
      await vi.waitFor(() => expect(started).toBe(true));
      expect(h.followupCompleted).toBe(false);
      release('Lucas, retomamos Python desde donde quedamos.');
      await background;
      expect(h.deliveries.get(`post-call:${h.call.id}`)?.text).toBe('Lucas, retomamos Python desde donde quedamos.');
      expect(h.dialAttempts).toBe(1);
      expect(h.followupCompleted).toBe(true);
    } finally { release('Lucas, retomamos Python desde donde quedamos.'); await request; }
  });

  it.each(['configuration', 'constructor'] as const)('closes a %s failure before provider contact and notifies once', async (setupFailure) => {
    const h = await harness({ setupFailure });
    const response = await h.dispatch();
    await h.flushBackground();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: 'failed', providerCallId: null });
    expect(h.call.status).toBe('failed');
    expect(h.dispatchError).toBe('VOICE_PROVIDER_CONFIGURATION_UNAVAILABLE');
    expect(h.followupCompleted).toBe(true);
    expect(h.deliveries.size).toBe(1);
    expect(h.deliveries.get(`post-call:${h.call.id}`)?.text).not.toContain('test-private-detail');
    await h.dispatch();
    await h.flushBackground();
    expect(h.dialAttempts).toBe(0);
    expect(h.deliveries.size).toBe(1);
  });

  it.each([
    { initialStatus: 'provider_accepted' as const, expectedStatus: 'provider_accepted', http: 200 },
    { initialStatus: 'dispatch_ambiguous' as const, expectedStatus: 'dispatch_ambiguous', http: 202 },
    { busy: true, expectedStatus: 'busy', http: 202 },
  ])('keeps $expectedStatus fenced when provider configuration fails', async (scenario) => {
    const h = await harness({ ...scenario, setupFailure: 'configuration' });
    const response = await h.dispatch();
    await h.flushBackground();
    expect(response.status).toBe(scenario.http);
    expect(await response.json()).toMatchObject({ status: scenario.expectedStatus });
    expect(h.dispatchError).toBeNull();
    expect(h.deliveries.size).toBe(0);
    expect(h.dialAttempts).toBe(0);
  });

  it('notifies a confirmed Xendra 503 before returning and does not duplicate on replay or webhook follow-up', async () => {
    const h = await harness();
    const response = await h.dispatch();
    await h.flushBackground();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: 'failed', providerCallId: null });
    expect(h.dispatchError).toBe('XENDRA_CREATE_REJECTED_503');
    expect(h.followupCompleted).toBe(true);
    expect(h.deliveries.size).toBe(1);
    expect(h.deliveries.get(`post-call:${h.call.id}`)?.text).toBe('Lucas, no llegó a iniciarse la llamada. Seguimos con Python por aquí?');
    expect(h.deliveries.get(`post-call:${h.call.id}`)?.text).not.toMatch(/ocupad|te llamamos|ya te llam/i);

    await h.dispatch();
    await h.flushBackground();
    const { runPostCallFollowup } = await import('@/features/calls/application/post-call-followup');
    await runPostCallFollowup({ trace_id: randomUUID(), call_id: h.call.id, grace_seconds: 0 }, {
      store: h.followupStore, sendOutbound: h.sendOutbound, composeFollowup: h.composeFollowup,
    });
    expect(h.dialAttempts).toBe(1);
    expect(h.deliveries.size).toBe(1);
  });

  it.each([
    { providerStatus: 200, status: 'provider_accepted', http: 200, attempts: 1 },
    { providerStatus: 500, status: 'dispatch_ambiguous', http: 202, attempts: 1 },
    { busy: true, status: 'busy', http: 202, attempts: 0 },
  ])('preserves $status without emitting a failure notice or redialling', async (scenario) => {
    const h = await harness(scenario);
    const first = await h.dispatch();
    await h.flushBackground();
    expect(first.status).toBe(scenario.http);
    expect(await first.json()).toMatchObject({ status: scenario.status });
    await h.dispatch();
    await h.flushBackground();
    expect(h.deliveries.size).toBe(0);
    expect(h.dialAttempts).toBe(scenario.attempts);
  });

  it('keeps the known failure response and durable call state when follow-up storage is unavailable', async () => {
    const h = await harness({ failFollowup: true });
    const response = await h.dispatch();
    await h.flushBackground();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: 'failed', providerCallId: null });
    expect(h.call.status).toBe('failed');
    expect(h.followupCompleted).toBe(false);
    expect(h.deliveries.size).toBe(0);
  });
});
