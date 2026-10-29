import { expect, it } from 'vitest';
import { inspectCourseBonusClaimsV1 } from '@/shared/conversation/course-bonus-claim';

it.each([
  ['Te regalo Inglés 1 y Excel.', true],
  ['Te regalo Inglés 1 y Astrología.', false],
  ['Te regalo Astrología e Inglés 1.', false],
  ['Te regalo Inglés 1, Excel y Astrología.', false],
  ['No te regalo Inglés 1, pero te regalo Redes.', false],
  ['No te regalo Redes. Inglés 1 sirve para tu objetivo.', true],
  ['No hacemos regalos.', true],
  ['No tengo regalos disponibles.', true],
  ['No tengo problema en regalarte Redes.', false],
  ['No tenemos problema en regalarte Redes.', false],
  ['No hay problema en regalarte Redes.', false],
  ['No tengo problema en regalarte Inglés 1.', true],
  ['Te regalo Inglés 1 para complementar tu formación.', true],
  ['Te regalo Inglés 1, que te sirve para practicar.', true],
  ['Te regalo Inglés 1 y Astrología para complementar tu formación.', false],
  ['Te regalo Inglés 1 y Astrología, que te sirven para practicar.', false],
  ['Te regalo Inglés 1 para regalarte Redes.', false],
  ['Redes no es gratis.', true],
  ['No te puedo regalar Redes.', true],
  ['Inglés 1 no está de regalo, pero te regalo Redes.', false],
  ['Te regalo Inglés 1 al comprar Redes.', true],
  ['Redes incluye Inglés 1 de regalo.', true],
  ['El paquete incluye Inglés 1 de regalo.', true],
  ['El curso de Astrología incluye Inglés 1 de regalo.', false],
  ['Te regalo Inglés 1 al comprar Astrología.', false],
  ['Te regalo Redes e Inglés 1.', false],
  ['Te regalo Inglés 1\nEl total es USD 360.', true],
  ['Redes incluye prácticas y un proyecto final.', true],
  ['Puedo incluir otro curso incluido.', false],
])('consumes bounded gift scope and preserves ordinary clauses: %s', (content, allowed) => {
  expect(inspectCourseBonusClaimsV1({content:content as string,
    authorized_bonus_names:['Inglés 1','Excel'],paid_offering_names:['Redes']}).has_unauthorized_claim).toBe(!allowed);
});
