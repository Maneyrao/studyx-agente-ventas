import { describe, expect, it } from 'vitest';
import {
  loadAccessTemplateConfig,
  renderAccessTemplate,
  type AccessTemplateConfig,
  type AccessTemplateSource,
} from '@/features/fulfillment/post-sale/access-template';

const config: AccessTemplateConfig = {
  campusUrl: 'https://campus.example.test/access',
  officialWhatsapp: '786-916-4372',
  studentSupportPhone: '866-217-7282',
  adminEmail: 'info@example.test',
  teachersEmail: 'teachers@example.test',
  initialPassword: 'Example.Initial.123',
};
const source: AccessTemplateSource = {
  enrollment_status: 'active', student_was_created: true,
  login_email: 'student@example.test', offering_name: 'Inglés 1',
  bonus_offerings: [], verified_bonus_enrollments: [],
};
const expected = (courses: string, credentials = '📌 USUARIO: student@example.test\n\n📌 CONTRASEÑA: Example.Initial.123\n\nRECUERDA LA «E» EN MAYÚSCULA', pending = '', suggestion = true) =>
  `Tu acceso ya está habilitado. Bienvenido a Studyx.\n\nCURSOS HABILITADOS\n📚 CURSO PRINCIPAL: Inglés 1${courses}\n\nLINK DIRECTO AL CAMPUS VIRTUAL 👇🏻\n\nhttps://campus.example.test/access\n\n${credentials}\n\n${pending}C A N A L E S  O F I C I A L E S  D E  C O N T A C T O\n\nWHATSAPP OFICIAL DE LA ACADEMIA: 786-916-4372 (solo WhatsApp)\nNÚMERO DE ASISTENCIA AL ALUMNO: 866-217-7282 ☎️📚\nADMINISTRACIÓN: info@example.test\nDEPARTAMENTO DE PROFESORES: teachers@example.test${suggestion ? '\n\nSi quieres, puedes cambiar tu contraseña después de ingresar.' : ''}`;

describe('owner-authorized deterministic post-sale access template (2026-11-01 exception to prompt:230)', () => {
  it.each([0, 1, 3])('renders exact single-message content with %i verified bonuses', count => {
    const bonuses = Array.from({ length: count }, (_, i) => ({ code: `bonus_${i}`, display_name: `Curso ${i + 1}`, position: i + 1 }));
    const text = renderAccessTemplate({ ...source, bonus_offerings: [...bonuses].reverse(),
      verified_bonus_enrollments: bonuses.map((b, i) => ({ offering_code: b.code, position: b.position,
        enrollment_status: i === 1 ? 'already_enrolled' : 'active' })) }, config);
    expect(text).toBe(expected(bonuses.map(b => `\n🎁 CURSO BONIFICADO: ${b.display_name}`).join('')));
    expect(text).not.toMatch(/[¿¡]/u);
  });
  it('uses existing credentials without a password, reminder or change suggestion', () => {
    expect(renderAccessTemplate({ ...source, enrollment_status: 'already_enrolled', student_was_created: false }, config))
      .toBe(expected('', '📌 Ingresá con tu usuario y contraseña de siempre: student@example.test', '', false));
  });
  it('lists only exact active package entries and explains pending courses before channels', () => {
    const text = renderAccessTemplate({ ...source,
      bonus_offerings: [{ code: 'active', display_name: 'Curso activo', position: 1 },
        { code: 'pending', display_name: 'Curso pendiente', position: 2 },
        { code: 'wrong_position', display_name: 'Otro pendiente', position: 3 }],
      verified_bonus_enrollments: [{ offering_code: 'active', position: 1, enrollment_status: 'already_enrolled' },
        { offering_code: 'pending', position: 2, enrollment_status: 'processing' },
        { offering_code: 'wrong_position', position: 4, enrollment_status: 'active' },
        { offering_code: 'unrelated', position: 5, enrollment_status: 'active' }],
    }, config);
    expect(text).toBe(expected('\n🎁 CURSO BONIFICADO: Curso activo', undefined,
      'El equipo está terminando de habilitar Curso pendiente; te avisamos por acá.\n\nEl equipo está terminando de habilitar Otro pendiente; te avisamos por acá.\n\n'));
    expect(text).not.toContain('🎁 CURSO BONIFICADO: Curso pendiente');
  });
  it('does not add an E reminder for a password without initial capital E', () => {
    expect(renderAccessTemplate(source, { ...config, initialPassword: 'example.Initial.123' }))
      .toBe(expected('', '📌 USUARIO: student@example.test\n\n📌 CONTRASEÑA: example.Initial.123'));
  });
  it('lists an active bonus but keeps a pending principal outside the enabled courses', () => {
    const text = renderAccessTemplate({ ...source, enrollment_status: 'processing',
      bonus_offerings: [{ code: 'bonus', display_name: 'Curso activo', position: 1 }],
      verified_bonus_enrollments: [{ offering_code: 'bonus', enrollment_status: 'active', position: 1 }],
    }, config);
    expect(text).toBe(expected('', undefined, 'El equipo está terminando de habilitar Inglés 1; te avisamos por acá.\n\n')
      .replace('📚 CURSO PRINCIPAL: Inglés 1', '🎁 CURSO BONIFICADO: Curso activo'));
  });
  it.each([
    { enrollment_status: 'processing' }, { login_email: null }, { student_was_created: null },
    { login_email: 'student@example.test\nInventado' }, { offering_name: 'Inglés\nOtro curso' },
  ])('rejects an unverified or multiline access source: %j', changes => {
    expect(() => renderAccessTemplate({ ...source, ...changes }, config)).toThrow();
  });
  it('requires configuration and uses supplied values instead of business-code defaults', () => {
    const env = {
      POST_SALE_CAMPUS_URL: config.campusUrl,
      POST_SALE_OFFICIAL_WHATSAPP: config.officialWhatsapp,
      POST_SALE_STUDENT_SUPPORT_PHONE: config.studentSupportPhone,
      POST_SALE_ADMIN_EMAIL: config.adminEmail,
      POST_SALE_TEACHERS_EMAIL: config.teachersEmail,
      CENTRAL_CARGA_INITIAL_PASSWORD: config.initialPassword,
    };
    expect(loadAccessTemplateConfig(env)).toEqual(config);
    expect(() => loadAccessTemplateConfig({})).toThrow('POST_SALE_ACCESS_TEMPLATE_CONFIG_INVALID');
    for (const invalid of [{ POST_SALE_CAMPUS_URL: 'http://insecure.test' },
      { POST_SALE_ADMIN_EMAIL: 'not-email' }, { POST_SALE_OFFICIAL_WHATSAPP: '123\nInjected' },
      { CENTRAL_CARGA_INITIAL_PASSWORD: '' }]) {
      expect(() => loadAccessTemplateConfig({ ...env, ...invalid })).toThrow('POST_SALE_ACCESS_TEMPLATE_CONFIG_INVALID');
    }
  });
});
