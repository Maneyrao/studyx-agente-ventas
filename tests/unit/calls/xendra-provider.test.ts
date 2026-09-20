import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { XendraVoiceProvider } from '@/features/calls/adapters/xendra-voice.provider';
import {
  AmbiguousVoiceProviderError,
  ConfirmedVoiceProviderError,
  type PlaceVoiceCallInput,
} from '@/features/calls/ports/voice-provider';
import type { XendraVoiceConfig } from '@/lib/config';

const config: XendraVoiceConfig = {
  voiceProvider: 'xendra',
  callUrl: 'https://xendra.test/api/studyx/llamar',
  orchestratorSecret: 'test-orchestrator-secret',
  advisorName: 'Sofía',
  closerNumber: '+5491144445555',
  telegramCanaryContactIds: [],
  requestTimeoutMs: 1_000,
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(fetchImpl: typeof fetch, sandboxProvider: string | null = null) {
  return new XendraVoiceProvider(config, {
    fetch: fetchImpl,
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    sandboxLookup: { findSandboxProvider: vi.fn(async () => sandboxProvider) },
  });
}

describe('XendraVoiceProvider.placeCall', () => {
  it('sends exactly the Xendra dispatch contract and persists its call_id', async () => {
    const request = input();
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ ok: true, call_id: 'call_xendra_1' }));

    await expect(provider(fetchImpl).placeCall(request)).resolves.toEqual({
      providerCallId: 'call_xendra_1',
      acceptedAt: '2026-09-13T12:00:00.000Z',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(config.callUrl, expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-studyx-orchestrator-secret': 'test-orchestrator-secret',
      },
    }));
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      telefono: request.phoneE164,
      conversation_id: request.conversationId,
      lead_id: request.contactId,
      variables: {
        nombre_lead: 'Ana Pérez',
        curso_interes: 'Python',
        pais: 'Argentina',
        email_lead: 'ana@example.test',
        nombre_asesor: 'Sofía',
        numero_closer: '+5491144445555',
        resumen_whatsapp: 'Pidió detalles y aceptó una llamada.',
      },
    });
  });

  it('treats a 409 call_id as the already-accepted provider call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ ok: false, call_id: 'call_existing' }, 409));
    await expect(provider(fetchImpl).placeCall(input())).resolves.toEqual({
      providerCallId: 'call_existing',
      acceptedAt: '2026-09-13T12:00:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 503])('classifies HTTP %s as a confirmed failure', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ ok: false }, status));
    await expect(provider(fetchImpl).placeCall(input()))
      .rejects.toBeInstanceOf(ConfirmedVoiceProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ['HTTP 502', () => Promise.resolve(json({ ok: false }, 502))],
    ['network failure', () => Promise.reject(new Error('socket reset'))],
    ['malformed 200', () => Promise.resolve(json({ ok: true, call_id: '' }))],
    ['malformed 409', () => Promise.resolve(json({ ok: false }, 409))],
  ])('classifies %s as ambiguous and never retries', async (_label, response) => {
    const fetchImpl = vi.fn<typeof fetch>(response);
    await expect(provider(fetchImpl).placeCall(input()))
      .rejects.toBeInstanceOf(AmbiguousVoiceProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts a timeout as ambiguous and never retries', async () => {
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

  it('blocks sandbox contacts before dispatch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(provider(fetchImpl, 'telegram_sandbox').placeCall(input()))
      .rejects.toMatchObject({ code: 'CONTACT_IS_SANDBOX', kind: 'confirmed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows only the explicitly configured Telegram canary contact to dispatch', async () => {
    const request = input();
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ ok: true, call_id: 'call_canary_1' }));
    const canary = new XendraVoiceProvider({
      ...config,
      telegramCanaryContactIds: [request.contactId],
    }, {
      fetch: fetchImpl,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
      sandboxLookup: { findSandboxProvider: vi.fn(async () => 'telegram_sandbox') },
    });

    await expect(canary.placeCall(request)).resolves.toMatchObject({ providerCallId: 'call_canary_1' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never looks up or cancels through an unsupported Xendra endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(provider(fetchImpl).findCallByInternalId(randomUUID())).resolves.toBeNull();
    await expect(provider(fetchImpl).cancelCall('call_xendra_1'))
      .rejects.toMatchObject({ code: 'XENDRA_CANCEL_UNSUPPORTED', kind: 'confirmed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
