import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RetellVoiceProvider } from '@/features/calls/adapters/retell-voice.provider';
import {
  AmbiguousVoiceProviderError,
  ConfirmedVoiceProviderError,
  type PlaceVoiceCallInput,
} from '@/features/calls/ports/voice-provider';
import type { RetellVoiceConfig } from '@/lib/config';

const config: RetellVoiceConfig = {
  voiceProvider: 'retell',
  apiKey: 'test-api-key',
  fromNumber: '+14155550123',
  apiBaseUrl: 'https://retell.test',
  agentId: 'agent_d2c1a4ac7900ae95a47727156b',
  agentVersion: 0,
  llmId: 'llm_eea8f670b6569b44689e9394b150',
  llmVersion: 0,
  advisorName: 'Sofía',
  toolsSecret: 'test-tools-secret',
  requestTimeoutMs: 1000,
};

function input(): PlaceVoiceCallInput {
  const callId = randomUUID();
  return {
    callId,
    contactId: randomUUID(),
    conversationId: randomUUID(),
    phoneE164: '+5491112345678',
    idempotencyKey: `voice-call:${callId}`,
    context: {
      call_id: callId,
      nombre_lead: 'Ana Pérez',
      apellido_lead: 'Pérez',
      curso_interes: 'Python',
      pais: 'Argentina',
      email_lead: 'ana@example.test',
      resumen_whatsapp: 'Pidió detalles y aceptó una llamada.',
      prompt_version: 'agent-b-v1',
      campos_faltantes: [],
    },
  };
}

function provider(fetchImpl: typeof fetch, sandboxProvider: string | null = null) {
  return new RetellVoiceProvider(config, {
    fetch: fetchImpl,
    now: () => new Date('2026-09-09T12:00:00.000Z'),
    sandboxLookup: { findSandboxProvider: vi.fn(async () => sandboxProvider) },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RetellVoiceProvider.placeCall', () => {
  it('sends the exact version-locked call request without transcript history', async () => {
    const request = input();
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ call_id: 'retell-call-1' }, 201));

    await expect(provider(fetchImpl).placeCall(request)).resolves.toEqual({
      providerCallId: 'retell-call-1',
      acceptedAt: '2026-09-09T12:00:00.000Z',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://retell.test/v2/create-phone-call');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from_number: '+14155550123',
      to_number: '+5491112345678',
      override_agent_id: 'agent_d2c1a4ac7900ae95a47727156b',
      override_agent_version: 0,
      agent_override: {
        agent: {
          response_engine: {
            type: 'retell-llm',
            llm_id: 'llm_eea8f670b6569b44689e9394b150',
            version: 0,
          },
        },
      },
      metadata: {
        internal_call_id: request.callId,
        contact_id: request.contactId,
        conversation_id: request.conversationId,
      },
      retell_llm_dynamic_variables: {
        nombre_lead: 'Ana Pérez',
        apellido_lead: 'Pérez',
        curso_interes: 'Python',
        pais: 'Argentina',
        email_lead: 'ana@example.test',
        resumen_whatsapp: 'Pidió detalles y aceptó una llamada.',
        campos_faltantes: '',
        nombre_asesor: 'Sofía',
      },
    });
  });

  it('blocks a sandbox contact before any Retell request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(provider(fetchImpl, 'telegram_sandbox').placeCall(input()))
      .rejects.toMatchObject({ code: 'CONTACT_IS_SANDBOX', kind: 'confirmed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies a Retell 4xx as a confirmed rejection and never retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ status: 'error' }, 422));
    await expect(provider(fetchImpl).placeCall(input()))
      .rejects.toBeInstanceOf(ConfirmedVoiceProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ['network failure', () => Promise.reject(new Error('socket reset'))],
    ['Retell 5xx', () => Promise.resolve(json({ status: 'error' }, 503))],
    ['malformed success body', () => Promise.resolve(json({ call_id: '' }, 201))],
    ['unknown HTTP outcome', () => Promise.resolve(json({}, 302))],
  ])('classifies %s as ambiguous and never retries', async (_name, response) => {
    const fetchImpl = vi.fn<typeof fetch>(response);
    await expect(provider(fetchImpl).placeCall(input()))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts a timed-out create as ambiguous without redialing', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const outcome = provider(fetchImpl).placeCall(input());
    const rejection = expect(outcome).rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    await vi.advanceTimersByTimeAsync(config.requestTimeoutMs);
    await rejection;
    expect(fetchImpl).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('RetellVoiceProvider.findCallByInternalId', () => {
  it('uses the v3 items response and returns the unique matching metadata call', async () => {
    const callId = randomUUID();
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      has_more: false,
      items: [
        { call_id: 'other', metadata: { internal_call_id: randomUUID() } },
        { call_id: 'retell-call-1', metadata: { internal_call_id: callId } },
      ],
    }));

    await expect(provider(fetchImpl).findCallByInternalId(callId))
      .resolves.toEqual({ providerCallId: 'retell-call-1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://retell.test/v3/list-calls');
    expect(JSON.parse(String(init?.body))).toEqual({
      filter_criteria: {
        metadata: [{ key: 'internal_call_id', type: 'string', value: callId }],
      },
      limit: 2,
    });
  });

  it('returns null for zero exact metadata matches', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ has_more: false, items: [] }));
    await expect(provider(fetchImpl).findCallByInternalId(randomUUID())).resolves.toBeNull();
  });

  it.each([
    ['missing', { items: [] }],
    ['non-Boolean', { has_more: 'false', items: [] }],
    ['true', { has_more: true, items: [] }],
  ])('keeps a %s has_more response ambiguous', async (_name, responseBody) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(responseBody));
    await expect(provider(fetchImpl).findCallByInternalId(randomUUID()))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects multiple exact metadata matches as ambiguous', async () => {
    const callId = randomUUID();
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      has_more: false,
      items: [
        { call_id: 'retell-call-1', metadata: { internal_call_id: callId } },
        { call_id: 'retell-call-2', metadata: { internal_call_id: callId } },
      ],
    }));
    await expect(provider(fetchImpl).findCallByInternalId(callId))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
  });
});

describe('RetellVoiceProvider.cancelCall', () => {
  it('maps cancel to the encoded v2 stop-call endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await expect(provider(fetchImpl).cancelCall('call/id')).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://retell.test/v2/stop-call/call%2Fid',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('classifies stop 4xx as confirmed and stop 5xx/network as ambiguous', async () => {
    await expect(provider(vi.fn<typeof fetch>(async () => json({}, 404))).cancelCall('missing'))
      .rejects.toBeInstanceOf(ConfirmedVoiceProviderError);
    await expect(provider(vi.fn<typeof fetch>(async () => json({}, 503))).cancelCall('active'))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    await expect(provider(vi.fn<typeof fetch>(async () => { throw new Error('reset'); })).cancelCall('active'))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
  });
});
