// Deterministic heuristic: detects whether a message is trivial (greeting, short ack, thanks).
// Trivial turns still increment the counter but do NOT trigger summary regeneration (research D2).

const TRIVIAL_PHRASES = [
  'hola',
  'buenas',
  'buen dia',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'hi',
  'hello',
  'ok',
  'dale',
  'si',
  'sí',
  'no',
  'listo',
  'entendido',
  'gracias',
  'muchas gracias',
  'genial',
  'perfecto',
  'de nada',
  'np',
  'claro',
  'obvio',
  'eso',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[.!¡,;:]+$/g, '')
    .trim();
}

const NORMALIZED_TRIVIAL = TRIVIAL_PHRASES.map(normalize);

export function isTrivial(content: string): boolean {
  const normalized = normalize(content);

  // Exact match against known trivial phrases
  if (NORMALIZED_TRIVIAL.includes(normalized)) return true;

  // Short does not mean trivial. Messages such as "quiero comprar", "prefiero
  // noche" and "no me llames" are commercially meaningful and must be kept.
  return false;
}
