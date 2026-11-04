import { describe, expect, it } from 'vitest'
import { hardClaimKindsInTextV1, hardClaimsInTextV1 } from '@/shared/conversation/hard-claims'

const kinds = (text: string) => hardClaimKindsInTextV1(text)

describe('hard factual claim detectors', () => {
  it.each([
    ['Recibís un título oficial al terminar.', 'official_title'],
    ['El diplomado es un título universitario.', 'official_title'],
    ['Está avalado por el gobierno de Estados Unidos.', 'official_title'],
    ['Te garantizamos trabajo al finalizar.', 'guaranteed_employment'],
    ['Tenés salida laboral asegurada.', 'guaranteed_employment'],
    ['Podés ganar USD 2000 por mes.', 'income_promise'],
    ['Con esto tus ingresos son de 3 mil dólares.', 'income_promise'],
    ['El diplomado de electricidad reemplaza la licencia.', 'license_claim'],
    ['En plomería el certificado te habilita a ejercer en EEUU.', 'license_claim'],
    ['Para masoterapia no necesitás licencia.', 'license_claim'],
    ['Quedan 5 cupos para esta semana.', 'invented_scarcity'],
    ['Te hago un descuento del 20%.', 'invented_discount'],
    ['La oferta vence el viernes.', 'invented_deadline'],
    ['El precio normal es USD 699.', 'forbidden_price'],
    ['Tenemos una Beca Studyx para vos.', 'scholarship'],
  ])('flags %s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })

  it.each([
    'Recibís un certificado de Studyx al terminar.',
    'No es un título oficial, es un certificado de Studyx.',
    'No garantizamos trabajo ni ingresos determinados.',
    'El diplomado de electricidad da la base, no reemplaza la licencia.',
    'Necesitás la licencia estatal para ejercer; el diplomado no la reemplaza.',
    'Son 12 cuotas de USD 30, 6 de USD 60 o un pago de USD 360.',
    'No tenemos descuentos, el valor es USD 360.',
    'Las clases son online y podés verlas cuando quieras.',
    'Rebeca, te cuento cómo funciona.',
    'Podés generar ingresos extra con lo que aprendas.',
    'Te llamo hasta el lunes si querés.',
  ])('passes %s', (text) => {
    expect(kinds(text)).toEqual([])
  })

  it('returns the offending sentence only', () => {
    const claims = hardClaimsInTextV1('Es online. Recibís un título oficial. Cuesta USD 360.')
    expect(claims).toEqual([{ kind: 'official_title', sentence: 'Recibís un título oficial.' }])
  })
})

describe('invented testimonials (only the manual\'s real stories may be told)', () => {
  it.each([
    'Tenemos egresadas que hoy viven de esto.',
    'Hay alumnas que ya cobran por sus servicios de uñas.',
    'Tenemos egresadas que hoy cobran por sus servicios de belleza, algunas desde casa.',
    'Muchas alumnas empezaron de cero y hoy trabajan por su cuenta.',
    'Nuestros egresados ya trabajan en agencias.',
  ])('flags %s', (sentence) => {
    expect(kinds(sentence)).toContain('invented_testimonial')
  })
  it.each([
    'No tengo un caso puntual de ese rubro, pero puedo contarte el de otro.',
    'No tenemos alumnas que te puedan contar su experiencia todavía.',
    'Felipe Serrano, de Oficios, creó su empresa y hoy tiene un equipo; tenemos alumnos que lo siguen.',
    'Cristian y Ana María abrieron su negocio gastronómico con los diplomados.',
    'Amparo y Edson consiguieron empleo como diseñadores gráficos.',
    'Los alumnos acceden al Campus Virtual.',
  ])('passes %s', (sentence) => {
    expect(kinds(sentence)).not.toContain('invented_testimonial')
  })
  it('removes only the offending sentence', () => {
    expect(hardClaimsInTextV1('Es un buen curso. Tenemos egresadas que hoy viven de esto. Son 25 clases.'))
      .toEqual([{ kind: 'invented_testimonial', sentence: 'Tenemos egresadas que hoy viven de esto.' }])
  })
})

describe('hard claims ignore URLs and honor a real expiry', () => {
  it('does not read 699 or beca inside a URL', () => {
    expect(kinds('Link: https://buy.stripe.com/test_699aBecaX9')).toEqual([]);
    expect(kinds('Costaba 699. https://buy.stripe.com/x')).toContain('forbidden_price');
  });
  it('passes tiempo limitado and the exact date only with the authorized expiry', () => {
    const expiry = { promoExpiresAt: '2026-11-15T12:00:00.000Z' };
    expect(hardClaimKindsInTextV1('Es por tiempo limitado, vence el 15 de noviembre.', expiry)).toEqual([]);
    expect(kinds('Es por tiempo limitado, vence el 15 de noviembre.')).toContain('invented_deadline');
    expect(hardClaimKindsInTextV1('Vence el 16 de noviembre.', expiry)).toContain('invented_deadline');
  });
});

describe('Real Estate is a licensed trade (US state license)', () => {
  it.each([
    'Con el curso de Real Estate quedas habilitado para ejercer legalmente en Estados Unidos.',
    'El curso de Real Estate te da la licencia inmobiliaria.',
    'En Real Estate no necesitas licencia para vender propiedades.',
  ])('flags a license promise: %s', (text) => {
    expect(kinds(text)).toContain('license_claim')
  })
  it('lets the honest statement through', () => {
    expect(kinds('El curso de Real Estate te da la base, pero no reemplaza la licencia estatal que exige Estados Unidos.')).not.toContain('license_claim')
  })
})
