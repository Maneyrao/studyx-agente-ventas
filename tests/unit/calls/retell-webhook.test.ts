import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleRetellWebhook } from '@/features/calls/application/retell-webhook';
import {
  mapRetellLifecycleEvent,
  verifyRetellSignature,
} from '@/features/calls/adapters/retell-lifecycle';
import { RetellCallCorrelationError } from '@/features/calls/ports/retell-call-correlation-store';
import type { CallStore } from '@/features/calls/ports/call-store';
import type { RetellCallCorrelationStore } from '@/features/calls/ports/retell-call-correlation-store';

const apiKey = 'retell-webhook-test-key';
const nowMs = 1_788_966_000_000;
const internalCallId = randomUUID();
const contactId = randomUUID();
const conversationId = randomUUID();
const providerCallId = 'call_retell_fixture_1';
const expectedBodyLimit = 256 * 1_024;

function wrapper(event: 'call_started' | 'call_ended' | 'call_analyzed') {
  const common = {
    call_id: providerCallId,
    metadata: {
      internal_call_id: internalCallId,
      contact_id: contactId,
      conversation_id: conversationId,
    },
    start_timestamp: nowMs - 65_400,
    end_timestamp: nowMs - 1_000,
    disconnection_reason: 'user_hangup',
    transcript: 'sensitive transcript that must never enter the canonical event',
    transcript_object: [{ role: 'agent', content: 'sensitive' }],
    recording_url: 'https://example.invalid/sensitive-recording',
    public_log_url: 'https://example.invalid/sensitive-log',
    call_analysis: {
      call_summary: 'Pidió información y cerró sin comprar.',
      custom_analysis_data: {
        resultado: 'no_interesado',
        nivel_interes: 'bajo',
        objecion_principal: 'precio',
        precio_ofrecido: 'sensitive-commercial-detail',
      },
    },
  };
  return { event, call: common };
}

function signature(rawBody: string, timestamp = nowMs): string {
  const digest = createHmac('sha256', apiKey).update(rawBody + String(timestamp), 'utf8').digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function request(rawBody: string, header = signature(rawBody)): Request {
  return new Request('http://localhost/retell/eventos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-retell-signature': header },
    body: rawBody,
  });
}

function streamedRequest(input: {
  chunks: Array<string | Uint8Array>;
  signatureHeader?: string;
  contentLength?: string;
}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of input.chunks) {
        controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  const headers = new Headers({ 'content-type': 'application/json' });
  if (input.signatureHeader) headers.set('x-retell-signature', input.signatureHeader);
  if (input.contentLength) headers.set('content-length', input.contentLength);
  return new Request('http://localhost/retell/eventos', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

function dependencies(overrides: Partial<CallStore & RetellCallCorrelationStore> = {}) {
  const calls = {
    claimDispatch: vi.fn(),
    attachProviderCall: vi.fn(),
    markDispatchAmbiguous: vi.fn(),
    markDispatchFailed: vi.fn(),
    appendEvent: vi.fn(async () => 'recorded' as const),
    recomputeProjection: vi.fn(async () => ({
      status: 'completed' as const,
      analysisStatus: 'completed' as const,
      result: 'no_interesado' as const,
    })),
    resolveRetellCall: vi.fn(async () => ({ callId: internalCallId })),
    ...overrides,
  } satisfies CallStore & RetellCallCorrelationStore;
  return { apiKey, calls, now: () => new Date(nowMs) };
}

describe('Retell signature verification', () => {
  it('authenticates the untouched body plus timestamp and rejects a changed byte', () => {
    const rawBody = JSON.stringify(wrapper('call_started'));
    const header = signature(rawBody);
    expect(verifyRetellSignature({ rawBody, signature: header, apiKey, nowMs })).toBe(true);
    expect(verifyRetellSignature({ rawBody: `${rawBody} `, signature: header, apiKey, nowMs })).toBe(false);
  });

  it('fails closed for stale, future, malformed, and uppercase signatures', () => {
    const rawBody = '{}';
    expect(verifyRetellSignature({ rawBody, signature: signature(rawBody, nowMs - 300_001), apiKey, nowMs })).toBe(false);
    expect(verifyRetellSignature({ rawBody, signature: signature(rawBody, nowMs + 300_001), apiKey, nowMs })).toBe(false);
    expect(verifyRetellSignature({ rawBody, signature: `d=${'0'.repeat(64)},v=${nowMs}`, apiKey, nowMs })).toBe(false);
    expect(verifyRetellSignature({ rawBody, signature: `v=${nowMs},d=${'A'.repeat(64)}`, apiKey, nowMs })).toBe(false);
  });
});

describe('Retell lifecycle mapping', () => {
  it('maps started, ended, and analyzed to stable canonical identities and timestamps', () => {
    const started = mapRetellLifecycleEvent(wrapper('call_started'), internalCallId);
    const ended = mapRetellLifecycleEvent(wrapper('call_ended'), internalCallId);
    const analyzed = mapRetellLifecycleEvent(wrapper('call_analyzed'), internalCallId);

    expect(started).toEqual({
      schema_version: 1,
      event_id: `retell:call_started:${providerCallId}`,
      call_id: internalCallId,
      event_type: 'started',
      sequence: 1,
      occurred_at: new Date(nowMs - 65_400).toISOString(),
      provider: 'retell',
      payload: { event_type: 'started', started_at: new Date(nowMs - 65_400).toISOString() },
    });
    expect(ended.payload).toEqual({
      event_type: 'ended',
      ended_at: new Date(nowMs - 1_000).toISOString(),
      duration_seconds: 64,
      disconnection_reason: 'user_hangup',
    });
    expect(analyzed.payload).toEqual({
      event_type: 'analyzed',
      analysis: {
        call_summary: 'Pidió información y cerró sin comprar.',
        result: 'no_interesado',
        resultado: 'no_interesado',
        nivel_interes: 'bajo',
        objecion: 'precio',
        objecion_principal: 'precio',
        precio_ofrecido: 'sensitive-commercial-detail',
        notas: 'Pidió información y cerró sin comprar.',
      },
    });
    expect(JSON.stringify([started, ended, analyzed])).not.toContain('transcript');
    expect(JSON.stringify([started, ended, analyzed])).not.toContain('recording');
    expect([started.sequence, ended.sequence, analyzed.sequence]).toEqual([1, 2, 3]);
  });

  it.each([
    ['agent_hangup', 'agent_hangup'],
    ['manual_stopped', 'agent_hangup'],
    ['dial_busy', 'busy'],
    ['dial_no_answer', 'no_answer'],
    ['user_declined', 'no_answer'],
    ['voicemail_reached', 'voicemail'],
    ['inactivity', 'timed_out'],
    ['max_duration_reached', 'timed_out'],
    ['registered_call_timeout', 'failed_to_connect'],
    ['dial_failed', 'failed_to_connect'],
    ['telephony_provider_unavailable', 'failed_to_connect'],
    ['error_llm_websocket_runtime', 'failed_to_connect'],
    ['error_no_audio_received', 'failed_to_connect'],
    ['error_asr', 'failed_to_connect'],
    ['future_retell_reason', 'other'],
  ] as const)('maps disconnection reason %s to %s', (source, expected) => {
    const payload = wrapper('call_ended');
    payload.call.disconnection_reason = source;
    expect(mapRetellLifecycleEvent(payload, internalCallId).payload).toMatchObject({
      disconnection_reason: expected,
    });
  });

  it.each(['buzon_de_voz', 'corto_la_llamada'] as const)('maps supplied analysis outcome %s without an unsafe cast', (result) => {
    const payload = wrapper('call_analyzed');
    payload.call.call_analysis.custom_analysis_data.resultado = result;
    expect(mapRetellLifecycleEvent(payload, internalCallId).payload).toMatchObject({
      analysis: { result },
    });
  });
});

describe('Retell webhook application boundary', () => {
  it('returns 413 for an oversized signed body before parsing or correlation', async () => {
    const deps = dependencies();
    const rawBody = 'x'.repeat(expectedBodyLimit + 1);
    const response = await handleRetellWebhook(request(rawBody), deps);
    expect(response.status).toBe(413);
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
    expect(deps.calls.appendEvent).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversized unsigned body before authentication or correlation', async () => {
    const deps = dependencies();
    const response = await handleRetellWebhook(streamedRequest({
      chunks: ['x'.repeat(expectedBodyLimit), 'x'],
    }), deps);
    expect(response.status).toBe(413);
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
    expect(deps.calls.appendEvent).not.toHaveBeenCalled();
  });

  it('enforces the streamed byte cap when Content-Length lies about a chunked body', async () => {
    const deps = dependencies();
    const chunks = ['x'.repeat(128 * 1_024), 'x'.repeat(128 * 1_024), 'x'];
    const rawBody = chunks.join('');
    const response = await handleRetellWebhook(streamedRequest({
      chunks,
      contentLength: '12',
      signatureHeader: signature(rawBody),
    }), deps);
    expect(response.status).toBe(413);
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
    expect(deps.calls.appendEvent).not.toHaveBeenCalled();
  });

  it('preserves exact signed UTF-8 bytes when a multibyte character is split across chunks', async () => {
    const deps = dependencies();
    const payload = wrapper('call_started');
    payload.call.transcript = 'señal';
    const rawBody = JSON.stringify(payload);
    const encoded = new TextEncoder().encode(rawBody);
    const marker = new TextEncoder().encode('ñ');
    const markerIndex = encoded.findIndex((byte, index) => (
      byte === marker[0] && encoded[index + 1] === marker[1]
    ));
    const response = await handleRetellWebhook(streamedRequest({
      chunks: [encoded.slice(0, markerIndex + 1), encoded.slice(markerIndex + 1)],
      signatureHeader: signature(rawBody),
    }), deps);
    expect(response.status).toBe(204);
    expect(deps.calls.resolveRetellCall).toHaveBeenCalledOnce();
  });

  it('returns 401 before parsing or persistence for a bad signature', async () => {
    const deps = dependencies();
    const response = await handleRetellWebhook(request('{invalid-json', 'v=0,d=bad'), deps);
    expect(response.status).toBe(401);
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
    expect(deps.calls.appendEvent).not.toHaveBeenCalled();
  });

  it('rejects a malformed authenticated wrapper without touching correlation', async () => {
    const deps = dependencies();
    const rawBody = JSON.stringify({ event: 'call_started', call: { call_id: providerCallId } });
    const response = await handleRetellWebhook(request(rawBody), deps);
    expect(response.status).toBe(400);
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
  });

  it('rejects unknown correlation before event append', async () => {
    const deps = dependencies({
      resolveRetellCall: vi.fn(async () => {
        throw new RetellCallCorrelationError('CALL_CORRELATION_NOT_FOUND');
      }),
    });
    const rawBody = JSON.stringify(wrapper('call_started'));
    const response = await handleRetellWebhook(request(rawBody), deps);
    expect(response.status).toBe(404);
    expect(deps.calls.appendEvent).not.toHaveBeenCalled();
  });

  it.each(['call_started', 'call_ended', 'call_analyzed'] as const)('correlates and durably records %s before acknowledging', async (event) => {
    const deps = dependencies();
    const rawBody = JSON.stringify(wrapper(event));
    const response = await handleRetellWebhook(request(rawBody), deps);
    expect(response.status).toBe(204);
    expect(deps.calls.resolveRetellCall).toHaveBeenCalledWith({
      providerCallId,
      metadata: { internalCallId, contactId, conversationId },
    });
    expect(deps.calls.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_id: event === 'call_analyzed'
        ? `retell:webhook:call_analyzed:${providerCallId}`
        : `retell:${event}:${providerCallId}`,
      call_id: internalCallId,
    }));
    expect(deps.calls.recomputeProjection).toHaveBeenCalledWith(internalCallId);
  });

  it('acknowledges an identical provider replay only after canonical duplicate proof', async () => {
    const deps = dependencies({ appendEvent: vi.fn(async () => 'duplicate' as const) });
    const rawBody = JSON.stringify(wrapper('call_ended'));
    expect((await handleRetellWebhook(request(rawBody), deps)).status).toBe(204);
    expect(deps.calls.recomputeProjection).toHaveBeenCalledTimes(1);
  });

  it('returns non-2xx for a changed replay or persistence failure so Retell can retry', async () => {
    const conflict = dependencies({
      appendEvent: vi.fn(async () => { throw new Error('CALL_EVENT_REPLAY_CONFLICT'); }),
    });
    const failed = dependencies({
      appendEvent: vi.fn(async () => { throw new Error('DATABASE_UNAVAILABLE'); }),
    });
    const rawBody = JSON.stringify(wrapper('call_analyzed'));
    expect((await handleRetellWebhook(request(rawBody), conflict)).status).toBe(409);
    expect((await handleRetellWebhook(request(rawBody), failed)).status).toBe(500);
  });
});
