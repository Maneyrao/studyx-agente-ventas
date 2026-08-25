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

function isPlausibleName(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/u);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-ZÁÉÍÓÚÜÑ]/u.test(token));
}

export function extractContactIdentity(text: string): CapturedContactIdentity {
  const email = EMAIL_PATTERN.exec(text)?.[0] ?? null;

  let name: string | null = null;
  const introduced = INTRODUCED_NAME_PATTERN.exec(text);
  if (introduced && isPlausibleName(introduced[1])) {
    name = introduced[1].trim();
  } else if (email) {
    const leading = LEADING_NAME_BEFORE_EMAIL_PATTERN.exec(text);
    if (leading && isPlausibleName(leading[1])) name = leading[1].trim();
  }

  return { name, email };
}

/**
 * Operator-facing split for the Sheets projection: first token is `nombre`,
 * the remainder is `apellido` (compound surnames like "Le Blanc" stay whole).
 */
export function splitFullName(fullName: string): { nombre: string; apellido: string } {
  const tokens = fullName.trim().split(/\s+/u);
  return { nombre: tokens[0] ?? '', apellido: tokens.slice(1).join(' ') };
}
