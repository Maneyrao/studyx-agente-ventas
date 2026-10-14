import { describe, expect, it } from 'vitest';
import {
  canonicalTruthSetFromOfferingsV1,
  assertedCommercialPricesV1,
  enforceCommercialTruthV1,
  type CanonicalTruthSetV1,
} from '@/features/orchestration/domain/commercial-truth-guard';

/**
 * La frontera comercial verifica VALORES contra el registro canónico y veta
 * ORACIONES. No exige reproducir plantillas ni reemplaza el turno completo.
 *
 * Los dos grupos de tests son deliberados: el primero prueba que el modelo
 * recuperó la conversación; el segundo, que no se soltó ninguna de las
 * restricciones que sí protegen dinero, consentimiento y datos.
 */

const CANONICAL: CanonicalTruthSetV1 = {
  prices: ['USD 360', 'USD 30'],
  durations: ['38 clases'],
  modality: '100% online',
  certification: true,
};

const NO_CERTIFICATION: CanonicalTruthSetV1 = { ...CANONICAL, certification: false };
const UNKNOWN_CERTIFICATION: CanonicalTruthSetV1 = { ...CANONICAL, certification: null };

function enforce(content: string, canonical: CanonicalTruthSetV1 = CANONICAL, urls: string[] = []) {
  return enforceCommercialTruthV1({ content, authorized_urls: urls, canonical });
}

it.each(['USD 360,000', 'USD 360.000'])('does not erase ambiguous three-place money precision: %s', amount => {
  expect(enforce(`El total es ${amount}.`).violations).toContainEqual(expect.objectContaining({ code: 'PRICE_NOT_CANONICAL' }));
});

describe('plazo del pago separado de la duración del curso', () => {
  const canonical = canonicalTruthSetFromOfferingsV1({
    offerings: [{ code: 'redes', price_type: 'fixed', price_amount: '360', currency: 'USD', delivery: { classes: 16 } }],
    selected_offering_code: 'redes',
    payment_options: [{
      total: { currency: 'USD', amount: '360' }, installment_amount: '60',
      installments: 6, label: '6 pagos mensuales de USD 60',
    }],
  });

  it.each([
    'Cada cuota del plan que elegiste es de USD 60, durante 6 meses. El total es USD 360.',
    'Pagás USD 60 por mes durante 6 meses.',
    'El plan de pagos es de USD 60 durante 6 meses.',
  ])('conserva el plazo mensual autorizado y su importe: %s', (content) => {
    expect(enforce(content, canonical)).toMatchObject({ content, violations: [], removed: [] });
  });

  it.each([
    'Cada cuota es de USD 60 durante 9 meses.',
    'Pagás USD 60 por mes durante 6 semanas.',
    'El curso dura 6 meses y cada cuota es de USD 60.',
    'Cada cuota es de USD 60 y el curso dura 6 meses.',
    'Pagás USD 60 durante 6 meses y el curso dura 6 meses.',
  ])('no autoriza otro plazo ni convierte el plan en duración académica: %s', (content) => {
    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('DURATION_NOT_CANONICAL');
  });

  it('no autoriza un monto inventado por tener un plazo correcto', () => {
    expect(enforce('Cada cuota es de USD 99 durante 6 meses.', canonical).violations)
      .toContainEqual({ code: 'PRICE_NOT_CANONICAL', value: 'usd 99' });
  });
});

describe('canonical installment plans', () => {
  const canonical = canonicalTruthSetFromOfferingsV1({
    offerings: [{ code: 'redes', price_type: 'fixed', price_amount: '360', currency: 'USD', delivery: {} }],
    selected_offering_code: 'redes',
    payment_options: [
      { total: { currency: 'USD', amount: '360' }, installment_amount: '30', installments: 12, label: '12 pagos mensuales de USD 30' },
      { total: { currency: 'USD', amount: '360' }, installment_amount: '60', installments: 6, label: '6 pagos mensuales de USD 60' },
      { total: { currency: 'USD', amount: '360' }, installment_amount: '360', installments: 1, label: 'Un pago de USD 360' },
    ],
  });

  it.each([
    'Podés pagar en 2 cuotas de USD 60.',
    '¿Querés pagar en 2 cuotas de USD 60?',
    '¿Puedes pagar en dos cuotas de USD 180?',
    '¿Podemos hacer 2x60?',
    'No te preocupes, puedo darte 2 pagos de USD 60.',
    'No te preocupes y te damos 2 pagos de USD 60.',
    'Tenemos 12 pagos de USD 60.',
    'El plan es 2 x USD 60.',
    'El plan es 12x60.',
    'Se puede en 2 pagos.',
    'Podés pagarlo en dos cuotas.',
    'Tenemos 12 pagos de USD 30, 6 de USD 30 o un pago de USD 360.',
    'No tenemos 2 pagos, pero podemos ofrecer 3 cuotas de USD 60.',
  ])('rejects an asserted unsupported installment count or pair: %s', (content) => {
    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('PAYMENT_PLAN_NOT_CANONICAL');
  });

  it('preserves decimal commas when classifying price clauses', () => {
    const content = 'El importe es USD 0,50.';
    expect(enforce(content, { ...CANONICAL, prices: ['USD 0.50'] }))
      .toMatchObject({ content, violations: [], removed: [] });
  });

  it('shares asserted prices without treating denied plans or clarification as offers', () => {
    expect(assertedCommercialPricesV1(
      'No tenemos 2 cuotas de USD 180. ¿Buscabas 2 pagos de USD 180? Tenemos 6 pagos de USD 60.',
    )).toEqual(['usd 60']);
    expect(assertedCommercialPricesV1('¿Puedes pagar en dos cuotas de USD 180?')).toEqual(['usd 180']);
  });

  it('ends a payment denial at a following positive predicate', () => {
    expect(enforce('No tenemos dos pagos de USD 180 y puedes pagar USD 999.', canonical).violations)
      .toContainEqual({ code: 'PRICE_NOT_CANONICAL', value: 'usd 999' });
  });

  it('does not let an unrelated negation authorize an unsupported price', () => {
    expect(enforce('El precio no cambia: USD 999.', canonical).violations)
      .toContainEqual({ code: 'PRICE_NOT_CANONICAL', value: 'usd 999' });
  });

  it.each([
    'Podés pagar en 12 cuotas de USD 30 o 6 pagos de USD 60.',
    'Tenemos 12 pagos mensuales de USD 30, 6 de USD 60 o un pago de USD 360.',
    'El plan es 12 x USD 30.',
    'El plan es 6x60.',
    'Podés hacerlo en seis pagos de USD 60.',
    'El total es USD 360; podés elegir 12 pagos de USD 30 o 6 pagos de USD 60.',
    'No tenemos 2 cuotas de USD 180. Podés pagar en 12 cuotas de USD 30.',
    'No se puede en 2 pagos; tenemos 6 pagos de USD 60.',
    'Dos pagos de USD 180 no están disponibles; puedes pagar en 12 de USD 30.',
    '¿Buscabas 2 cuotas de USD 180? Tenemos 6 pagos de USD 60.',
    '¿En cuántos pagos te gustaría hacerlo?',
  ])('preserves canonical alternatives, denied plans and customer questions: %s', (content) => {
    expect(enforce(content, canonical)).toMatchObject({ content, removed: [], violations: [] });
  });
});

describe('lenguaje natural liberado', () => {
  it('quita una posible oferta no canónica y conserva la pregunta útil', () => {
    const content = 'También tenemos Idiomas para ayudarte a empezar desde cero. ¿Qué te gustaría aprender?';
    const canonical = { ...CANONICAL, offering_names: ['Inglés 1', 'Inglés 2', 'Inglés 3'] };

    const verdict = enforce(content, canonical);

    expect(verdict.content).toBe('¿Qué te gustaría aprender?');
    expect(verdict.removed).toEqual(['También tenemos Idiomas para ayudarte a empezar desde cero.']);
    expect(verdict.violations.map((violation) => violation.code))
      .toContain('OFFERING_NOT_CANONICAL');
  });

  it.each([
    'Tenemos 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago de USD 360.',
    'Contamos con chat directo con profesores.',
    'Te recomiendo seguir por chat.',
    'Ofrecemos una llamada breve para resolver tus consultas.',
    'Tenemos acceso a las clases online.',
  ])('no confunde servicios, planes ni recomendaciones con nombres de cursos: %s', (content) => {
    const canonical = { ...CANONICAL, prices: ['USD 30', 'USD 60', 'USD 360'] };
    expect(enforce(content, canonical).content).toBe(content);
  });

  it('entrega intacta una respuesta natural que menciona modalidad y certificación reales', () => {
    const content = '¡Hola! Es 100% online, así que lo hacés a tu ritmo. '
      + 'Además te llevás un certificado al terminar. ¿Querés que te cuente el temario?';

    const verdict = enforce(content);

    expect(verdict.content).toBe(content);
    expect(verdict.removed).toEqual([]);
  });

  it('acepta una duración canónica parafraseada en vez de la plantilla del renderer', () => {
    const verdict = enforce('Son 38 clases en total, bastante llevadero.');

    expect(verdict.content).toBe('Son 38 clases en total, bastante llevadero.');
    expect(verdict.removed).toEqual([]);
  });

  it('acepta un precio canónico escrito con palabras propias', () => {
    const verdict = enforce('Te sale USD 360 en total, o lo hacés en cuotas de USD 30.');

    expect(verdict.removed).toEqual([]);
  });

  it('no toca prosa comercial sin ningún valor verificable', () => {
    const content = 'Tenemos varias opciones y te acompaño a elegir. ¿Qué área te interesa?';

    expect(enforce(content).content).toBe(content);
  });

  it('conserva una lista canónica con un descriptor colectivo de área', () => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [
        {
          code: 'armado-pc', display_name: 'Armado y Reparación de PC',
          price_type: 'fixed', price_amount: '360', currency: 'USD',
          delivery: {}, metadata: { academy: 'Academia de Oficios' },
        },
        {
          code: 'celulares', display_name: 'Reparación de Celulares',
          price_type: 'fixed', price_amount: '360', currency: 'USD',
          delivery: {}, metadata: { academy: 'Academia de Oficios' },
        },
        {
          code: 'redes', display_name: 'Redes Informáticas',
          price_type: 'fixed', price_amount: '360', currency: 'USD',
          delivery: {}, metadata: { academy: 'Academia de Oficios' },
        },
      ],
      selected_offering_code: null,
    });
    const content = 'Contamos con Armado y Reparación de PC, Reparación de Celulares y Redes Informáticas, todas dentro de la Academia de Oficios.';

    expect(enforce(content, canonical)).toMatchObject({
      content,
      removed: [],
      violations: [],
    });
  });

  it('veta logística académica que no figura en la oferta seleccionada', () => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [{
        code: 'excel', display_name: 'Excel Integral',
        price_type: 'fixed', price_amount: '360', currency: 'USD',
        description: '17 clases de fórmulas, funciones y gráficos.',
        delivery: { classes: 17, modality: 'online' },
      }],
      selected_offering_code: 'excel',
    });
    const content = 'Excel Integral son 17 clases 100% online, y avanzás a tu ritmo: la plataforma queda disponible 24/7 por varios meses, así que no hay presión de terminar en una fecha fija.';

    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('LOGISTICS_NOT_CANONICAL');
  });

  it.each([
    'La clase en vivo es semanal y queda grabada.',
    'Tenés clases en vivo que quedan grabadas y acceso a la plataforma cuando quieras.',
  ])('veta modalidad sincrónica, grabaciones o acceso libre no documentados: %s', (content) => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [{
        code: 'solar', display_name: 'Energía Solar Fotovoltaica',
        price_type: 'fixed', price_amount: '360', currency: 'USD',
        description: 'Cuenta con 8 clases sobre módulos fotovoltaicos.',
        delivery: { classes: 8, modality: 'online' },
      }],
      selected_offering_code: 'solar',
    });

    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('LOGISTICS_NOT_CANONICAL');
  });


  it('conserva el salto de párrafo que separa los mensajes del modelo', () => {
    // `processInboundTurn` une `response.messages` con `\n\n`. Colapsarlo a un
    // espacio fusiona dos mensajes en un bloque.
    const content = '¡Hola! Tenemos varias opciones para vos.\n\n¿Qué área te interesa?';

    expect(enforce(content).content).toBe(content);
  });

  it('conserva el salto entre los párrafos seguros', () => {
    const content = 'Es 100% online.\n\nTe sale USD 999.\n\n¿Arrancamos?';
    const verdict = enforce(content);

    expect(verdict.content).toBe('Es 100% online.\n\n¿Arrancamos?');
    expect(verdict.violations.map((violation) => violation.code)).toContain('PRICE_NOT_CANONICAL');
  });

  it('deja hablar de certificación cuando el registro canónico no la especifica', () => {
    const content = 'Sobre el certificado no tengo el dato confirmado, lo verifico y te aviso.';

    expect(enforce(content, UNKNOWN_CERTIFICATION).content).toBe(content);
  });
});

describe('restricciones comerciales firmes', () => {
  it.each([
    'StudyX ofrece una beca garantizada.',
    'Te damos un descuento especial para anotarte.',
    'Tenés una beca disponible para este curso.',
  ])('veta beneficios comerciales no autorizados y conserva la pregunta: %s', (claim) => {
    const content = `${claim} ¿Qué te gustaría aprender?`;
    const verdict = enforce(content);

    expect(verdict.content).toBe('¿Qué te gustaría aprender?');
    expect(verdict.removed).toContain(claim);
    expect(verdict.violations.map((violation) => violation.code)).toContain('FORBIDDEN_PROMISE');
  });

  it('conserva la negación explícita de becas y descuentos', () => {
    const content = 'No ofrecemos becas ni descuentos. El total es USD 360.';
    expect(enforce(content).content).toBe(content);
  });

  it.each([
    'No tenemos descuentos, pero te damos una beca.',
    'No ofrecemos becas y te damos un descuento.',
  ])('no extiende la negación a una oferta afirmativa posterior: %s', (content) => {
    const verdict = enforce(content);
    expect(verdict.content).toBeNull();
    expect(verdict.violations.map((violation) => violation.code)).toContain('FORBIDDEN_PROMISE');
  });

  it('veta sólo la oración con un precio no canónico', () => {
    const content = 'Es 100% online. Te sale USD 999. ¿Arrancamos?';
    const verdict = enforce(content);

    expect(verdict.content).toBe('Es 100% online. ¿Arrancamos?');
    expect(verdict.removed).toEqual(['Te sale USD 999.']);
    expect(verdict.violations.map((violation) => violation.code)).toContain('PRICE_NOT_CANONICAL');
  });

  it('veta una duración que no existe', () => {
    const content = 'Dura 3 meses. Es 100% online.';
    const verdict = enforce(content);

    expect(verdict.content).toBe('Es 100% online.');
    expect(verdict.violations.map((violation) => violation.code)).toContain('DURATION_NOT_CANONICAL');
  });

  it('veta una modalidad contradictoria', () => {
    const content = 'Las clases son presenciales en nuestra sede. Te espero.';
    const verdict = enforce(content);

    expect(verdict.content).toBe('Te espero.');
    expect(verdict.violations.map((violation) => violation.code)).toContain('MODALITY_CONTRADICTS_CANONICAL');
  });

  it('veta una afirmación de certificado contradictoria', () => {
    const content = 'El curso entrega certificado oficial. Es 100% online.';
    const verdict = enforce(content, NO_CERTIFICATION);

    expect(verdict.content).toBe('Es 100% online.');
    expect(verdict.violations.map((violation) => violation.code)).toContain('CERTIFICATION_CONTRADICTS_CANONICAL');
  });

  it('veta una promesa de empleo', () => {
    const content = 'Es 100% online. Te aseguramos empleo al terminar.';
    const verdict = enforce(content);

    expect(verdict.content).toBe('Es 100% online.');
    expect(verdict.violations.map((violation) => violation.code)).toContain('FORBIDDEN_PROMISE');
  });

  it('falla cerrado ante una URL no autorizada, sin entregar nada', () => {
    const verdict = enforce('Es 100% online. Entrá a https://studyx.fake/pagar y listo.');

    expect(verdict.content).toBeNull();
    expect(verdict.violations.map((violation) => violation.code)).toContain('UNAUTHORIZED_URL');
  });

  it('entrega la URL canónica cuando está autorizada', () => {
    const content = 'Te dejo el link: https://buy.stripe.com/canonical';

    const verdict = enforce(content, CANONICAL, ['https://buy.stripe.com/canonical']);

    expect(verdict.content).toBe(content);
  });

  it('devuelve null cuando ninguna oración segura sobrevive', () => {
    const content = 'Te sale USD 999. Te aseguramos empleo.';
    const verdict = enforce(content);

    expect(verdict.content).toBeNull();
    expect(verdict.removed).toHaveLength(2);
    expect(verdict.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(['PRICE_NOT_CANONICAL', 'FORBIDDEN_PROMISE']),
    );
  });
});

/**
 * El registro canónico que alimenta al guard sale de las ofertas activas. Se
 * arma acá, puro y testeable, en vez de dentro del servicio de decisión: era
 * justamente esa mezcla la que dejaba la frontera sin cobertura unitaria.
 */
describe('registro canónico desde el catálogo', () => {
  const PYTHON = {
    code: 'prog-python',
    display_name: 'Programación en Python',
    price_type: 'fixed' as const,
    price_amount: '360.00',
    currency: 'USD',
    delivery: { classes: 38, modality: '100% online', certification: true },
  };
  const MARKETING = {
    code: 'mkt-digital',
    display_name: 'Marketing Digital',
    price_type: 'fixed' as const,
    price_amount: '480.00',
    currency: 'USD',
    delivery: { modules: 12, modality: 'presencial', certification: false },
  };
  const PC = {
    ...PYTHON,
    code: 'armado-pc',
    display_name: 'Armado y Reparación de PC',
    metadata: { academy: 'Academia de Oficios' },
  };

  it.each([
    'En tecnología contamos con el curso de Armado y Reparación de PC, dentro de nuestra Academia de Oficios.',
    'Ofrecemos Armado y Reparación de PC, parte de la Academia de Oficios.',
    'Podés estudiar Armado y Reparación de PC, perteneciente a nuestra Academia de Oficios.',
    'Tenemos Armado y Reparación de PC, que forma parte de la Academia de Oficios.',
    'Tenemos Armado y Reparación de PC, dentro de la Academia de Oficios, y Programación en Python.',
  ])('conserva un área canónica como descriptor del curso: %s', (content) => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [PC, PYTHON], selected_offering_code: null,
    });

    const verdict = enforce(content, canonical);

    expect(verdict.content).toBe(content);
    expect(verdict.violations).toEqual([]);
  });

  it.each([
    'Tenemos Armado y Reparación de PC y Mecánica Automotriz, dentro de la Academia de Oficios.',
    'Tenemos Armado y Reparación de PC, dentro de la Academia de Oficios, y Mecánica Automotriz.',
    'Tenemos Armado y Reparación de PC, perteneciente a la Academia de Oficios, Mecánica Automotriz.',
    'Tenemos Armado y Reparación de PC, dentro de la Academia de Mecánica.',
    'Tenemos Armado y Reparación de PC, dentro de la Academia de Oficios Avanzados.',
  ])('no usa el descriptor de área para autorizar otro nombre inexistente: %s', (content) => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [PC, PYTHON], selected_offering_code: null,
    });

    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('OFFERING_NOT_CANONICAL');
    expect(enforce(content, canonical).content).toBeNull();
  });

  it('sigue vetando un monto inventado junto al área canónica', () => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [PC], selected_offering_code: null,
    });
    const verdict = enforce(
      'Tenemos Armado y Reparación de PC, dentro de la Academia de Oficios, por USD 999.',
      canonical,
    );

    expect(verdict.content).toBeNull();
    expect(verdict.violations.map((violation) => violation.code)).toContain('PRICE_NOT_CANONICAL');
  });

  it('no usa el catálogo como sustituto de una selección inexistente', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING],
      selected_offering_code: 'missing-course',
    });

    expect(set.prices).toEqual([]);
    expect(set.durations).toEqual([]);
    expect(enforce('El precio es USD 360.', set).content).toBeNull();
    expect(enforce('El precio es USD 360.', set).violations.map((violation) => violation.code))
      .toContain('PRICE_NOT_CANONICAL');
  });

  it.each([
    ['otra oferta con un total distinto', 'mkt-digital'],
    ['una oferta inexistente', 'missing-course'],
  ])('no usa planes globales como precio de %s', (_case, selectedOfferingCode) => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING],
      selected_offering_code: selectedOfferingCode,
      payment_options: [{
        total: { currency: 'USD', amount: '360' },
        installment_amount: '60',
        installments: 6,
        label: '6 pagos mensuales de USD 60',
      }],
    });

    expect(set.prices).not.toContain('USD 360');
    expect(set.prices).not.toContain('USD 60');
    expect(set.payment_terms).toEqual([]);
    expect(enforce('El precio es USD 360.', set).content).toBeNull();
    expect(enforce('El precio es USD 360.', set).violations.map((violation) => violation.code))
      .toContain('PRICE_NOT_CANONICAL');
  });

  it.each([
    'Sí, ofrecemos Mecánica Automotriz.',
    'Podés estudiar Mecánica Automotriz.',
    'Tenemos Programación en Python y Mecánica Automotriz.',
  ])('rechaza cursos ajenos al catálogo aunque suenen plausibles: %s', (content) => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING], selected_offering_code: null,
    });

    expect(enforce(content, canonical).content).toBeNull();
    expect(enforce(content, canonical).violations.map((violation) => violation.code))
      .toContain('OFFERING_NOT_CANONICAL');
  });

  it.each([
    'Tenemos Programación en Python y Marketing Digital.',
    'Podés estudiar Programación en Python, que tiene 38 clases.',
    'Ofrecemos Programación en Python para empezar a programar.',
    'Tenemos varias opciones y te acompaño a elegir.',
  ])('preserva nombres canónicos dentro de lenguaje natural: %s', (content) => {
    const canonical = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING], selected_offering_code: null,
    });

    expect(enforce(content, canonical).content).toBe(content);
  });

  it('se limita a la oferta seleccionada cuando hay una', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING],
      selected_offering_code: 'prog-python',
    });

    expect(set.prices).toContain('USD 360');
    expect(set.prices).not.toContain('USD 480');
    expect(set.durations).toContain('38 clases');
    expect(set.modality).toBe('100% online');
    expect(set.certification).toBe(true);
  });

  it('sin oferta seleccionada admite los valores de todo el catálogo', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING],
      selected_offering_code: null,
    });

    expect(set.prices).toEqual(expect.arrayContaining(['USD 360', 'USD 480']));
    expect(set.durations).toEqual(expect.arrayContaining(['38 clases', '12 módulos']));
  });

  it('no fija modalidad ni certificación cuando el catálogo mezcla ambas', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON, MARKETING],
      selected_offering_code: null,
    });

    expect(set.modality).toBeNull();
    expect(set.certification).toBeNull();
  });

  it('ignora el precio de una oferta a cotizar', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [{ ...PYTHON, price_type: 'quote', price_amount: null }],
      selected_offering_code: 'prog-python',
    });

    expect(set.prices).toEqual([]);
  });

  it('suma los importes de los planes de pago del workspace', () => {
    const set = canonicalTruthSetFromOfferingsV1({
      offerings: [PYTHON],
      selected_offering_code: 'prog-python',
      payment_options: [
        { total: { currency: 'USD', amount: '360.00' }, installment_amount: '30.00' },
      ],
    });

    expect(set.prices).toEqual(expect.arrayContaining(['USD 360', 'USD 30']));
  });
});
