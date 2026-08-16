import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import type { CallStore, DispatchableCall } from '@/features/calls/ports/call-store';
import { AmbiguousVoiceProviderError, ConfirmedVoiceProviderError, type VoiceProvider } from '@/features/calls/ports/voice-provider';

function session(): DispatchableCall {
  const callId = randomUUID();
  return {
    id: callId,
    phoneE164: '+999000000001',
    status: 'requested',
    providerCallId: null,
    requestIdempotencyKey: `voice-call:${callId}`,
    context: {
      call_id: callId, nombre_lead: 'Ana', curso_interes: 'Python', pais: 'AR', email_lead: '',
      resumen_whatsapp: 'Quiere llamada.', prompt_version: 'agent-b-v1',
    },
  };
}

function harness(placeCall: VoiceProvider['placeCall']) {
  const call = session();
  const store: CallStore = {
    claimDispatch: vi.fn(async () => ({ outcome: 'claimed' as const, call })),
    attachProviderCall: vi.fn(async () => undefined),
    markDispatchAmbiguous: vi.fn(async () => undefined),
    markDispatchFailed: vi.fn(async () => undefined),
    appendEvent: vi.fn(),
    recomputeProjection: vi.fn(),
  };
  const provider: VoiceProvider = { placeCall: vi.fn(placeCall), findCallByInternalId: vi.fn(), cancelCall: vi.fn() };
  return { call, store, provider };
}

describe('dispatchCall', () => {
  it('attaches one accepted provider call', async () => {
    const { call, store, provider } = harness(async () => ({ providerCallId: 'telegram:77', acceptedAt: '2026-08-16T12:00:00.000Z' }));
    await expect(dispatchCall({ callId: call.id, workerId: 'worker-1' }, { store, provider }))
      .resolves.toEqual({ status: 'provider_accepted', providerCallId: 'telegram:77' });
    expect(provider.placeCall).toHaveBeenCalledOnce();
    expect(store.attachProviderCall).toHaveBeenCalledWith(call.id, 'telegram:77', '2026-08-16T12:00:00.000Z');
  });

  it('persists timeout ambiguity and does not claim that dispatch failed', async () => {
    const { call, store, provider } = harness(async () => { throw new AmbiguousVoiceProviderError(); });
    await expect(dispatchCall({ callId: call.id, workerId: 'worker-1' }, { store, provider }))
      .resolves.toEqual({ status: 'dispatch_ambiguous', providerCallId: null });
    expect(store.markDispatchAmbiguous).toHaveBeenCalledOnce();
    expect(store.markDispatchFailed).not.toHaveBeenCalled();
  });

  it('records a confirmed provider rejection as failed', async () => {
    const { call, store, provider } = harness(async () => { throw new ConfirmedVoiceProviderError('TELEGRAM_REJECTED'); });
    await expect(dispatchCall({ callId: call.id, workerId: 'worker-1' }, { store, provider }))
      .resolves.toEqual({ status: 'failed', providerCallId: null });
    expect(store.markDispatchFailed).toHaveBeenCalledWith(call.id, 'TELEGRAM_REJECTED');
  });

  it('returns a previous accepted result without invoking the provider again', async () => {
    const { call, store, provider } = harness(async () => ({ providerCallId: 'unused', acceptedAt: 'unused' }));
    vi.mocked(store.claimDispatch).mockResolvedValue({ outcome: 'provider_accepted', providerCallId: 'telegram:77' });
    await expect(dispatchCall({ callId: call.id, workerId: 'worker-2' }, { store, provider }))
      .resolves.toEqual({ status: 'provider_accepted', providerCallId: 'telegram:77' });
    expect(provider.placeCall).not.toHaveBeenCalled();
  });
});
