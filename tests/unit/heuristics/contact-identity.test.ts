import { describe, expect, it } from 'vitest';
import { extractContactIdentity, extractContactNameAnswer, splitFullName } from '@/lib/heuristics/contact-identity';

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
    ['Mis datos: nombre Camila; apellido Duarte; correo camila.duarte@example.test; teléfono +1 305 555 0168.', 'Camila Duarte', 'camila.duarte@example.test', '+13055550168'],
    ['Mis datos personales:\nNombres Ana María\nApellidos López Díaz\nCorreo electrónico ana.lopez@example.test', 'Ana María López Díaz', 'ana.lopez@example.test', null],
    ["Nombre: Tomás; Apellido: O'Neill; Email: tomas@example.test", "Tomás O'Neill", 'tomas@example.test', null],
  ] as const)('captures separate labeled personal name fields without requiring colons: %s', (text, name, email, declaredPhone) => {
    expect(extractContactIdentity(text)).toEqual({ name, email, declaredPhone });
  });

  it.each([
    'No son mis datos: nombre Camila; apellido Duarte; correo camila@example.test',
    'Estos tampoco son mis datos personales: nombre Juan; apellido Pérez; correo juan@example.test',
    'Los datos de mi hermana: nombre Carla; apellido Ibáñez; correo carla@example.test',
    'Te paso el contacto de mi hermana. Nombre Carla; apellido Ibáñez; correo carla@example.test',
    'Curso: nombre Redes; apellido Informáticas; correo redes@example.test',
    'Mis datos: nombre camila; apellido Duarte; correo camila@example.test',
    'Mis datos: nombre Camila o Julia; apellido Duarte; correo camila@example.test',
    'Mis datos: nombre Camila; correo camila@example.test',
  ])('does not capture separate labels without an unambiguous self-owned full name: %s', text => {
    expect(extractContactIdentity(text).name).toBeNull();
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

  it('adds an explicitly labeled surname to an existing first name', () => {
    expect(extractContactIdentity(
      'Quiero avanzar. Mi apellido es Damonte, mi mail es matidamonte@inventado.com y mi teléfono es +5491123456789.',
      'Matías',
    )).toEqual({
      name: 'Matías Damonte',
      email: 'matidamonte@inventado.com',
      declaredPhone: '+5491123456789',
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


describe('extractContactNameAnswer', () => {
  it('captures and normalizes a lowercase surname after a delivered full-name request', () => {
    expect(extractContactNameAnswer(
      'Juan perez',
      'Para continuar necesito tu nombre y apellido.',
    )).toEqual({ firstName: 'Juan', surname: 'Perez', name: 'Juan Perez' });
  });

  it('captures the production surname-first correction after a delivered full-name request', () => {
    expect(extractContactNameAnswer(
      'Paredes, Luciana es mi nombre ya lo sabes',
      'Para dejarlo registrado necesito tu nombre y apellido.',
    )).toEqual({ firstName: 'Luciana', surname: 'Paredes', name: 'Luciana Paredes' });
  });

  it('does not treat a username as the requested legal identity', () => {
    expect(extractContactNameAnswer(
      'Paredes, Luciana es mi nombre de usuario',
      'Para dejarlo registrado necesito tu nombre y apellido.',
    )).toBeNull();
  });

  it('uses a later explicit surname correction in the same answer', () => {
    expect(extractContactNameAnswer(
      'Paredes, Luciana es mi nombre, pero mi apellido correcto es Rojas',
      'Para dejarlo registrado necesito tu nombre y apellido.',
    )).toEqual({ firstName: 'Luciana', surname: 'Rojas', name: 'Luciana Rojas' });
  });

  it('retains separate first and surname answers when one delivered request asks for both', () => {
    const first = extractContactNameAnswer('Inés', 'Necesito tu nombre y apellido.');
    expect(first).toEqual({ firstName: 'Inés', surname: null, name: 'Inés' });
    expect(extractContactNameAnswer('Valdés', 'Necesito tu nombre y apellido.', first!))
      .toEqual({ firstName: 'Inés', surname: 'Valdés', name: 'Inés Valdés' });
  });

  const fullRequest = 'Para dejarlo registrado necesito tu nombre, apellido y teléfono. ¿Me los pasás?';

  it('captures a full name before a Markdown telephone in a requested answer, without needing an email', () => {
    expect(extractContactNameAnswer(
      'Lucía Ríos [+1 305 555 0168](tel:+13055550168) \n\nCuanto sale?', fullRequest,
    )).toEqual({ firstName: 'Lucía', surname: 'Ríos', name: 'Lucía Ríos' });
  });

  it('combines separate requested fields in either order without treating a surname as a first name', () => {
    const surname = extractContactNameAnswer('Ríos', 'Me falta tu apellido. ¿Me lo pasás?');
    expect(surname).toEqual({ firstName: null, surname: 'Ríos', name: null });
    expect(extractContactNameAnswer('Lucía', 'Para completar el registro necesito tu nombre.', surname!))
      .toEqual({ firstName: 'Lucía', surname: 'Ríos', name: 'Lucía Ríos' });
    expect(extractContactNameAnswer('Le Blanc', '¿Me pasás tu apellido?', { firstName: 'Franco', surname: null }))
      .toEqual({ firstName: 'Franco', surname: 'Le Blanc', name: 'Franco Le Blanc' });
    expect(extractContactNameAnswer('Ríos', '¿Me pasás tu apellido?', { firstName: 'Ana María', surname: null }))
      .toEqual({ firstName: 'Ana María', surname: 'Ríos', name: 'Ana María Ríos' });
  });

  it.each([
    'Ya tengo tu nombre y apellido. ¿Qué curso te interesa?',
    'No necesito tu nombre ni tu apellido.',
    'Tu nombre quedó registrado. ¿Me pasás el correo?',
    'El nombre del curso es Excel Integral. ¿Te interesa?',
    '¿Me pasás el nombre de tu hermana?',
  ])('does not reinterpret a non-identity request as permission to capture: %s', request => {
    expect(extractContactNameAnswer('Lucía Ríos', request)).toBeNull();
  });

  it.each([
    'No soy Lucía Ríos', 'Lucía Ríos, pero son los datos de mi hermana',
    'Lucía Ríos o Ana Pérez', 'Lucía O María', 'No Gracias', 'Sí Dale',
    'Excel Integral', 'Marketing Digital', 'Quiero Excel',
    'Lucía Ríos, Ana Pérez', 'Lucía Ríos\nAna Pérez',
  ])('rejects negation, third-party identity, ambiguity and non-name answers: %s', text => {
    expect(extractContactNameAnswer(text, fullRequest)).toBeNull();
  });

  it('assigns a single answer to the first missing field in the delivered request order', () => {
    expect(extractContactNameAnswer('Ríos', fullRequest))
      .toEqual({ firstName: 'Ríos', surname: null, name: 'Ríos' });
  });

  it('does not enable bare-name capture globally', () => {
    expect(extractContactIdentity('Lucía Ríos +1 305 555 0168').name).toBeNull();
    expect(extractContactIdentity('Ríos').name).toBeNull();
  });
});
