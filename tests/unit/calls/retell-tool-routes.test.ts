import { describe, expect, it } from 'vitest';
import * as courseRoute from '@/app/retell/tools/consultar-curso/route';
import * as offerRoute from '@/app/retell/tools/consultar-oferta/route';
import * as contactRoute from '@/app/retell/tools/guardar-datos-contacto/route';
import * as resultRoute from '@/app/retell/tools/registrar-resultado/route';
import * as paymentLinkRoute from '@/app/retell/tools/enviar-link-pago/route';
import * as verifyPaymentRoute from '@/app/retell/tools/verificar-pago/route';
import * as materialRoute from '@/app/retell/tools/enviar-material/route';
import * as humanRoute from '@/app/retell/tools/derivar-humano/route';
import * as followupRoute from '@/app/retell/tools/agendar-seguimiento/route';

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
