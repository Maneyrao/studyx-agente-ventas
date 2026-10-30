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
  ['Te llevás también Community Manager.', false],
  ['Si te sumo Fotografía con Celulares para Tiendas Online como curso bonificado, sin cambiar el precio, ¿avanzarías hoy?', true],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, ¿te sirve así?', true],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, ¿avanzamos?', true],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, ¿preferís 12 cuotas o 6?', true],
  ['Te sumo Excel como curso bonificado, además Inglés gratis.', false],
  ['Te sumo Excel como curso bonificado, e Inglés también gratis.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, además Inglés gratis.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio y con Inglés bonificado.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, con Inglés incluido.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio y un curso adicional incluido.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, además te sumo Inglés.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, te sumo Inglés.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio y un curso adicional.', false],
  ['Te sumo Excel como curso bonificado, sin cambiar el precio, con Inglés también.', false],
  ['Te sumo Fotografía con Celulares para Tiendas Online sin costo extra, para que puedas resolver fotos de producto.', true],
  ['Te sumo Fotografía con Celulares para Tiendas Online sin costo extra: te sirve para producir imágenes para tiendas.', true],
  ['Puedo sumarte Fotografía con Celulares para Tiendas Online sin costo extra, para complementar el curso principal.', true],
  ['A Fotografía Profesional te sumo Fotografía con Celulares para Tiendas Online, sin costo extra: te sirve para cubrir también las fotos rápidas que piden las tiendas.', true],
  ['Junto con Fotografía Profesional te incluyo Fotografía con Celulares para Tiendas Online, sin costo extra: te sirve para producir imágenes de producto.', true],
  ['Ya te sumé Fotografía con Celulares para Tiendas Online sin costo extra, y eso sigue en pie: podés usarlo para fotos de producto.', true],
  ['Te sumo Fotografía con Celulares para Tiendas Online sin costo extra, para que puedas resolver fotos, y además Inglés gratis.', false],
  ['A Fotografía Profesional te sumo Fotografía con Celulares para Tiendas Online, sin costo extra, y además Inglés gratis.', false],
  ['Te sumo Fotografía con Celulares para Tiendas Online sin costo extra: te sirve para producir imágenes, y te regalo Astrología.', false],
])('consumes bounded gift scope and preserves ordinary clauses: %s', (content, allowed) => {
  expect(inspectCourseBonusClaimsV1({content:content as string,
    authorized_bonus_names:['Inglés 1','Excel','Fotografía con Celulares para Tiendas Online'],
    known_offering_names:['Inglés 1','Excel','Fotografía con Celulares para Tiendas Online',
      'Community Manager','Redes'],paid_offering_names:['Redes']}).has_unauthorized_claim).toBe(!allowed);
});

it('does not treat an ordinary non-course benefit as a course bonus', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también el certificado de Studyx.',
    authorized_bonus_names: [],
    known_offering_names: ['Community Manager', 'Marketing Digital'],
  })).toEqual({ has_authorized_claim: false, has_unauthorized_claim: false });
});

it('rejects a known bonus course followed by a natural explanation', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también Community Manager para gestionar tus redes.',
    authorized_bonus_names: [],
    known_offering_names: ['Community Manager', 'Marketing Digital'],
  })).toEqual({ has_authorized_claim: false, has_unauthorized_claim: true });
});

it('does not let an authorized earlier clause hide a second unauthorized course', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te sumo Marketing Digital gratis. Te llevás también Inglés gratis.',
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Inglés'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: true });
});

it.each([
  'Te llevás también Marketing Digital y Community Manager.',
  'Te llevás también Marketing Digital gratis y Community Manager.',
  'Te llevás también Marketing Digital para tus redes y te llevás también Community Manager.',
])('checks the complete asserted bonus scope instead of only its first course: %s', (content) => {
  expect(inspectCourseBonusClaimsV1({
    content,
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toMatchObject({ has_unauthorized_claim: true });
});

it('accepts the same multi-course phrase when every asserted course is already authorized', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también Marketing Digital y Community Manager.',
    authorized_bonus_names: ['Marketing Digital', 'Community Manager'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: false });
});

it('reinspects an explanatory tail that contains another gifted course', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también Marketing Digital para tus redes, con Community Manager gratis.',
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: true });
});

it.each([
  'Te llevás también Marketing Digital sin costo extra.',
  'Te llevás también Marketing Digital sin cargo adicional.',
  'Te llevás también Marketing Digital, avanzamos?',
  'Te llevás también Marketing Digital sin costo extra, preferís 12 cuotas o 6?',
])('accepts a complete ordinary gift descriptor for an authorized course: %s', (content) => {
  expect(inspectCourseBonusClaimsV1({
    content,
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: false });
});

it('rejects an explicit parallel course addition even without a gift adjective', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también Marketing Digital para tus redes, con Community Manager también.',
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: true });
});

it.each([
  'Te llevás también Marketing Digital gratis, y además Community Manager gratis.',
  'Te llevás también Marketing Digital y Astrología gratis.',
])('does not let an unresolved explicit gift tail bypass authorization: %s', (content) => {
  expect(inspectCourseBonusClaimsV1({
    content,
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toMatchObject({ has_unauthorized_claim: true });
});

it('accepts an explicitly parallel course when both identities are authorized', () => {
  expect(inspectCourseBonusClaimsV1({
    content: 'Te llevás también Marketing Digital gratis, y además Community Manager gratis.',
    authorized_bonus_names: ['Marketing Digital', 'Community Manager'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: false });
});

it.each([
  'Te llevás también Marketing Digital para sumar clientes.',
  'Te llevás también Marketing Digital para agregar valor a tu negocio.',
])('keeps ordinary value explanations outside the effect validator: %s', (content) => {
  expect(inspectCourseBonusClaimsV1({
    content,
    authorized_bonus_names: ['Marketing Digital'],
    known_offering_names: ['Marketing Digital', 'Community Manager'],
  })).toEqual({ has_authorized_claim: true, has_unauthorized_claim: false });
});
