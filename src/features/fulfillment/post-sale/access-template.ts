import { z } from 'zod';

// Owner's 2026-11-01 exception to prompt:230: this access notification is
// predetermined. The initial Central password is owner-confirmed configuration,
// never a sample credential or a fallback for an unverified student.
const singleLine = z.string().min(1).refine(value => value.trim() === value && !/[\r\n¿¡]/u.test(value));
const configSchema = z.object({
  campusUrl: singleLine.pipe(z.string().url()).refine(value => new URL(value).protocol === 'https:'),
  officialWhatsapp: singleLine,
  studentSupportPhone: singleLine,
  adminEmail: singleLine.pipe(z.string().email()),
  teachersEmail: singleLine.pipe(z.string().email()),
  initialPassword: singleLine,
});

export type AccessTemplateConfig = z.infer<typeof configSchema>;

export function loadAccessTemplateConfig(env: Readonly<Record<string, string | undefined>> = process.env): AccessTemplateConfig {
  const parsed = configSchema.safeParse({
    campusUrl: env.POST_SALE_CAMPUS_URL,
    officialWhatsapp: env.POST_SALE_OFFICIAL_WHATSAPP,
    studentSupportPhone: env.POST_SALE_STUDENT_SUPPORT_PHONE,
    adminEmail: env.POST_SALE_ADMIN_EMAIL,
    teachersEmail: env.POST_SALE_TEACHERS_EMAIL,
    initialPassword: env.CENTRAL_CARGA_INITIAL_PASSWORD,
  });
  // Do not include Zod's input-bearing diagnostics: configuration contains a password.
  if (!parsed.success) throw new Error('POST_SALE_ACCESS_TEMPLATE_CONFIG_INVALID');
  return parsed.data;
}

export interface AccessTemplateSource {
  enrollment_status: string | null;
  student_was_created: boolean | null;
  login_email: string | null;
  offering_name: string;
  bonus_offerings?: ReadonlyArray<{ code: string; display_name: string; position: number }>;
  verified_bonus_enrollments?: ReadonlyArray<{ offering_code: string; enrollment_status: string; position: number }>;
}

const active = (status: string | null) => status === 'active' || status === 'already_enrolled';

export function renderAccessTemplate(source: AccessTemplateSource, config: AccessTemplateConfig): string {
  if (!configSchema.safeParse(config).success) throw new Error('POST_SALE_ACCESS_TEMPLATE_CONFIG_INVALID');
  if (typeof source.student_was_created !== 'boolean'
    || !singleLine.pipe(z.string().email()).safeParse(source.login_email).success
    || !singleLine.safeParse(source.offering_name).success) {
    throw new Error('POST_SALE_ACCESS_NOT_VERIFIED');
  }
  const bonuses = [...source.bonus_offerings ?? []].sort((a, b) => a.position - b.position);
  if (bonuses.some(b => !singleLine.safeParse(b.display_name).success)) {
    throw new Error('POST_SALE_ACCESS_NOT_VERIFIED');
  }
  const verified = source.verified_bonus_enrollments ?? [];
  const isVerified = (bonus: typeof bonuses[number]) => verified.some(item =>
    item.offering_code === bonus.code && item.position === bonus.position && active(item.enrollment_status));
  const courseLines = [...(active(source.enrollment_status) ? [`📚 CURSO PRINCIPAL: ${source.offering_name}`] : []),
    ...bonuses.filter(isVerified).map(bonus => `🎁 CURSO BONIFICADO: ${bonus.display_name}`)];
  if (courseLines.length === 0) throw new Error('POST_SALE_ACCESS_NOT_VERIFIED');
  const credentials = source.student_was_created
    ? [`📌 USUARIO: ${source.login_email}`, `📌 CONTRASEÑA: ${config.initialPassword}`,
      ...(config.initialPassword.startsWith('E') ? ['RECUERDA LA «E» EN MAYÚSCULA'] : [])]
    : [`📌 Ingresá con tu usuario y contraseña de siempre: ${source.login_email}`];
  const pendingNames = [...(active(source.enrollment_status) ? [] : [source.offering_name]),
    ...bonuses.filter(bonus => !isVerified(bonus)).map(bonus => bonus.display_name)];
  const pending = pendingNames.map(name => `El equipo está terminando de habilitar ${name}; te avisamos por acá.`);
  return [
    'Tu acceso ya está habilitado. Bienvenido a Studyx.',
    `CURSOS HABILITADOS\n${courseLines.join('\n')}`,
    'LINK DIRECTO AL CAMPUS VIRTUAL 👇🏻',
    config.campusUrl,
    ...credentials,
    ...pending,
    'C A N A L E S  O F I C I A L E S  D E  C O N T A C T O',
    `WHATSAPP OFICIAL DE LA ACADEMIA: ${config.officialWhatsapp} (solo WhatsApp)\nNÚMERO DE ASISTENCIA AL ALUMNO: ${config.studentSupportPhone} ☎️📚\nADMINISTRACIÓN: ${config.adminEmail}\nDEPARTAMENTO DE PROFESORES: ${config.teachersEmail}`,
    ...(source.student_was_created ? ['Si quieres, puedes cambiar tu contraseña después de ingresar.'] : []),
  ].join('\n\n');
}
