const OPT_OUT_PATTERNS = [
  /\b(?:dame|denme|darme)\s+de\s+baja\b/u,
  /\b(?:no|nunca)\s+me\s+(?:escribas|escriban|contactes|contacten|mandes|manden)\b/u,
  /\bno\s+quiero\s+(?:recibir\s+)?(?:mas\s+)?(?:mensajes|contacto)\b/u,
  /\b(?:deja|paren|para)\s+de\s+(?:escribirme|contactarme|mandarme\s+mensajes)\b/u,
  /^(?:stop|baja|desuscribir|unsubscribe)$/u,
];

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Deliberately excludes commercial rejection such as "no quiero comprar"
// and channel-specific call refusal such as "no me llames". Opt-out means no
// further written contact, not merely a lost opportunity or a switch from
// voice to WhatsApp.
export function isExplicitOptOut(text: string): boolean {
  const normalized = normalize(text);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}
