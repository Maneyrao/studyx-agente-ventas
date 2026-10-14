import {
  buildAuthorizedEgress,
  protectedFactsInContentV1,
  type AuthorizedEgressV1,
} from '@/features/orchestration/domain/egress-guard';

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Authorizes only an availability assertion whose subject is the active canonical course. */
export function buildPostCallNarrativeEgress(
  content: string,
  selectedCourse: { readonly name: string } | null,
): AuthorizedEgressV1 {
  const protectedFacts = protectedFactsInContentV1(content).filter((fact) => {
    if (fact.kind !== 'offering' || !selectedCourse) return false;
    const availability = /^(?:el\s+)?curso(?:\s+de)?\s+(.+?)\s+est[aá]\s+disponible$/u.exec(fact.value);
    return availability !== null && normalized(availability[1]) === normalized(selectedCourse.name);
  });
  return buildAuthorizedEgress({ content, authorized_urls: [], protected_facts: protectedFacts });
}
