import { describe, expect, it } from 'vitest';
import * as courseRoute from '@/app/retell/tools/consultar-curso/route';
import * as offerRoute from '@/app/retell/tools/consultar-oferta/route';
import * as contactRoute from '@/app/retell/tools/guardar-datos-contacto/route';
import * as resultRoute from '@/app/retell/tools/registrar-resultado/route';

describe('Retell P0 route structure', () => {
  it.each([
    ['consultar-curso', courseRoute],
    ['consultar-oferta', offerRoute],
    ['guardar-datos-contacto', contactRoute],
    ['registrar-resultado', resultRoute],
  ])('%s exports only supported App Router symbols', (_name, route) => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'runtime']);
  });
});
