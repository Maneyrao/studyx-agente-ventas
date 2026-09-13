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
import { mergeCallAnalyses } from '@/features/calls/domain/call-state';

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

function completeWebhookWithField(field: string, value: unknown) {
  const webhook = completeWebhook();
  if (field === 'call_summary' || field === 'user_sentiment') {
    (webhook.call.call_analysis as Record<string, unknown>)[field] = value;
  } else {
    (webhook.call.call_analysis.custom_analysis_data as Record<string, unknown>)[field] = value;
  }
  return webhook;
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
  it('treats omitted Retell booleans as false in a partially extended webhook export', () => {
    const partial = completeWebhook();
    const custom = (partial.call as { call_analysis: { custom_analysis_data: Record<string, unknown> } })
      .call_analysis.custom_analysis_data;
    delete custom.pago_confirmado;
    delete custom.pidio_humano;
    delete custom.pidio_no_contactar;
    delete custom.pregunto_si_es_ia;
    expect(mapRetellLifecycleEvent(partial, callId).payload).toMatchObject({
      event_type: 'analyzed',
      analysis: {
        link_pago_enviado: true,
        pago_confirmado: false,
        pidio_humano: false,
        pidio_no_contactar: false,
        pregunto_si_es_ia: false,
      },
    });
  });

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

  it.each([
    ['call_summary', ''],
    ['call_summary', 'x'.repeat(4_097)],
    ['user_sentiment', 'joyful'],
    ['resultado', 'unknown_result'],
    ['curso_ofrecido', 'x'.repeat(257)],
    ['precio_ofrecido', 'x'.repeat(257)],
    ['objecion_principal', 'other_objection'],
    ['nivel_interes', 'extremo'],
    ['email_capturado', 'not-an-email'],
    ['link_pago_enviado', 'true'],
    ['pago_confirmado', 1],
    ['pidio_humano', null],
    ['pidio_no_contactar', 'false'],
    ['pregunto_si_es_ia', 0],
    ['compromiso_pendiente', 'x'.repeat(1_025)],
  ] as const)('rejects invalid type, enum, or exact upper-bound value for %s', (field, value) => {
    const invalid = completeWebhookWithField(field, value);
    expect(RetellLifecycleWebhookSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts exact bounded string edges and both boolean values for all complete fields', () => {
    const maxEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    const valid = completeWebhook({});
    valid.call.call_analysis.call_summary = 'x'.repeat(4_096);
    valid.call.call_analysis.custom_analysis_data = {
      ...valid.call.call_analysis.custom_analysis_data,
      curso_ofrecido: 'x'.repeat(256),
      precio_ofrecido: 'x'.repeat(256),
      email_capturado: maxEmail,
      compromiso_pendiente: 'x'.repeat(1_024),
      link_pago_enviado: false,
      pago_confirmado: true,
      pidio_humano: false,
      pidio_no_contactar: true,
      pregunto_si_es_ia: false,
    };
    expect(RetellLifecycleWebhookSchema.safeParse(valid).success).toBe(true);
  });

  it.each(['nivel_interes', 'objecion_principal'] as const)(
    'rejects null for required complete enum field %s',
    (field) => {
      const invalid = completeWebhook({ [field]: null });
      expect(RetellLifecycleWebhookSchema.safeParse(invalid).success).toBe(false);
    },
  );

  it('preserves the real legacy export containing objecion_principal without requiring complete booleans', () => {
    const legacy = completeWebhook() as unknown as {
      call: {
        call_analysis: {
          custom_analysis_data: Record<string, unknown>;
          user_sentiment?: string;
        };
      };
    };
    legacy.call.call_analysis.custom_analysis_data = {
      resultado: 'seguimiento_agendado',
      nivel_interes: 'medio',
      objecion_principal: 'precio',
    };
    legacy.call.call_analysis.user_sentiment = undefined;
    expect(RetellLifecycleWebhookSchema.safeParse(legacy).success).toBe(true);
    expect(mapRetellLifecycleEvent(legacy, callId).payload).toMatchObject({
      event_type: 'analyzed',
      analysis: {
        result: 'seguimiento_agendado',
        nivel_interes: 'medio',
        objecion: 'precio',
      },
    });
  });

  it('accepts Retell system-presets sentiment casing and maps it to the internal enum', () => {
    const providerPayload = completeWebhook();
    providerPayload.call.call_analysis.user_sentiment = 'Positive';
    expect(mapRetellLifecycleEvent(providerPayload, callId).payload).toMatchObject({
      event_type: 'analyzed',
      analysis: { user_sentiment: 'positive' },
    });
  });

  it('treats a legacy no_contactar result as monotonic consent revocation', () => {
    const base = mapRetellLifecycleEvent(completeWebhook({
      pidio_no_contactar: false,
      resultado: 'no_contactar',
    }), callId);
    const webhook = { ...base, event_id: `retell:webhook:call_analyzed:${providerCallId}` };
    const later = { ...base, event_id: `retell:tool:call_analyzed:${providerCallId}`, payload: {
      event_type: 'analyzed' as const,
      analysis: { ...(base.payload as Extract<typeof base.payload, { event_type: 'analyzed' }>).analysis,
        resultado: 'seguimiento_agendado' as const, result: 'seguimiento_agendado' as const, pidio_no_contactar: false },
    } };
    expect(mergeCallAnalyses([webhook, later]).pidio_no_contactar).toBe(true);
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

  it('keeps registrar_resultado primary while the webhook enriches CRM fields', () => {
    const tool = mapRetellLifecycleEvent(completeWebhook({
      resultado: 'seguimiento_agendado',
      email_capturado: 'tool@example.test',
      pidio_no_contactar: false,
    }), callId);
    const toolSource = { ...tool, event_id: `retell:tool:call_analyzed:${providerCallId}` };
    const toolAnalysis = (tool.payload as Extract<typeof tool.payload, { event_type: 'analyzed' }>).analysis;
    const webhook = { ...tool, event_id: `retell:webhook:call_analyzed:${providerCallId}`, payload: {
      event_type: 'analyzed' as const,
      analysis: {
        ...toolAnalysis,
        result: 'no_interesado' as const,
        resultado: 'no_interesado' as const,
        email_capturado: 'webhook@example.test',
        pidio_no_contactar: true,
      },
    } };
    const mergedForward = mergeCallAnalyses([toolSource, webhook]);
    const mergedReverse = mergeCallAnalyses([webhook, toolSource]);
    expect(mergedForward).toEqual(mergedReverse);
    expect(mergedForward).toMatchObject({
      result: 'seguimiento_agendado',
      resultado: 'seguimiento_agendado',
      email_capturado: 'webhook@example.test',
      pidio_no_contactar: true,
    });
    const optOutTool = {
      ...toolSource,
      payload: { event_type: 'analyzed' as const, analysis: { ...toolAnalysis, pidio_no_contactar: true } },
    };
    const nonOptOutWebhook = {
      ...webhook,
      payload: { event_type: 'analyzed' as const, analysis: { ...toolAnalysis, pidio_no_contactar: false } },
    };
    expect(mergeCallAnalyses([nonOptOutWebhook, optOutTool]).pidio_no_contactar).toBe(true);
  });

  it('does not let a cancelled call bypass a durable do-not-contact claim', () => {
    expect(decidePostCallFollowup({
      status: 'cancelled',
      result: 'seguimiento_agendado',
      analysisStatus: 'completed',
      paymentVerified: false,
      doNotContact: true,
    })).toEqual({ action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
  });

  it('accepts both missing Retell call-result outcomes', async () => {
    const deps = toolDependencies();
    for (const resultado of ['buzon_de_voz', 'corto_la_llamada'] as const) {
      const body = {
        name: 'registrar_resultado',
        call: {
          call_id: providerCallId,
          metadata: { internal_call_id: callId, contact_id: contactId, conversation_id: conversationId },
        },
        args: { resultado, resumen: 'Resultado de prueba.' },
      };
      const response = await handleRetellToolRequest(signedRequest(body), 'registrar_resultado', deps);
      expect(response.status).toBe(200);
    }
  });

  it('rejects a partially extended registrar_resultado payload', async () => {
    const deps = toolDependencies();
    const response = await handleRetellToolRequest(signedRequest({
      name: 'registrar_resultado',
      call: {
        call_id: providerCallId,
        metadata: { internal_call_id: callId, contact_id: contactId, conversation_id: conversationId },
      },
      args: {
        resultado: 'link_enviado_sin_pago',
        call_summary: 'Resumen legacy real.',
        email_capturado: 'lead@example.test',
      },
    }), 'registrar_resultado', deps);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_REQUEST' } });
  });

  it('rejects call_summary-only registrar_resultado as a partial extended analysis', async () => {
    const deps = toolDependencies();
    const response = await handleRetellToolRequest(signedRequest({
      name: 'registrar_resultado',
      call: {
        call_id: providerCallId,
        metadata: { internal_call_id: callId, contact_id: contactId, conversation_id: conversationId },
      },
      args: {
        resultado: 'link_enviado_sin_pago',
        call_summary: 'Resumen externo.',
      },
    }), 'registrar_resultado', deps);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_REQUEST' } });
  });

  it('gives webhook authority over the shared legacy analyzed identity without lexical ordering', () => {
    const base = mapRetellLifecycleEvent(completeWebhook({
      email_capturado: 'tool@example.test',
    }), callId);
    const legacy = { ...base, event_id: `retell:call_analyzed:${providerCallId}` };
    const webhook = { ...base, event_id: `retell:webhook:call_analyzed:${providerCallId}`, payload: {
      event_type: 'analyzed' as const,
      analysis: { ...(base.payload as Extract<typeof base.payload, { event_type: 'analyzed' }>).analysis, email_capturado: 'webhook@example.test' },
    } };
    expect(mergeCallAnalyses([legacy, webhook]).email_capturado).toBe('webhook@example.test');
  });
});
