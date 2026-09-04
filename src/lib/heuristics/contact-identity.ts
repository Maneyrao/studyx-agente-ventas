/**
 * Deterministic capture of contact identity volunteered by the customer in a
 * written turn ("Soy Bruno Aguilar, bruno@example.com").
 *
 * Deliberately conservative: it only accepts a name after an explicit
 * introduction verb ("soy", "me llamo", "mi nombre es") or a leading
 * capitalized name immediately followed by an email address in the same
 * message. Every token of a captured name must start with an uppercase
 * letter, so sentence continuations such as "soy interesado en el curso"
 * never become a name. A miss is always safer than a wrong capture — this
 * feeds `contacts.name`/`contacts.email` and the operator-facing Sheets
 * projection, and an uncaptured identity simply stays empty until the
 * customer states it clearly.
 */

export interface CapturedContactIdentity {
  readonly name: string | null;
  readonly email: string | null;
  /** Teléfono que la persona escribe. Nunca el del canal. */
  readonly declaredPhone: string | null;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;

const NAME_TOKEN = "[A-ZÁÉÍÓÚÜÑ][\\p{L}'’-]*";
const NAME_SEQUENCE = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3}`;

const INTRODUCED_NAME_PATTERN = new RegExp(
  `(?:^|[\\s,;.!¡¿?])(?:soy|me\\s+llamo|mi\\s+nombre\\s+es)\\s+(${NAME_SEQUENCE})(?=\\s*(?:[,;.:!?]|$))`,
  'iu',
);

const LEADING_NAME_BEFORE_EMAIL_PATTERN = new RegExp(
  `^[\\s¡¿]*(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})\\s*[,;:]?\\s*(?=${EMAIL_PATTERN.source})`,
  'u',
);

const CORRECTED_SURNAME_PATTERN = new RegExp(
  `(?:mi\\s+apellido(?:\\s+correcto)?\\s+es|me\\s+equivoqu[eé].{0,48}?\\bes)\\s+(${NAME_TOKEN})(?=\\s*(?:con\\s+tilde|[,;.:!?]|$))`,
  'iu',
);

function isPlausibleName(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/u);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-ZÁÉÍÓÚÜÑ]/u.test(token));
}

/**
 * Teléfono declarado en prosa.
 *
 * Conservador a propósito, igual que la captura de nombre: primero se quitan
 * los correos —traen dígitos y romperían el conteo— y después se exige una
 * corrida de 8 a 15 dígitos, que es el rango de E.164. Con eso los importes y
 * los planes del catálogo no pueden colarse: "12 pagos mensuales de USD 30"
 * son 12, 30 y 360, todos demasiado cortos.
 *
 * Que tenga forma de teléfono no prueba que sea suyo ni que funcione. Esto
 * captura lo que la persona dice, que es exactamente el dato del contrato
 * comercial; verificarlo es otro problema y no lo resuelve un regex.
 */
const DECLARED_PHONE_PATTERN = /(\+?\d[\d\s().-]{6,18}\d)/u;

export function extractDeclaredPhone(text: string): string | null {
  const withoutEmails = text.replace(new RegExp(EMAIL_PATTERN.source, 'gu'), ' ');
  const candidate = DECLARED_PHONE_PATTERN.exec(withoutEmails)?.[1];
  if (!candidate) return null;
  const digits = candidate.replace(/\D/gu, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return candidate.trim().startsWith('+') ? `+${digits}` : digits;
}

export function extractContactIdentity(
  text: string,
  existingName: string | null = null,
): CapturedContactIdentity {
  const email = EMAIL_PATTERN.exec(text)?.[0] ?? null;
  const declaredPhone = extractDeclaredPhone(text);

  let name: string | null = null;
  const introduced = INTRODUCED_NAME_PATTERN.exec(text);
  if (introduced && isPlausibleName(introduced[1])) {
    name = introduced[1].trim();
  } else if (email) {
    const leading = LEADING_NAME_BEFORE_EMAIL_PATTERN.exec(text);
    if (leading && isPlausibleName(leading[1])) name = leading[1].trim();
  }

  if (name === null && existingName) {
    const correctedSurname = CORRECTED_SURNAME_PATTERN.exec(text)?.[1] ?? null;
    if (correctedSurname && isPlausibleName(correctedSurname)) {
      const existingTokens = existingName.trim().split(/\s+/u);
      if (existingTokens.length >= 2) {
        name = [...existingTokens.slice(0, -1), correctedSurname].join(' ');
      }
    }
  }

  return { name, email, declaredPhone };
}

/**
 * Operator-facing split for the Sheets projection: first token is `nombre`,
 * the remainder is `apellido` (compound surnames like "Le Blanc" stay whole).
 */
export function splitFullName(fullName: string): { nombre: string; apellido: string } {
  const tokens = fullName.trim().split(/\s+/u);
  return { nombre: tokens[0] ?? '', apellido: tokens.slice(1).join(' ') };
}

/**
 * Prefijo `+999`: código de país reservado por la ITU, no ruteable.
 *
 * Los canales que no entregan un teléfono real —Telegram, hoy— acuñan uno
 * sintético con este prefijo para poder usar `contacts.phone` como identidad
 * única del canal (`mintSyntheticPhone` en
 * `botpress-agent/src/channels/shared/telegram-envelope.ts`; una prueba fija
 * la consistencia del formato entre ambos lados).
 *
 * Ese string existe, pero no es un teléfono: no se puede llamar ni escribir a
 * ese número. La constante se declara acá, en la capa pura, y no se importa
 * del bundle del canal, para no atar el backend comercial al transporte.
 */
export const SYNTHETIC_CHANNEL_PHONE_PREFIX_V1 = '+999';

export function isSyntheticChannelPhoneV1(phone: string | null | undefined): boolean {
  return (phone ?? '').startsWith(SYNTHETIC_CHANNEL_PHONE_PREFIX_V1);
}

export interface ContactIntakeRowV1 {
  /** Identidad del canal. Puede ser sintética; nunca se pisa. */
  readonly phone: string | null;
  /** Teléfono que la persona declaró en la conversación, si lo hizo. */
  readonly declared_phone?: string | null;
  readonly name: string | null;
  readonly email: string | null;
}

/**
 * Proyecta una fila de `contacts` al contrato comercial de intake.
 *
 * Tener un string en `phone` no demuestra tener un teléfono. Informar un
 * `+999…` como `telefono` hacía que `intake_missing` nunca pudiera contener
 * ese campo, y el gate del link de pago se abría sobre un dato que el cliente
 * nunca dio. `contacts.phone` no se toca: es NOT NULL UNIQUE y es la clave de
 * identidad del canal.
 */
export function commercialIntakeFromContactRowV1(row: ContactIntakeRowV1 | null): {
  readonly nombre: string | null;
  readonly apellido: string | null;
  readonly correo: string | null;
  readonly telefono: string | null;
} {
  if (!row) return { nombre: null, apellido: null, correo: null, telefono: null };
  const identity = row.name ? splitFullName(row.name) : null;
  // Orden de preferencia: lo que la persona declaró gana, porque es el dato
  // del contrato comercial. Si no declaró nada, sirve el del canal siempre que
  // sea real: WhatsApp entrega un número de verdad y no tiene sentido volver a
  // pedirlo. Un `+999…` no acredita nada y queda como faltante.
  const declared = (row.declared_phone ?? '').trim();
  const channelPhone = isSyntheticChannelPhoneV1(row.phone) ? null : row.phone;
  return {
    nombre: identity?.nombre || null,
    apellido: identity?.apellido || null,
    correo: row.email,
    telefono: declared.length > 0 ? declared : channelPhone,
  };
}
