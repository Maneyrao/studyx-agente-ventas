import { describe, expect, it } from 'vitest';

import { mintSyntheticPhone } from '../../../../botpress-agent/src/channels/shared/telegram-envelope';
import {
  commercialIntakeFromContactRowV1,
  extractDeclaredPhone,
  isSyntheticChannelPhoneV1,
} from '@/lib/heuristics/contact-identity';

/**
 * El teléfono de Telegram no es un teléfono.
 *
 * `mintSyntheticPhone` acuña un `+999…` para poder usar `contacts.phone` como
 * identidad única del canal. El lector comercial devolvía ese string como
 * `telefono`, así que `intake_missing` nunca podía contener `telefono` y el
 * gate del link de pago se abría sobre un dato que nadie dio.
 *
 * El teléfono comercial declarado sigue siendo uno de los seis datos del
 * contrato, no un séptimo. Lo que falta es dónde guardarlo.
 */
describe('identidad sintética de canal', () => {
  it('mintSyntheticPhone produce el formato reservado por la ITU', () => {
    expect(mintSyntheticPhone(123456789)).toBe('+9990123456789');
  });

  it('el prefijo sintético se reconoce y un número real no', () => {
    expect(isSyntheticChannelPhoneV1(mintSyntheticPhone(123456789))).toBe(true);
    expect(isSyntheticChannelPhoneV1('+13055551234')).toBe(false);
    expect(isSyntheticChannelPhoneV1(null)).toBe(false);
  });
});

describe('commercialIntakeFromContactRowV1', () => {
  it('un teléfono sintético no acredita teléfono comercial', () => {
    const intake = commercialIntakeFromContactRowV1({
      phone: mintSyntheticPhone(123456789), name: 'Ariana Paz', email: 'a@example.test',
    });

    expect(intake.telefono).toBeNull();
    // Lo que sí llegó por el canal se conserva: la corrección no borra datos.
    expect(intake.nombre).toBe('Ariana');
    expect(intake.apellido).toBe('Paz');
    expect(intake.correo).toBe('a@example.test');
  });

  it('un teléfono real recibido válidamente sí acredita', () => {
    const intake = commercialIntakeFromContactRowV1({
      phone: '+13055551234', name: 'Ariana Paz', email: 'a@example.test',
    });

    expect(intake.telefono).toBe('+13055551234');
  });

  it('un contacto inexistente deja todo en null, nunca en completo', () => {
    const intake = commercialIntakeFromContactRowV1(null);

    expect(intake).toEqual({ nombre: null, apellido: null, correo: null, telefono: null });
  });
});

/**
 * El sexto dato del contrato, con dónde guardarlo.
 *
 * `contacts.declared_phone` (migración 20260904010001) es el lugar del
 * teléfono que la persona dice en la conversación. No es un séptimo dato: es
 * la persistencia que le faltaba al sexto. `contacts.phone` sigue siendo la
 * identidad del canal y no se pisa nunca.
 */
describe('teléfono declarado', () => {
  it('lo declarado gana sobre una identidad de canal sintética', () => {
    const intake = commercialIntakeFromContactRowV1({
      phone: mintSyntheticPhone(123456789),
      declared_phone: '+13055551234',
      name: 'Ariana Paz',
      email: 'a@example.test',
    });

    expect(intake.telefono).toBe('+13055551234');
  });

  it('sin declararlo, un canal con teléfono real sigue alcanzando', () => {
    const intake = commercialIntakeFromContactRowV1({
      phone: '+13055551234', declared_phone: null, name: 'Ariana Paz', email: 'a@example.test',
    });

    expect(intake.telefono).toBe('+13055551234');
  });

  it('sin declararlo y con canal sintético, sigue faltando', () => {
    const intake = commercialIntakeFromContactRowV1({
      phone: mintSyntheticPhone(123456789),
      declared_phone: null,
      name: 'Ariana Paz',
      email: 'a@example.test',
    });

    expect(intake.telefono).toBeNull();
  });
});

describe('extractDeclaredPhone', () => {
  it('captura un teléfono escrito en prosa', () => {
    expect(extractDeclaredPhone('Mi teléfono es +1 305 555 1234')).toBe('+13055551234');
    expect(extractDeclaredPhone('anotá 3055551234')).toBe('3055551234');
    expect(extractDeclaredPhone('(305) 555-1234')).toBe('3055551234');
  });

  it('no confunde importes ni planes del catálogo con un teléfono', () => {
    expect(extractDeclaredPhone('El valor total del programa es USD 360.')).toBeNull();
    expect(extractDeclaredPhone('Elijo 12 pagos mensuales de USD 30')).toBeNull();
    expect(extractDeclaredPhone('Son 16 clases')).toBeNull();
  });

  it('los dígitos de un correo no son un teléfono', () => {
    expect(extractDeclaredPhone('Soy Nadia, base-14-intake-gate-1@example.test')).toBeNull();
  });

  it('rechaza lo que no entra en el rango de E.164', () => {
    expect(extractDeclaredPhone('mi numero es 1234567')).toBeNull();
    expect(extractDeclaredPhone('1234567890123456789')).toBeNull();
  });
});
