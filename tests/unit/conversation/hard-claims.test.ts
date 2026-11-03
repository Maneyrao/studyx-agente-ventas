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
