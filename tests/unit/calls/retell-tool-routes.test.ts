import { afterEach, describe, expect, it, vi } from 'vitest';
import * as courseRoute from '@/app/retell/tools/consultar-curso/route';
import * as offerRoute from '@/app/retell/tools/consultar-oferta/route';
import * as contactRoute from '@/app/retell/tools/guardar-datos-contacto/route';
import * as resultRoute from '@/app/retell/tools/registrar-resultado/route';
import * as paymentLinkRoute from '@/app/retell/tools/enviar-link-pago/route';
import * as verifyPaymentRoute from '@/app/retell/tools/verificar-pago/route';
import * as materialRoute from '@/app/retell/tools/enviar-material/route';
import * as humanRoute from '@/app/retell/tools/derivar-humano/route';
import * as followupRoute from '@/app/retell/tools/agendar-seguimiento/route';
import { handleRetellToolRoute } from '@/app/retell/tools/route-handler';

afterEach(() => vi.unstubAllEnvs());

describe('Retell P0 route structure', () => {
  it.each([
    ['consultar-curso', courseRoute],
    ['consultar-oferta', offerRoute],
    ['guardar-datos-contacto', contactRoute],
    ['registrar-resultado', resultRoute],
    ['enviar-link-pago', paymentLinkRoute],
    ['verificar-pago', verifyPaymentRoute],
    ['enviar-material', materialRoute],
    ['derivar-humano', humanRoute],
    ['agendar-seguimiento', followupRoute],
  ])('%s exports only supported App Router symbols', (_name, route) => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'runtime']);
  });
});

describe('Retell tool route authentication', () => {
  it('returns 401 for an incorrect x-studyx-tools-secret before loading dependencies', async () => {
    vi.stubEnv('RETELL_TOOLS_SECRET', 'route-test-secret');
    vi.stubEnv('VOICE_PROVIDER', 'xendra');
    const response = await handleRetellToolRoute(new Request('http://localhost/retell/tools/consultar-curso', {
      method: 'POST',
      headers: { 'x-studyx-tools-secret': 'wrong-secret' },
      body: '{}',
    }), 'consultar_curso');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('returns an enunciable HTTP 200 error after Xendra shared-secret authentication', async () => {
    vi.stubEnv('RETELL_TOOLS_SECRET', 'route-test-secret');
    vi.stubEnv('VOICE_PROVIDER', 'xendra');
    vi.stubEnv('BUSINESS_WORKSPACE_SLUG', '');
    vi.stubEnv('RETELL_API_KEY', '');
    const response = await handleRetellToolRoute(new Request('http://localhost/retell/tools/consultar-curso', {
      method: 'POST',
      headers: { 'x-studyx-tools-secret': 'route-test-secret' },
      body: '{}',
    }), 'consultar_curso');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      motivo: 'La herramienta no está configurada en este momento.',
      error: { code: 'TOOL_MISCONFIGURED' },
    });
  });
});
