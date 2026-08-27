import { describe, expect, it } from 'vitest';
import { extractContactIdentity, splitFullName } from '@/lib/heuristics/contact-identity';

describe('extractContactIdentity', () => {
  it('captures name and email from the canonical "Soy Nombre Apellido, email" turn', () => {
    const captured = extractContactIdentity(
      'Soy Bruno Aguilar, bruno.real11_01+run@example.com.',
    );
    expect(captured).toEqual({
      name: 'Bruno Aguilar',
      email: 'bruno.real11_01+run@example.com',
    });
  });

  it('captures a compound surname after "soy"', () => {
    expect(extractContactIdentity('Soy Franco Le Blanc, franco@example.com.')).toEqual({
      name: 'Franco Le Blanc',
      email: 'franco@example.com',
    });
  });

  it('captures "me llamo" and "mi nombre es" phrasings without an email', () => {
    expect(extractContactIdentity('Me llamo Carla Ibáñez').name).toBe('Carla Ibáñez');
    expect(extractContactIdentity('mi nombre es Diego Farías, gracias').name).toBe('Diego Farías');
  });

  it('captures a bare "Nombre Apellido, email" turn without an introduction verb', () => {
    expect(extractContactIdentity('Ivan Roldan, ivan.real11_10+run@example.com')).toEqual({
      name: 'Ivan Roldan',
      email: 'ivan.real11_10+run@example.com',
    });
  });

  it('captures a lowercase introduction verb with a capitalized name', () => {
    expect(extractContactIdentity('soy Yamila Torrez, yamila@example.com')).toEqual({
      name: 'Yamila Torrez',
      email: 'yamila@example.com',
    });
  });

  it('never captures a sentence continuation as a name', () => {
    expect(extractContactIdentity('soy interesado en el curso de Excel').name).toBeNull();
    expect(extractContactIdentity('Quiero anotarme en Redes Informáticas').name).toBeNull();
    expect(extractContactIdentity('hola, quiero info').name).toBeNull();
  });

  it('returns null email when no email is present', () => {
    expect(extractContactIdentity('Quiero el curso de fotos').email).toBeNull();
  });

  it('does not treat course questions with capitalized words as identity', () => {
    const captured = extractContactIdentity('¿Cuántas clases tiene Excel Integral?');
    expect(captured.name).toBeNull();
    expect(captured.email).toBeNull();
  });

  it('applies an explicit surname correction to the existing full name', () => {
    expect(extractContactIdentity(
      'Che, esperá, me equivoqué: es Suárez con tilde, y el email real es milena@example.com.',
      'Milena Suares',
    )).toEqual({
      name: 'Milena Suárez',
      email: 'milena@example.com',
    });
  });

  it('does not manufacture a full name from a surname correction without an existing identity', () => {
    expect(extractContactIdentity('Me equivoqué: es Suárez con tilde.', null)).toEqual({
      name: null,
      email: null,
    });
  });
});

describe('splitFullName', () => {
  it('splits first token as nombre and the remainder as apellido', () => {
    expect(splitFullName('Bruno Aguilar')).toEqual({ nombre: 'Bruno', apellido: 'Aguilar' });
    expect(splitFullName('Franco Le Blanc')).toEqual({ nombre: 'Franco', apellido: 'Le Blanc' });
  });

  it('keeps a single token as nombre with an empty apellido', () => {
    expect(splitFullName('Bruno')).toEqual({ nombre: 'Bruno', apellido: '' });
  });
});
