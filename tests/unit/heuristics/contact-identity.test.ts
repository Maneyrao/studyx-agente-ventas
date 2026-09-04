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
      declaredPhone: null,
    });
  });

  it('captures a compound surname after "soy"', () => {
    expect(extractContactIdentity('Soy Franco Le Blanc, franco@example.com.')).toEqual({
      name: 'Franco Le Blanc',
      email: 'franco@example.com',
      declaredPhone: null,
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
      declaredPhone: null,
    });
  });

  it.each([
    ['Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.', 'Emilia Ríos', 'emilia.rios@example.test', '+13055550188'],
    ['Te comparto mis datos de contacto: Valentina Suárez; valentina.suarez@example.test.', 'Valentina Suárez', 'valentina.suarez@example.test', null],
    ['Mis datos personales: Franco Le Blanc, franco@example.test.', 'Franco Le Blanc', 'franco@example.test', null],
    ['Nombre y apellido: Carla Ibáñez, correo: carla@example.test.', 'Carla Ibáñez', 'carla@example.test', null],
    ['Nombre completo: Diego Farías; EMAIL: diego@example.test.', 'Diego Farías', 'diego@example.test', null],
    ["Mi nombre: Juan O'Neill, juan@example.test.", "Juan O'Neill", 'juan@example.test', null],
    ['Mis datos:\nLucía Pérez,\ncorreo electrónico: lucia@example.test.', 'Lucía Pérez', 'lucia@example.test', null],
    ['Nombre y apellido: Valentina Costa\nEmail: valentina.costa@example.test\nCelular: +1 (786) 555-0164', 'Valentina Costa', 'valentina.costa@example.test', '+17865550164'],
    ['Mis datos de contacto: Pedro Vargas\r\nCorreo electrónico: pedro@example.test', 'Pedro Vargas', 'pedro@example.test', null],
    ['Nombre completo: Josefina Martínez\njosefina@example.test', 'Josefina Martínez', 'josefina@example.test', null],
  ] as const)('captures a structured personal label with a name adjacent to its email: %s', (text, name, email, declaredPhone) => {
    expect(extractContactIdentity(text)).toEqual({ name, email, declaredPhone });
  });

  it.each([
    'Curso: Redes Informáticas, redes@example.test.',
    'Quiero estudiar: Marketing Digital, marketing@example.test.',
    'Mi hermana: Emilia Ríos, emilia@example.test.',
    'Los datos de mi hermana: Emilia Ríos, emilia@example.test.',
    'Nombre de mi hermano: Juan Pérez, juan@example.test.',
    'Te paso el contacto de mi hermana. Nombre completo: Emilia Ríos, emilia@example.test.',
    'Mis datos: emilia ríos, emilia@example.test.',
    'Mis datos: Emilia interesada en curso, emilia@example.test.',
    'Mis datos: Emilia Ríos o Ana Pérez, emilia@example.test.',
    'Mis datos: Emilia Ríos, Ana Pérez, emilia@example.test.',
    'Mis datos: Emilia, emilia@example.test.',
    'Curso: Maquillaje Profesional\nEmail: maquillaje@example.test',
    'Mi hermana: Valentina Costa\nEmail: valentina@example.test',
    'Nombre completo: Josefina Martínez Email: josefina@example.test',
    'No son mis datos: Emilia Ríos, emilia@example.test.',
    'No es mi nombre: Emilia Ríos, emilia@example.test.',
    'Estos tampoco son mis datos personales: Juan Pérez; juan@example.test.',
  ])('does not reinterpret course labels, prose or ambiguous third-party contacts as the customer: %s', (text) => {
    expect(extractContactIdentity(text).name).toBeNull();
  });

  it('captures a lowercase introduction verb with a capitalized name', () => {
    expect(extractContactIdentity('soy Yamila Torrez, yamila@example.com')).toEqual({
      name: 'Yamila Torrez',
      email: 'yamila@example.com',
      declaredPhone: null,
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
      declaredPhone: null,
    });
  });

  it('does not manufacture a full name from a surname correction without an existing identity', () => {
    expect(extractContactIdentity('Me equivoqué: es Suárez con tilde.', null)).toEqual({
      name: null,
      email: null,
      declaredPhone: null,
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
