import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RawBusinessContext, RawCatalogIndex } from '@/features/orchestration/domain/business-context';
import type { CallStore } from '@/features/calls/ports/call-store';
import type { RetellCallCorrelationStore } from '@/features/calls/ports/retell-call-correlation-store';
import {
  handleRetellToolRequest,
  RETELL_TOOL_MAX_BODY_BYTES,
  type RetellContactToolStore,
} from '@/features/calls/application/retell-tools';

const apiKey = 'retell-tool-api-key';
const toolsSecret = 'retell-tool-shared-secret';
const nowMs = 1_788_966_000_000;
const internalCallId = randomUUID();
const contactId = randomUUID();
const conversationId = randomUUID();
const providerCallId = 'call_retell_tool_fixture';

const paymentOptions = [
  { code: 'monthly_12', currency: 'USD', total_amount: '360.00', installments: 12, installment_amount: '30.00', payment_link: 'https://buy.stripe.com/test-12' },
  { code: 'monthly_6', currency: 'USD', total_amount: '360.00', installments: 6, installment_amount: '60.00', payment_link: 'https://buy.stripe.com/test-6' },
  { code: 'one_time', currency: 'USD', total_amount: '360.00', installments: 1, installment_amount: '360.00', payment_link: 'https://buy.stripe.com/test-once' },
] as const;

const offering = {
  code: 'reparacion_celulares',
  display_name: 'Reparación de Celulares',
  offering_type: 'course' as const,
  description: 'Diagnóstico y reparación de celulares.',
  value_proposition: 'Aprendizaje práctico.',
  price_type: 'fixed' as const,
  price_amount: '360.00',
  currency: 'USD',
  billing_interval: 'one_time' as const,
  delivery: {
    modality: 'online',
    certification: true,
    classes: 20,
    modules: 5,
    includes: ['Ejercicios', 'Exámenes'],
  },
  guardrails: {},
  audience: { language: 'Spanish' },
  metadata: {
    academy: 'Academia de Oficios',
    aliases: ['arreglo de celulares'],
  },
};

function rawContext(overrides: Partial<RawBusinessContext> = {}): RawBusinessContext {
  return {
    as_of: '2026-09-09T15:00:00.000Z',
    workspace: {
      id: randomUUID(),
      slug: 'studyx',
      display_name: 'Studyx',
      environment: 'sandbox',
      default_locale: 'es-AR',
      timezone: 'America/Argentina/Buenos_Aires',
      metadata: { payment_options: paymentOptions },
    },
    offerings: [offering],
    offerings_total: 1,
    qualification_fields: [],
    ...overrides,
  };
}

function rawIndex(): RawCatalogIndex {
  return {
    as_of: '2026-09-09T15:00:00.000Z',
    offerings_total: 1,
    offerings: [{
      code: offering.code,
      display_name: offering.display_name,
      metadata: offering.metadata,
    }],
  };
}

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
      transcript: 'must be discarded',
      recording_url: 'https://example.invalid/must-be-discarded',
    },
    args,
  };
}

function signature(rawBody: string, timestamp = nowMs) {
  const digest = createHmac('sha256', apiKey).update(rawBody + String(timestamp), 'utf8').digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function request(body: unknown, overrides: { secret?: string; signedBody?: string } = {}) {
  const rawBody = JSON.stringify(body);
  return new Request('http://localhost/retell/tools/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-retell-signature': signature(overrides.signedBody ?? rawBody),
      'x-studyx-tools-secret': overrides.secret ?? toolsSecret,
    },
    body: rawBody,
  });
}

function dependencies() {
  const calls = {
    claimDispatch: vi.fn(),
    attachProviderCall: vi.fn(),
    markDispatchAmbiguous: vi.fn(),
    markDispatchFailed: vi.fn(),
    appendEvent: vi.fn(async () => 'recorded' as const),
    recomputeProjection: vi.fn(async () => ({
      status: 'in_progress' as const,
      analysisStatus: 'completed' as const,
      result: 'no_interesado' as const,
    })),
    resolveRetellCall: vi.fn(async () => ({ callId: internalCallId })),
  } satisfies CallStore & RetellCallCorrelationStore;
  const business = {
    loadCompleteIndex: vi.fn(async () => rawIndex()),
    loadByCode: vi.fn(async () => rawContext()),
    loadBusinessContext: vi.fn(async () => rawContext()),
  };
  const contacts = {
    isCorrelatedToWorkspace: vi.fn(async () => true),
    saveCorrelatedContact: vi.fn(async () => ({ updated: true, projected: true })),
  } satisfies RetellContactToolStore;
  return {
    apiKey,
    toolsSecret,
    workspaceSlug: 'studyx',
    calls,
    business,
    contacts,
    sheets: { spreadsheetId: 'sheet-fixture', tabName: 'Leads' },
    now: () => new Date(nowMs),
  };
}

async function invoke(name: Parameters<typeof handleRetellToolRequest>[1], body: unknown, deps = dependencies()) {
  const response = await handleRetellToolRequest(request(body), name, deps);
  return { response, body: await response.json(), deps };
}

describe('Retell P0 tool boundary', () => {
  it('requires both the untouched Retell signature and the constant-time shared secret', async () => {
    const deps = dependencies();
    const body = envelope('consultar_curso', { curso: offering.display_name });
    const badSecret = await handleRetellToolRequest(
      request(body, { secret: 'wrong-secret' }),
      'consultar_curso',
      deps,
    );
    const changedBody = await handleRetellToolRequest(
      request(body, { signedBody: `${JSON.stringify(body)} ` }),
      'consultar_curso',
      deps,
    );

    expect(badSecret.status).toBe(401);
    expect(changedBody.status).toBe(401);
    expect(await badSecret.json()).toEqual({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
  });

  it('rejects the authenticated request before parsing once the total body exceeds the boundary', async () => {
    const deps = dependencies();
    const body = envelope('consultar_curso', { curso: offering.display_name });
    body.call.transcript = 'x'.repeat(RETELL_TOOL_MAX_BODY_BYTES);

    const response = await handleRetellToolRequest(
      request(body),
      'consultar_curso',
      deps,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(deps.calls.resolveRetellCall).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong_name', envelope('registrar_resultado', { curso: offering.display_name })],
    ['extra_envelope_key', { ...envelope('consultar_curso', { curso: offering.display_name }), extra: true }],
    ['extra_args_key', envelope('consultar_curso', { curso: offering.display_name, extra: true })],
    ['oversized_string', envelope('consultar_curso', { curso: 'x'.repeat(129) })],
  ])('fails closed for %s with the strict authenticated result envelope', async (_case, body) => {
    const result = await invoke('consultar_curso', body);
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ ok: false, error: { code: 'INVALID_TOOL_REQUEST' } });
  });

  it('resolves one canonical course by owner alias and returns only bounded canonical detail', async () => {
    const result = await invoke('consultar_curso', envelope('consultar_curso', {
      curso: 'arreglo de celulares',
      academia: 'Academia de Oficios',
    }));

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      curso: {
        codigo: 'reparacion_celulares',
        nombre: 'Reparación de Celulares',
        academia: 'Academia de Oficios',
        descripcion: 'Diagnóstico y reparación de celulares.',
        modalidad: 'online',
        clases: 20,
        modulos: 5,
        certificacion: true,
        incluye: ['Ejercicios', 'Exámenes'],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('must be discarded');
  });

  it('returns the coherent canonical price and owner-authored payment labels without a discount calculation', async () => {
    const result = await invoke('consultar_oferta', envelope('consultar_oferta', {
      cursos: ['reparacion_celulares'],
    }));

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      oferta: {
        moneda: 'USD',
        precio_lista: '360.00',
        precio_final: '360.00',
        cuotas_texto: '12 pagos mensuales de USD 30; 6 pagos mensuales de USD 60; Pago único de USD 360',
      },
    });
  });

  it.each([
    { cursos: ['reparacion_celulares', 'otro'] },
    { cursos: ['reparacion_celulares'], pais: 'Argentina' },
  ])('refuses unsupported combo/country pricing instead of calculating it', async (args) => {
    const result = await invoke('consultar_oferta', envelope('consultar_oferta', args));
    expect(result.body).toEqual({ ok: false, error: { code: 'OFFER_UNAVAILABLE' } });
  });

  it('requires at least one contact field', async () => {
    const result = await invoke(
      'guardar_datos_contacto',
      envelope('guardar_datos_contacto', {}),
    );
    expect(result.body).toEqual({ ok: false, error: { code: 'INVALID_TOOL_REQUEST' } });
  });

  it('maps nulo to canonical null and records the shared analyzed event without direct effects', async () => {
    const deps = dependencies();
    const result = await invoke('registrar_resultado', envelope('registrar_resultado', {
      resultado: 'venta_confirmada',
      resumen: 'La persona informó que completó la compra.',
      objeciones: ['precio', 'tiempo'],
      proximo_paso: 'Confirmar acceso al campus.',
      nivel_interes: 'nulo',
      curso: 'Reparación de Celulares',
    }), deps);

    expect(result.body).toEqual({ ok: true, recorded: true });
    expect(deps.calls.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_id: `retell:call_analyzed:${providerCallId}`,
      call_id: internalCallId,
      event_type: 'analyzed',
      payload: {
        event_type: 'analyzed',
        analysis: {
          result: 'venta_confirmada',
          nivel_interes: null,
          objecion: 'precio, tiempo',
          notas: 'La persona informó que completó la compra.\nPróximo paso: Confirmar acceso al campus.\nCurso: Reparación de Celulares',
        },
      },
    }));
  });
});
