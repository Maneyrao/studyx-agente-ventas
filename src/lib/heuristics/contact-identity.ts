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
const CONTEXTUAL_NAME_TOKEN = "[\\p{L}][\\p{L}'’-]*";
const CONTEXTUAL_NAME_SEQUENCE = `${CONTEXTUAL_NAME_TOKEN}(?:\\s+${CONTEXTUAL_NAME_TOKEN}){0,3}`;
const CONTEXTUAL_NON_NAME_TOKENS = new Set([
  'bueno', 'curso', 'cursos', 'dale', 'detalle', 'detalles', 'duracion', 'fotografia',
  'gracias', 'hola', 'horario', 'horarios',
  'info', 'informacion', 'ingles', 'laboral', 'modalidad', 'opcion', 'opciones', 'pago', 'pagos',
  'precio', 'precios', 'salida', 'tecnologia',
]);

const INTRODUCED_NAME_PATTERN = new RegExp(
  `(?:^|[\\s,;.!¡¿?])(?:soy|me\\s+llamo|mi\\s+nombre\\s+es)\\s+(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3}?)`
  + `(?=\\s*(?:[,;.:!?]|$|y\\b))`,
  'iu',
);

const LEADING_NAME_BEFORE_EMAIL_PATTERN = new RegExp(
  `^[\\s¡¿]*(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})\\s*[,;:]?\\s*(?=${EMAIL_PATTERN.source})`,
  'u',
);

// A natural answer often supplies the requested first name and immediately
// continues with the study goal: "Thiago. Busco algo de tecnología". The
// single-token boundary and goal verb keep arbitrary course prose out of the
// durable contact name without depending on the immediately previous bubble.
const LEADING_FIRST_NAME_BEFORE_GOAL_PATTERN = new RegExp(
  `^[\\s¡¿]*(${NAME_TOKEN})\\s*[,;.!?]\\s*(?:busco|me\\s+interesa|quiero|necesito|para)\\b`,
  'iu',
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
const UNSAFE_NAME_REQUEST = /\b(?:herman[oa]|amig[oa]|madre|padre|hij[oa]|tercero|otra\s+persona)\b|\b(?:no|ni|nunca|tampoco)\s+(?:necesito|necesitamos|me\s+falta|nos\s+falta|hace\s+falta)\b|\bsin\s+(?:nombre|apellido|necesidad\s+de)\b/iu;

const CORRECTED_SURNAME_PATTERN = new RegExp(
  `(?:mi\\s+apellido(?:\\s+correcto)?\\s+es|me\\s+equivoqu[eé].{0,48}?\\bes)\\s+(${NAME_TOKEN})(?=\\s*(?:con\\s+tilde|[,;.:!?]|$))`,
  'iu',
);

const STATED_SURNAME_PATTERN = new RegExp(
  `\\bmi\\s+apellido\\s+es\\s+(${NAME_TOKEN})(?=\\s*(?:[,;.:!?]|$))`,
  'iu',
);

function isPlausibleName(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/u);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-ZÁÉÍÓÚÜÑ]/u.test(token));
}

function normalizeContextualName(candidate: string): string {
  return candidate.trim().split(/\s+/u).map((token) => {
    const [first = '', ...rest] = [...token];
    return `${first.toLocaleUpperCase('es')}${rest.join('').toLocaleLowerCase('es')}`;
  }).join(' ');
}

function isPlausibleContextualName(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/u);
  return tokens.length > 0 && tokens.length <= 4
    && tokens.every((token) => new RegExp(`^${CONTEXTUAL_NAME_TOKEN}$`, 'u').test(token));
}

function containsContextualNonNameToken(candidate: string): boolean {
  return candidate
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .split(/\s+/u)
    .some((token) => CONTEXTUAL_NON_NAME_TOKENS.has(token));
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
  } else {
    const leadingGoal = LEADING_FIRST_NAME_BEFORE_GOAL_PATTERN.exec(text);
    if (leadingGoal && isPlausibleName(leadingGoal[1])
      && !containsContextualNonNameToken(leadingGoal[1])) {
      name = leadingGoal[1].trim();
    }
  }
  if (name === null && email) {
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
    const statedSurname = STATED_SURNAME_PATTERN.exec(text)?.[1]
      ?? CORRECTED_SURNAME_PATTERN.exec(text)?.[1]
      ?? null;
    if (statedSurname && isPlausibleName(statedSurname)) {
      const existingTokens = existingName.trim().split(/\s+/u);
      name = `${existingTokens[0]} ${statedSurname}`;
    }
  }

  // Una corrección explícita de nombre no retracta el apellido ya durable.
  // `contacts.name` guarda ambos valores en un único string; reemplazar
  // "Lucas Pierella" por "Luke" convertía el apellido en un dato faltante y
  // bloqueaba luego el link de pago. Un nombre completo nuevo sí reemplaza
  // ambos componentes, mientras que un único token conserva el apellido.
  if (name !== null && existingName && !/\s/u.test(name.trim())) {
    const previous = splitFullName(existingName);
    if (previous.apellido) name = `${name.trim()} ${previous.apellido}`;
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
    !UNSAFE_NAME_REQUEST.test(clause)
    && /\b(?:necesito|necesitamos|falta[ns]?|pas[aá](?:s|me|rme)|compart[ií](?:s|me|rme)|dec[ií](?:s|me|rme)|d[ií](?:ces|me)|indic[aá](?:s|me|rme)|confirm[aá](?:s|me|rme)|cu[aá]l\s+es|c[oó]mo\s+te\s+llam[aá]s)\b/iu.test(clause));
  const request = clauses.join(' ');
  const asksFirstName = /\bnombre\b|\bc[oó]mo\s+te\s+llam[aá]s\b/iu.test(request);
  const asksSurname = /\bapellido\b|\bnombre\s+completo\b/iu.test(request);
  if ((!asksFirstName && !asksSurname) || UNSAFE_NAME_OWNER.test(text)) return null;

  const surnameFirst = new RegExp(
    `^\\s*(${NAME_SEQUENCE})\\s*,\\s*(${NAME_SEQUENCE})\\s+es\\s+mi\\s+nombre\\b`,
    'u',
  ).exec(text);
  if (asksFirstName && asksSurname && surnameFirst
    && isPlausibleName(surnameFirst[1]) && isPlausibleName(surnameFirst[2])) {
    const firstName = surnameFirst[2].trim();
    const statedSurname = surnameFirst[1].trim();
    const suffix = text.slice(surnameFirst[0].length).trim();
    const harmlessAcknowledgement = /^(?:[,;.!?…]\s*)?(?:ya\s+lo\s+sab(?:es|ias))?[.!?…]*$/iu
      .test(suffix);
    const correctedSurname = new RegExp(
      `^(?:[,;.!?…]\\s*)?(?:pero\\s+)?(?:mi\\s+apellido(?:\\s+correcto)?\\s+es|me\\s+equivoqu[eé].{0,48}?\\bes)\\s+(${NAME_SEQUENCE})(?:\\s+con\\s+tilde)?[.!?…]*$`,
      'iu',
    ).exec(suffix)?.[1]?.trim() ?? null;
    if (harmlessAcknowledgement || (correctedSurname && isPlausibleName(correctedSurname))) {
      const surname = correctedSurname ?? statedSurname;
      return { firstName, surname, name: `${firstName} ${surname}` };
    }
  }

  // Telegram renders phones and emails as Markdown links. Their labels are
  // contact data, while the transport markup must not make a valid leading
  // name/surname look like it is followed by arbitrary prose.
  const plain = text
    .replace(/\[([^\]]+)\]\((?:tel:|mailto:)[^)]+\)/giu, '$1')
    .replace(/(?:[,;.!?…]\s*)?(?:ya\s+te\s+(?:lo\s+)?dije|te\s+lo\s+dije)\s*[.!?…]*$/iu, '')
    .trim();
  const boundary = plain.search(new RegExp(`${EMAIL_PATTERN.source}|${DECLARED_PHONE_PATTERN.source}|[\\n,;.!?¿]`, 'u'));
  const candidate = (boundary < 0 ? plain : plain.slice(0, boundary)).trim();
  const remainder = boundary < 0 ? '' : plain.slice(boundary).replace(/^[\s,;.!]+/u, '');
  // A second possible identity is ambiguous. The permitted continuation is a
  // contact field, a question, or the study-goal answer requested alongside
  // one leading first-name token. Arbitrary prose never becomes a full name.
  const knownContinuation = new RegExp(
    `^(?:${EMAIL_PATTERN.source}|${DECLARED_PHONE_PATTERN.source}|¿|(?:[Yy]\\s+)?(?:[Cc]u[aá]nto|[Cc][oó]mo|[Qq]u[eé]|[Dd][oó]nde)\\b)`,
    'u',
  ).test(remainder);
  const requestedGoalContinuation = asksFirstName
    && !/\s/u.test(candidate)
    && /^(?:busco|me\s+interesa|quiero|quer[ií]a|necesito|para)\b/iu.test(remainder);
  if (remainder && !knownContinuation && !requestedGoalContinuation) return null;
  const contextualName = new RegExp(`^${CONTEXTUAL_NAME_SEQUENCE}$`, 'u');
  if (!contextualName.test(candidate) || !isPlausibleContextualName(candidate)
    || containsContextualNonNameToken(candidate)
    || /\b(?:o|y|si|sí|hola|gracias|dale|bueno|perfecto|quiero|curso|plan|pago|excel|marketing|digital|nombre|apellido)\b/iu.test(candidate)) return null;

  const normalizedCandidate = normalizeContextualName(candidate);

  let firstName = previous.firstName;
  let surname = previous.surname;
  if (asksFirstName && asksSurname) {
    const parts = splitFullName(normalizedCandidate);
    if (parts.apellido) {
      firstName = parts.nombre;
      surname = parts.apellido;
    } else if (!firstName) {
      firstName = normalizedCandidate;
    } else if (!surname) {
      surname = normalizedCandidate;
    } else {
      return null;
    }
  } else if (asksFirstName) firstName = normalizedCandidate;
  else surname = normalizedCandidate;

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

/** A number that can safely cross the call-provider boundary. */
export function isCallablePhoneE164V1(phone: string | null | undefined): boolean {
  const normalized = (phone ?? '').trim();
  return /^\+[1-9]\d{7,14}$/u.test(normalized)
    && !isSyntheticChannelPhoneV1(normalized);
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
  const channelPhone = isCallablePhoneE164V1(row.phone) ? row.phone : null;
  return {
    nombre: identity?.nombre || null,
    apellido: identity?.apellido || null,
    correo: row.email,
    telefono: isCallablePhoneE164V1(declared) ? declared : channelPhone,
  };
}
