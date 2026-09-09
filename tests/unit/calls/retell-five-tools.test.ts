import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  handleRetellToolRequest,
  type RetellOrchestrationStore,
  type RetellToolDependencies,
} from '@/features/calls/application/retell-tools';
import type { CallStore } from '@/features/calls/ports/call-store';
import type { RetellToolCallCorrelationStore } from '@/features/calls/ports/retell-call-correlation-store';
import { resolveRetellFollowupTimestamp } from '@/features/calls/adapters/postgres-retell-orchestration-store';

const apiKey = 'five-tools-api-key';
const toolsSecret = 'five-tools-secret';
const nowMs = 1_788_966_000_000;
const internalCallId = randomUUID();
const contactId = randomUUID();
const conversationId = randomUUID();
const providerCallId = 'call_five_tools_fixture';

function envelope(name: string, args: unknown) {
  return {
    name,
    call: {
      call_id: providerCallId,
      metadata: {
        internal_call_id: internalCallId,
        contact_id: contactId,
        conversation_id: conversationId,
      },
    },
    args,
  };
}

function signedRequest(body: unknown, options: { secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const digest = createHmac('sha256', apiKey).update(raw + String(nowMs), 'utf8').digest('hex');
  return new Request('http://localhost/retell/tools/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-studyx-tools-secret': options.secret ?? toolsSecret,
      'x-retell-signature': `v=${nowMs},d=${digest}`,
    },
    body: raw,
  });
}

function dependencies(overrides: Partial<RetellOrchestrationStore> = {}) {
  const calls = {
    claimDispatch: vi.fn(),
    attachProviderCall: vi.fn(),
    markDispatchAmbiguous: vi.fn(),
    markDispatchFailed: vi.fn(),
    appendEvent: vi.fn(async () => 'recorded' as const),
    recomputeProjection: vi.fn(),
    resolveRetellCall: vi.fn(),
    resolveRetellToolCall: vi.fn(async () => ({ callId: internalCallId })),
  } satisfies CallStore & RetellToolCallCorrelationStore;
  const orchestration: RetellOrchestrationStore = {
    createPaymentLink: vi.fn(async () => ({ sent: true, reference: 'pay_1' })),
    verifyPayment: vi.fn(async () => ({ state: 'paid' })),
    sendMaterial: vi.fn(async () => ({ sent: true, reference: 'delivery_1' })),
    requestHumanHandoff: vi.fn(async () => ({ requestId: 'handoff_1', available: null })),
    scheduleFollowup: vi.fn(async () => ({
      requestId: 'followup_1', scheduledAt: null, needsResolution: true,
    })),
    ...overrides,
  };
  return {
    apiKey,
    toolsSecret,
    workspaceSlug: 'studyx',
    calls,
    business: {
      loadCompleteIndex: vi.fn(), loadByCode: vi.fn(), loadBusinessContext: vi.fn(),
    },
    contacts: { saveCorrelatedContact: vi.fn() },
    sheets: null,
    orchestration,
    now: () => new Date(nowMs),
  } satisfies RetellToolDependencies;
}

async function invoke(name: Parameters<typeof handleRetellToolRequest>[1], args: unknown, deps = dependencies()) {
  const response = await handleRetellToolRequest(signedRequest(envelope(name, args)), name, deps);
  return { response, body: await response.json(), deps };
}

describe('remaining Retell orchestration tools', () => {
  it('only materializes a follow-up timestamp from an explicit timezone-aware ISO instant', () => {
    expect(resolveRetellFollowupTimestamp('2026-09-10T15:30:00-03:00')).toBe('2026-09-10T18:30:00.000Z');
    expect(resolveRetellFollowupTimestamp('el lunes por la mañana')).toBeNull();
    expect(resolveRetellFollowupTimestamp('2026-09-10T15:30:00')).toBeNull();
  });

  it('returns 401 before effects when the shared secret is missing or invalid', async () => {
    const deps = dependencies();
    const response = await handleRetellToolRequest(
      signedRequest(envelope('verificar_pago', {}), { secret: 'wrong' }),
      'verificar_pago',
      deps,
    );
    expect(response.status).toBe(401);
    expect(deps.orchestration.verifyPayment).not.toHaveBeenCalled();
  });

  it('creates one canonical payment link result and preserves pago.enviado/referencia', async () => {
    const result = await invoke('enviar_link_pago', {
      cursos: ['reparacion_celulares'], plan: 'contado', email: 'lead@example.com', canal: 'whatsapp',
    });
    expect(result.body).toEqual({ ok: true, pago: { enviado: true, referencia: 'pay_1' } });
    expect(result.deps.orchestration.createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
      callId: internalCallId, contactId, workspaceSlug: 'studyx',
      courses: ['reparacion_celulares'], plan: 'contado', email: 'lead@example.com', channel: 'whatsapp',
    }));
  });

  it('returns canonical payment state and never accepts a model assertion as state', async () => {
    const result = await invoke('verificar_pago', { referencia_pago: 'arbitrary-reference' });
    expect(result.body).toEqual({ ok: true, pago: { estado: 'paid' } });
    expect(result.deps.orchestration.verifyPayment).toHaveBeenCalledWith(expect.objectContaining({
      callId: internalCallId, contactId, reference: 'arbitrary-reference',
    }));
  });

  it('accepts the export-compatible empty payment reference and resolves by correlated contact', async () => {
    const result = await invoke('verificar_pago', { referencia_pago: '' });
    expect(result.body).toEqual({ ok: true, pago: { estado: 'paid' } });
    expect(result.deps.orchestration.verifyPayment).toHaveBeenCalledWith(expect.objectContaining({
      callId: internalCallId,
    }));
  });

  it('fails closed when canonical material delivery cannot prove an asset/channel', async () => {
    const deps = dependencies({
      sendMaterial: vi.fn(async () => ({ sent: false, reference: null, reason: 'MATERIAL_UNAVAILABLE' })),
    });
    const result = await invoke('enviar_material', { tipo: 'temario', curso: 'desconocido' }, deps);
    expect(result.body).toEqual({ ok: false, error: { code: 'MATERIAL_UNAVAILABLE' } });
  });

  it('returns durable handoff identity and does not claim unknown availability', async () => {
    const result = await invoke('derivar_a_asesor_humano', {
      motivo: 'pedido_explicito', detalle: 'Quiere hablar con una persona.', urgencia: 'normal',
    });
    expect(result.body).toEqual({
      ok: true, derivacion: { creada: true, referencia: 'handoff_1', disponible: null },
    });
  });

  it('preserves exact free-text schedule wording and explicitly requests resolution', async () => {
    const result = await invoke('agendar_seguimiento', {
      cuando: 'el lunes por la mañana', canal: 'whatsapp', motivo: 'Lo habla con su pareja',
    });
    expect(result.body).toEqual({
      ok: true,
      seguimiento: {
        agendado: false, referencia: 'followup_1', cuando: 'el lunes por la mañana',
        canal: 'whatsapp', motivo: 'Lo habla con su pareja', needs_resolution: true,
      },
    });
    expect(result.deps.orchestration.scheduleFollowup).toHaveBeenCalledWith(expect.objectContaining({
      whenText: 'el lunes por la mañana', channel: 'whatsapp', reason: 'Lo habla con su pareja',
    }));
  });

  it('returns structured authenticated validation failures with HTTP 200', async () => {
    const result = await invoke('enviar_link_pago', { cursos: [], plan: 'contado', email: 'bad' });
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ ok: false, error: { code: 'INVALID_TOOL_REQUEST' } });
  });
});
