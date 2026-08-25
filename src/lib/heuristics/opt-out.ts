const HARD_OPT_OUT_PATTERNS = [
  /\b(?:dame|denme|darme)\s+de\s+baja\b/u,
  /\b(?:sacame|saquenme|sacenme|borrame|borrenme|quitame|quitenme|eliminame|eliminenme)\s+de\s+la\s+lista\b/u,
  /\bdesuscrib(?:ime|anme)\b/u,
  /^(?:stop|baja|desuscribir|unsubscribe)$/u,
];

const SCOPED_CONTACT_PATTERNS = [
  /\bno\s+me\s+(?:contactes|contacten)\s+por\s+(?:telefono|llamada)\b/u,
  /\bno\s+me\s+escrib(?:as|an)\s+(?:hoy|ahora|esta\s+semana)\b/u,
  /\bno\s+me\s+(?:mandes|manden|envies|envien)\s+mas\s+mensajes\s+(?:de|sobre)\b/u,
  /\bno\s+quiero\s+(?:recibir\s+)?(?:mas\s+)?promociones\b/u,
];

const GENERAL_OPT_OUT_PATTERNS = [
  /\b(?:no|nunca)\s+me\s+(?:escribas|escriban|contactes|contacten)\b/u,
  /\bno\s+quiero\s+que\s+me\s+(?:escribas|escriban|contactes|contacten)\s+mas\b/u,
  /\bno\s+me\s+(?:hablen|escriban)\s+mas\b/u,
  // "no me mandes" only revokes consent when its object is messaging in
  // general ("mensajes", "nada más"). "No me mandes el link todavía" is a
  // deferral of ONE artifact, not an opt-out (P0, informe 2026-08-23).
  /\b(?:no|nunca)\s+me\s+(?:mandes|manden|envies|envien)\s+(?:mas\s+)?(?:mensajes|nada(?:\s+mas)?)\b/u,
  /\bno\s+quiero\s+(?:recibir\s+)?(?:mas\s+)?(?:mensajes|contacto)\b/u,
  /\b(?:deja|dejen|paren|para)\s+de\s+(?:escribirme|contactarme|mandarme\s+mensajes)\b/u,
  /\b(?:paren|corten)\s+(?:los\s+)?mensajes\b/u,
  /\bquiero\s+dejar\s+de\s+recibir\s+(?:mensajes|comunicaciones)\b/u,
  /\bno\s+deseo\s+recibir\s+(?:mas\s+)?(?:mensajes|comunicaciones)\b/u,
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
  if (HARD_OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const explicitlyPermanent = /\b(?:nunca\s+mas|para\s+siempre|definitivamente)\b/u.test(normalized);
  if (!explicitlyPermanent && SCOPED_CONTACT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return GENERAL_OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}
