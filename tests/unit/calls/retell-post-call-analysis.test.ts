import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  mapRetellLifecycleEvent,
  RetellLifecycleWebhookSchema,
} from '@/features/calls/adapters/retell-lifecycle';
import {
  handleRetellToolRequest,
} from '@/features/calls/application/retell-tools';
import type { CallStore } from '@/features/calls/ports/call-store';
import type { RetellToolCallCorrelationStore } from '@/features/calls/ports/retell-call-correlation-store';
import { decidePostCallFollowup } from '@/features/calls/domain/post-call-followup';

const apiKey = 'analysis-api-key';
const toolsSecret = 'analysis-tools-secret';
const nowMs = 1_788_966_000_000;
const callId = randomUUID();
const contactId = randomUUID();
const conversationId = randomUUID();
const providerCallId = 'call_analysis_fixture';

function completeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    event: 'call_analyzed' as const,
    call: {
      call_id: providerCallId,
      metadata: {
        internal_call_id: callId,
        contact_id: contactId,
        conversation_id: conversationId,
      },
      end_timestamp: nowMs,
      transcript: 'must never be persisted',
      recording_url: 'https://example.invalid/recording',
      call_analysis: {
        call_summary: 'Buscaba Redes y quedó en revisar el pago.',
        user_sentiment: 'positive',
        custom_analysis_data: {
          resultado: 'link_enviado_sin_pago',
          curso_ofrecido: 'Redes Informáticas',
          precio_ofrecido: 'USD 360',
          objecion_principal: 'precio',
          nivel_interes: 'alto',
          email_capturado: 'lead@example.test',
          link_pago_enviado: true,
          pago_confirmado: false,
          pidio_humano: false,
          pidio_no_contactar: false,
          pregunto_si_es_ia: true,
          compromiso_pendiente: 'Revisar el link mañana.',
          ...overrides,
        },
      },
    },
  };
}

function signedRequest(body: unknown) {
  const raw = JSON.stringify(body);
  const digest = createHmac('sha256', apiKey).update(raw + String(nowMs), 'utf8').digest('hex');
  return new Request('http://localhost/retell/tools/registrar-resultado', {
    method: 'POST',
    headers: {
      'x-retell-signature': `v=${nowMs},d=${digest}`,
      'x-studyx-tools-secret': toolsSecret,
    },
    body: raw,
  });
}

function toolDependencies() {
  const calls = {
    claimDispatch: vi.fn(),
    attachProviderCall: vi.fn(),
    markDispatchAmbiguous: vi.fn(),
    markDispatchFailed: vi.fn(),
    appendEvent: vi.fn(async () => 'recorded' as const),
    recomputeProjection: vi.fn(async () => ({
      status: 'completed' as const,
      analysisStatus: 'completed' as const,
      result: 'link_enviado_sin_pago' as const,
    })),
    resolveRetellCall: vi.fn(async () => ({ callId })),
    resolveRetellToolCall: vi.fn(async () => ({ callId })),
  } satisfies CallStore & RetellToolCallCorrelationStore;
  return {
    apiKey,
    toolsSecret,
    workspaceSlug: 'studyx',
    calls,
    business: {
      loadCompleteIndex: vi.fn(),
      loadByCode: vi.fn(),
      loadBusinessContext: vi.fn(),
    },
    contacts: { saveCorrelatedContact: vi.fn() },
    sheets: null,
    now: () => new Date(nowMs),
  };
}

describe('bounded Retell post-call analysis', () => {
  it('maps the complete 14-field analysis while discarding transcript and recording data', () => {
    const event = mapRetellLifecycleEvent(completeWebhook(), callId);
    expect(event.payload).toMatchObject({
      event_type: 'analyzed',
      analysis: {
        call_summary: 'Buscaba Redes y quedó en revisar el pago.',
        user_sentiment: 'positive',
        result: 'link_enviado_sin_pago',
        curso_ofrecido: 'Redes Informáticas',
        precio_ofrecido: 'USD 360',
        objecion_principal: 'precio',
        nivel_interes: 'alto',
        email_capturado: 'lead@example.test',
        link_pago_enviado: true,
        pago_confirmado: false,
        pidio_humano: false,
        pidio_no_contactar: false,
        pregunto_si_es_ia: true,
        compromiso_pendiente: 'Revisar el link mañana.',
      },
    });
    expect(JSON.stringify(event)).not.toContain('transcript');
    expect(JSON.stringify(event)).not.toContain('recording');
  });

  it('rejects invalid bounded enums and captured email before correlation', () => {
    const invalid = completeWebhook({
      objecion_principal: 'inventada',
      email_capturado: 'not-an-email',
    });
    expect(RetellLifecycleWebhookSchema.safeParse(invalid).success).toBe(false);
  });

  it('records the complete analysis from registrar_resultado using canonical event persistence', async () => {
    const deps = toolDependencies();
    const body = {
      name: 'registrar_resultado',
      call: {
        call_id: providerCallId,
        metadata: { internal_call_id: callId, contact_id: contactId, conversation_id: conversationId },
      },
      args: {
        resultado: 'link_enviado_sin_pago',
        call_summary: 'Se envió el enlace y revisará mañana.',
        user_sentiment: 'positive',
        curso_ofrecido: 'Redes Informáticas',
        precio_ofrecido: 'USD 360',
        objecion_principal: 'precio',
        nivel_interes: 'alto',
        email_capturado: 'lead@example.test',
        link_pago_enviado: true,
        pago_confirmado: false,
        pidio_humano: false,
        pidio_no_contactar: false,
        pregunto_si_es_ia: true,
        compromiso_pendiente: 'Revisar mañana.',
      },
    };
    const response = await handleRetellToolRequest(signedRequest(body), 'registrar_resultado', deps);
    expect(await response.json()).toEqual({ ok: true, recorded: true });
    expect(deps.calls.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        analysis: expect.objectContaining({
          call_summary: 'Se envió el enlace y revisará mañana.',
          pago_confirmado: false,
          email_capturado: 'lead@example.test',
        }),
      }),
    }));
  });

  it('revokes before any post-call outbound when analysis says do not contact', () => {
    expect(decidePostCallFollowup({
      status: 'completed',
      result: 'seguimiento_agendado',
      analysisStatus: 'completed',
      paymentVerified: true,
      doNotContact: true,
    })).toEqual({ action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
  });
});
