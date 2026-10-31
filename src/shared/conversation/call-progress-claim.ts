/** A reservation is not evidence that the provider started calling (P:212/236). */
export function claimsUnverifiedCallProgressV1(text: string, status?: string | null): boolean {
  if (status === 'in_progress') return false;
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
  return (normalized.match(/[^.!?;\n]+/gu) ?? []).some(clause => {
    const claims = clause.matchAll(/\b(?:(?:ya\s+)?(?:te\s+)?(?:estamos|estan|esta)\s+(?:llamando|comunicandose)|(?:la\s+)?(?:asesora|llamada)\s+(?:ya\s+)?(?:esta\s+(?:en\s+curso|conectada|llamando)|intenta\s+comunicarse)|(?:tu\s+)?telefono\s+(?:ya\s+)?(?:esta\s+)?sonando)\b/giu);
    return [...claims].some(match => {
      if (status === 'provider_accepted' && !/conectada|en\s+curso|sonando/iu.test(match[0])) return false;
      return !/\b(?:no|nunca|todav[ií]a no|a[uú]n no)\s*$/iu.test(clause.slice(0, match.index));
    });
  });
}
