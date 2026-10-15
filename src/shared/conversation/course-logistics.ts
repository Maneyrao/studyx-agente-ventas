/** Shared factual detection. Online alone never authorizes timing or flexibility. */
export type CourseLogisticsFactV1 =
  | 'access_24_7'
  | 'open_ended'
  | 'access_duration'
  | 'live_classes'
  | 'recorded_classes'
  | 'class_frequency'
  | 'unrestricted_access'
  | 'self_paced'
  | 'remote_location';

const COURSE_LOGISTICS_PATTERNS: Readonly<Record<CourseLogisticsFactV1, RegExp>> = {
  access_24_7: /\b24\s*\/\s*7\b/u,
  open_ended: /\b(?:sin\s+(?:una\s+)?fecha\s+fija|no\s+hay\s+presion\s+de\s+terminar)\b/u,
  access_duration: /\b(?:plataforma|acceso)\b[^.!?\n]{0,48}\b(?:varios?|algunos?|\d+)\s+mes(?:es)?\b/u,
  live_classes: /\bclases?\s+en\s+vivo\b/u,
  recorded_classes: /\b(?:clases?\s+en\s+vivo[^.!?\n]{0,48})?(?:queda|quedan)\s+grabad[ao]s?\b|\bclases?\s+grabad[ao]s?\b/u,
  class_frequency: /\bclases?[^.!?\n]{0,32}\b(?:semanal(?:es)?|cada\s+semana)\b|\b(?:semanal(?:es)?|cada\s+semana)\b[^.!?\n]{0,32}\bclases?\b/u,
  unrestricted_access: /\b(?:acceso|plataforma|acced(?:e|er|es|en)|entr(?:a|ar|as))\b[^.!?\n]{0,48}\b(?:cuando\s+quieras|a\s+cualquier\s+hora|cuando\s+te\s+quede\s+comodo)\b/u,
  self_paced: /\ba\s+tu\s+ritmo\b/u,
  remote_location: /\b(?:desde\s+donde\s+estes|desde\s+cualquier\s+lugar)\b/u,
};

export function courseLogisticsInV1(text: string): CourseLogisticsFactV1[] {
  const normalized = text.normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es');
  const clauses = normalized.split(/[.!?;,\n]|\b(?:pero|aunque|sin embargo)\b|\by\s+(?=(?:lo|las|los|tienes|tenes|puedes|podes|haces)\b)/u);
  // Uncertainty is not an affirmative promise. Scope it to its clause so a
  // later assertion cannot borrow an earlier disclaimer as authorization.
  const unknownPrefix = /^\s*no\s+(?:(?:tengo|tenemos|esta|estan)\s+confirmad[oa]s?\s+si|(?:te\s+)?(?:puedo|podemos)\s+(?:confirmar|asegurar|garantizar)\s+(?:si|que)|(?:se|sabemos)\s+si)\b/u;
  return (Object.entries(COURSE_LOGISTICS_PATTERNS) as Array<[CourseLogisticsFactV1, RegExp]>)
    .filter(([, pattern]) => clauses.some(clause => {
      const match = pattern.exec(clause);
      if (match === null) return false;
      const prefix = clause.slice(0, match.index);
      return !unknownPrefix.test(prefix) || /\by\b/u.test(prefix);
    }))
    .map(([kind]) => kind);
}

