/** P:230/236: validate access facts and prerequisites, not a suggestion script. */

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

const PASSWORD = /\b(?:contrasena|password|clave)\b/u;
const CHANGE = /\b(?:cambia(?:r|s)?|actualiza(?:r|s)?|modifica(?:r|s)?)\b/u;
const CHOICE = /\bsi\s+(?:(?:vos|tu)\s+)?(?:queres|quieres|deseas|preferis|prefieres|te\s+(?:resulta|apetece|gusta))\b/u;

export function assertsRequiredPasswordChangeV1(text: string): boolean {
  const clauses = normalized(text).split(/[.!?;\n]|\bpero\b|\bsin embargo\b/u);
  return clauses.some((clause, index) => {
    if (!PASSWORD.test(clause)) return false;
    for (const match of clause.matchAll(/\b(?:debes|deberias|tenes que|tienes que|hay que|necesitas|obligatori[oa]|necesari[oa]|imprescindible)\b/gu)) {
      if (!/\b(?:no|nunca|tampoco)\s+(?:(?:es|sera|resulta)\s+)?$/u.test(clause.slice(0, match.index))) return true;
    }
    const change = CHANGE.exec(clause);
    if (!change) return false;
    const before = clause.slice(0, change.index);
    const after = clause.slice(change.index + change[0].length);
    const choiceGovernsChange = (CHOICE.test(before) && !/\b(?:entrar|ingresar|acceder)\b/u.test(before))
      || CHOICE.test(after.split(',').slice(1).join(','));
    const permittedChange = /\b(?:podes|puedes|podrias)\s*$/u.test(before);
    const explicitlyOptional = /\bopcional\b/u.test(clause)
      || /^\s*(?:es|el cambio es)\s+opcional\s*$/u.test(clauses[index + 1] ?? '');
    const deniedRequirement = /\bno\s+(?:hace falta|hay que|necesitas|tenes que|tienes que|debes)\b/u.test(clause);
    if (choiceGovernsChange || permittedChange || explicitlyOptional || deniedRequirement) return false;
    return /\b(?:para (?:poder )?(?:entrar|ingresar|acceder)|antes de (?:entrar|ingresar|acceder))\b/u.test(clause)
      || /^\s*(?:cambia|actualiza|modifica)\s+(?:tu|la)\s+(?:contrasena|clave|password)\b/u.test(clause);
  });
}

export function assertsModelCredentialValueV1(text: string): boolean {
  const value = normalized(text);
  const assignment = [...value.matchAll(/\b(?:usuario|contrasena|password|clave)(?:\s+(?:temporal|inicial|de acceso))?\s*(?::|=|es\b|sera\b)\s*\S/gu)]
    .some(match => !/\b(?:cambio|modificacion|actualizacion)\s+de\s+(?:(?:la|tu)\s+)?$/u.test(value.slice(0, match.index)));
  return assignment
    || /\b(?:ingresa|entra|accede)\s+con\s+(?:(?:tu|la|el)\s+)?(?:clave|contrasena|password|usuario)\s+\S/u.test(value)
    || /\b(?:usa|utiliza)\s+\S+(?:\s+\S+){0,3}\s+como\s+(?:tu\s+|la\s+)?(?:contrasena|clave|password)\b/u.test(value);
}

export function assertsUnverifiedPostSaleAccessV1(input: {
  readonly text: string;
  readonly access_ready: boolean;
  readonly activated_course_names: readonly string[];
  readonly known_course_names: readonly string[];
}): boolean {
  const activated = new Set(input.activated_course_names.map(normalized));
  const names = [...new Set([...input.known_course_names, ...input.activated_course_names].map(normalized))]
    .sort((a, b) => b.length - a.length);
  const knownPrefix = (target: string) => names.find(name => target === name || target.startsWith(`${name} `) || target.startsWith(`${name},`));
  const authorizedArgument = (value: string): boolean => {
    const target = value.trim().replace(/^(?:(?:a|al|en|el|la|los|las|tu|tus|su|sus|de|del)\s+)+/u, '');
    const name = knownPrefix(target);
    if (name) {
      if (!activated.has(name)) return false;
      // A coordinated course is another factual argument. Other following
      // conversation is outside this fact and is preserved byte-for-byte.
      const next = target.slice(name.length).trim().match(/^(?:y|e)\s+(.+)/u)?.[1];
      return !next || authorizedArgument(next);
    }
    if (/^(?:campus(?: virtual)?|plataforma|cuenta|studyx|curso(?: principal)?|cursos|formacion|inscripcion)$/u.test(target)) return true;
    if (/^(?:acceso|campus(?: virtual)?|plataforma|cuenta)\b/u.test(target)) {
      const destination = target.match(/\b(?:a|al|en)\s+(.+)/u)?.[1];
      return destination ? authorizedArgument(destination) : true;
    }
    return false;
  };
  // Separate predicates from adjacent conversation; never authorize an entire
  // sentence by its wording or reject a suffix such as ", disfrutalo".
  const clauses = input.text.split(/[.!?;,\n]|\bpero\b|\bsin embargo\b|\by\s+(?=(?:tu|tus|el|la|ya|no|todavia|aun|podes|puedes|estas)\b)/iu);
  return clauses.some(part => {
    const clause = normalized(part);
    const claims = clause.matchAll(/\b(?:(?:tenes|tienes)\s+acceso|(?:podes|puedes)\s+(?:ingresar|entrar|acceder)|(?:estas?|estan|quedo|quedaron|se encuentra)\s+(?:ya\s+)?(?:habilitad[oa]s?|activ[oa]s?|inscrit[oa]s?|inscript[oa]s?|matriculad[oa]s?)|habilitad[oa]s?|habilite|active|inscribi)\b/gu);
    for (const claim of claims) {
      const before = clause.slice(0, claim.index);
      const negated = /\b(?:no|aun no|todavia no)\s+(?:se\s+)?(?:(?:encuentra|encuentran|esta|estan|quedo|quedaron)\s+)?$/u.test(before);
      if (negated) continue;
      if (!input.access_ready) return true;
      const after = clause.slice(claim.index + claim[0].length).trim();
      const destination = after.match(/^(?:a|al|en)\s+(.+)/u)?.[1];
      if (destination && !authorizedArgument(destination)) return true;
      if (/^(?:habilite|active|inscribi)$/u.test(claim[0]) && after && !authorizedArgument(after)) return true;
      if (/^(?:estas?|estan|quedo|quedaron|se encuentra|habilitad)/u.test(claim[0])) {
        const subject = before.replace(/\b(?:ya|todavia|aun)\s*$/u, '').trim();
        // Personal subject "ya estás inscripto" is backed by this source; a
        // named course subject must itself be part of verified fulfillment.
        if (subject && !/^(?:ya|tu|vos|usted)$/u.test(subject) && !authorizedArgument(subject)) return true;
        if (!subject && !destination && after && !authorizedArgument(after)) return true;
      }
    }
    return false;
  });
}
