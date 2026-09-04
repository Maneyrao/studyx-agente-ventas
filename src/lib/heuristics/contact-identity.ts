/**
 * Deterministic capture of contact identity volunteered by the customer in a
 * written turn ("Soy Bruno Aguilar, bruno@example.com").
 *
 * Deliberately conservative: it only accepts a name after an explicit
 * introduction verb ("soy", "me llamo", "mi nombre es") or a leading
 * capitalized name immediately followed by an email address in the same
 * message. A structured personal header can also introduce that name/email
 * pair. Every token of a captured name must start with an uppercase
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

const STRUCTURED_NAME_BEFORE_EMAIL_PATTERN = new RegExp(
  `:\\s*(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})(?:\\s*[,;]\\s*|[ \\t]*\\r?\\n\\s*)`
  + `(?:(?:mi\\s+)?(?:correo(?:\\s+electr[oó]nico)?|e-?mail)\\s*(?::|es)?\\s*)?$`,
  'iu',
);

const LABELED_NAME_BEFORE_EMAIL_PATTERN = new RegExp(
  `(?:^\\s*|:\\s*)nombres?(?:\\s*:\\s*|\\s+(?:es\\s+)?)(${NAME_SEQUENCE})\\s*[;\\r\\n]+\\s*`
  + `apellidos?(?:\\s*:\\s*|\\s+(?:es\\s+)?)(${NAME_SEQUENCE})\\s*[;\\r\\n]+\\s*`
  + `(?:correo(?:\\s+electr[oó]nico)?|e-?mail)\\s*(?::|es)?\\s*$`,
  'iu',
);

const EXPLICIT_SELF_CONTACT_HEADER = /\b(?:mis\s+datos(?:\s+(?:personales|de\s+contacto))?|mi\s+nombre(?:\s+(?:completo|y\s+apellido))?)\s*$/iu;
const NEGATED_CONTACT_HEADER = /\b(?:no|ni|sin|nunca|tampoco)\b/iu;
const STANDALONE_CONTACT_FIELD_HEADER = /^(?:nombre(?:\s+(?:completo|y\s+apellido))?|datos\s+personales)\s*$/iu;
const UNSAFE_NAME_OWNER = /\b(?:no|ni|sin|nunca|tampoco|herman[oa]|amig[oa]|madre|padre|hij[oa]|tercero|otra\s+persona)\b/iu;

const CORRECTED_SURNAME_PATTERN = new RegExp(
  `(?:mi\\s+apellido(?:\\s+correcto)?\\s+es|me\\s+equivoqu[eé].{0,48}?\\bes)\\s+(${NAME_TOKEN})(?=\\s*(?:con\\s+tilde|[,;.:!?]|$))`,
  'iu',
);

function isPlausibleName(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/u);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-ZÁÉÍÓÚÜÑ]/u.test(token));
}

function ownsPersonalContactBlock(headerSource: string): boolean {
  const header = headerSource.split(/[.;!?…\n]/u).at(-1)?.trim() ?? '';
  return !NEGATED_CONTACT_HEADER.test(header)
    && (EXPLICIT_SELF_CONTACT_HEADER.test(header)
      || (headerSource === header && STANDALONE_CONTACT_FIELD_HEADER.test(header)));
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
  const emailMatch = EMAIL_PATTERN.exec(text);
  const email = emailMatch?.[0] ?? null;
  const declaredPhone = extractDeclaredPhone(text);

  let name: string | null = null;
  const introduced = INTRODUCED_NAME_PATTERN.exec(text);
  const introductionPrefix = introduced ? text.slice(0, introduced.index).split(/[.;!?\n]/u).at(-1) ?? '' : '';
  if (introduced && !UNSAFE_NAME_OWNER.test(introductionPrefix) && isPlausibleName(introduced[1])) {
    name = introduced[1].trim();
  } else if (email) {
    const leading = LEADING_NAME_BEFORE_EMAIL_PATTERN.exec(text);
    if (leading && isPlausibleName(leading[1])) {
      name = leading[1].trim();
    } else if (emailMatch) {
      // En un bloque rotulado por la propia persona, el nombre ocupa el campo
      // inmediatamente anterior al primer correo. El encabezado evita tomar
      // como identidad un curso o un contacto de terceros escrito en prosa.
      const beforeEmail = text.slice(0, emailMatch.index);
      const labeled = LABELED_NAME_BEFORE_EMAIL_PATTERN.exec(beforeEmail);
      if (labeled) {
        const headerSource = beforeEmail.slice(0, labeled.index).trim();
        const standaloneForm = labeled.index === 0 && !labeled[0].trimStart().startsWith(':');
        const fullName = `${labeled[1].trim()} ${labeled[2].trim()}`;
        if ((standaloneForm || ownsPersonalContactBlock(headerSource)) && isPlausibleName(fullName)) {
          name = fullName;
        }
      }
      const structured = STRUCTURED_NAME_BEFORE_EMAIL_PATTERN.exec(beforeEmail);
      if (name === null && structured) {
        const headerSource = beforeEmail.slice(0, structured.index).trim();
        if (ownsPersonalContactBlock(headerSource) && isPlausibleName(structured[1])) name = structured[1].trim();
      }
    }
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

export interface ContactNameParts {
  readonly firstName: string | null;
  readonly surname: string | null;
}

/** Only ingestion may supply a request after proving its delivery to this
 * conversation. A model's awaiting state or an unsent draft is not a request. */
export function extractContactNameAnswer(
  text: string,
  deliveredRequest: string,
  previous: ContactNameParts = { firstName: null, surname: null },
): (ContactNameParts & { readonly name: string | null }) | null {
  const clauses = deliveredRequest.split(/[.!?\n]/u).filter(clause =>
    !UNSAFE_NAME_OWNER.test(clause)
    && /\b(?:necesito|necesitamos|falta[ns]?|pas[aá](?:s|me|rme)|compart[ií](?:s|me|rme)|dec[ií](?:s|me|rme)|indic[aá](?:s|me|rme)|confirm[aá](?:s|me|rme)|cu[aá]l\s+es)\b/iu.test(clause));
  const request = clauses.join(' ');
  const asksFirstName = /\bnombre\b/iu.test(request);
  const asksSurname = /\bapellido\b|\bnombre\s+completo\b/iu.test(request);
  if ((!asksFirstName && !asksSurname) || UNSAFE_NAME_OWNER.test(text)) return null;

  // A phone link is transport formatting, not part of the written name. Only
  // the leading identity segment is eligible; no scanning arbitrary prose.
  const plain = text.replace(/\[([^\]]+)\]\(tel:[^)]+\)/gu, '$1').trim();
  const boundary = plain.search(new RegExp(`${EMAIL_PATTERN.source}|${DECLARED_PHONE_PATTERN.source}|[\\n,;.!?¿]`, 'u'));
  const candidate = (boundary < 0 ? plain : plain.slice(0, boundary)).trim();
  const remainder = boundary < 0 ? '' : plain.slice(boundary).replace(/^[\s,;.!]+/u, '');
  // A second possible identity is ambiguous. The only permitted continuation
  // is the accompanying contact field or an explicit question, as in Telegram.
  if (remainder && !new RegExp(`^(?:${EMAIL_PATTERN.source}|${DECLARED_PHONE_PATTERN.source}|¿|(?:[Yy]\\s+)?(?:[Cc]u[aá]nto|[Cc][oó]mo|[Qq]u[eé]|[Dd][oó]nde)\\b)`, 'u').test(remainder)) return null;
  const strictName = new RegExp(`^${NAME_SEQUENCE}$`, 'u');
  if (!strictName.test(candidate) || !isPlausibleName(candidate)
    || /\b(?:o|y|si|sí|hola|gracias|dale|bueno|perfecto|quiero|curso|plan|pago|excel|marketing|digital|nombre|apellido)\b/iu.test(candidate)) return null;

  let firstName = previous.firstName;
  let surname = previous.surname;
  if (asksFirstName && asksSurname) {
    const parts = splitFullName(candidate);
    if (parts.apellido) {
      firstName = parts.nombre;
      surname = parts.apellido;
    } else if (!firstName) {
      firstName = candidate;
    } else if (!surname) {
      surname = candidate;
    } else {
      return null;
    }
  } else if (asksFirstName) firstName = candidate;
  else surname = candidate;

  // contacts.name is split at its first token by the commercial contract.
  // A compound first name alone must remain partial, or its second token would
  // falsely satisfy the surname requirement before the customer provides one.
  const name = firstName && (surname || !/\s/u.test(firstName))
    ? [firstName, surname].filter(Boolean).join(' ') : null;
  return { firstName, surname, name };
}

/** Cheap syntax gate before ingestion pays for the delivery-evidence query. */
export function couldBeContactNameAnswer(text: string): boolean {
  return extractContactNameAnswer(text, 'Necesito tu nombre.') !== null
    || extractContactNameAnswer(text, 'Necesito tu apellido.') !== null
    || extractContactNameAnswer(text, 'Necesito tu nombre completo.') !== null;
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
