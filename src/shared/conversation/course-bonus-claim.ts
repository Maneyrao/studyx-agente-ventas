type CourseBonusClaimInspection = {
  readonly has_authorized_claim: boolean;
  readonly has_unauthorized_claim: boolean;
};

/**
 * Catalog identities are compared exactly after transport-only normalization.
 * Accents and words remain significant: an alias cannot become a catalog fact.
 */
function normalizeCanonicalText(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('es').replace(/\s+/gu, ' ').trim();
}

function hasWordBoundary(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) return true;
  return !/[\p{L}\p{N}_]/u.test(value[index]!);
}

type CatalogNameOccurrence = {
  readonly name: string;
  readonly start: number;
  readonly end: number;
};

function exactCanonicalNameOccurrences(segment: string, name: string): CatalogNameOccurrence[] {
  const occurrences: CatalogNameOccurrence[] = [];
  let cursor = 0;
  while (cursor <= segment.length - name.length) {
    const index = segment.indexOf(name, cursor);
    if (index < 0) break;
    const before = index - 1;
    const after = index + name.length;
    if (hasWordBoundary(segment, before) && hasWordBoundary(segment, after)) {
      occurrences.push({ name, start: index, end: after });
    }
    cursor = index + 1;
  }
  return occurrences;
}

function mentionedCanonicalNames(segment: string, catalogNames: readonly string[]): string[] {
  const occurrences = catalogNames
    .flatMap((name) => exactCanonicalNameOccurrences(segment, name))
    .sort((left, right) => (
      (right.end - right.start) - (left.end - left.start)
      || left.start - right.start
    ));
  const selected: CatalogNameOccurrence[] = [];
  for (const occurrence of occurrences) {
    const overlaps = selected.some((item) => (
      occurrence.start < item.end && occurrence.end > item.start
    ));
    if (!overlaps) selected.push(occurrence);
  }
  return [...new Set(selected.map((item) => item.name))];
}

/**
 * These are the three structural labels authorized by the egress contract.
 * This is deliberately not a vocabulary of sales phrases or inferred intent.
 */
const BONUS_EFFECT_MARKER = /\b(?:sin\s+costo|incluid[oa]s?|bonificad[oa]s?)\b/u;

/**
 * Fact/effect validation only.
 *
 * A punctuation-delimited segment that labels courses as included/bonified
 * may name only:
 * - bonus courses already delivered in the active package; and
 * - the single bonus course structurally authorized for the current turn.
 *
 * Callers provide that capability through authorized_bonus_names. Paid course
 * names are accepted only when the same segment recaps at least one authorized
 * bonus; a paid course by itself is never treated as a free course.
 */
export function inspectCourseBonusClaimsV1(input: {
  readonly content: string;
  readonly authorized_bonus_names: readonly string[];
  readonly known_offering_names?: readonly string[];
  readonly paid_offering_names?: readonly string[];
}): CourseBonusClaimInspection {
  const authorizedNames = new Set(input.authorized_bonus_names.map(normalizeCanonicalText));
  const paidNames = new Set((input.paid_offering_names ?? []).map(normalizeCanonicalText));
  const catalogNames = [...new Set((input.known_offering_names ?? [])
    .map(normalizeCanonicalText)
    .filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  let hasAuthorizedClaim = false;
  let hasUnauthorizedClaim = false;

  const segments = input.content
    .split(/[.!?;\n]+/u)
    .map(normalizeCanonicalText);
  for (const segment of segments) {
    if (!BONUS_EFFECT_MARKER.test(segment)) continue;

    const mentionedNames = mentionedCanonicalNames(segment, catalogNames);
    if (mentionedNames.length === 0) continue;

    const authorizedMentioned = mentionedNames.filter((name) => authorizedNames.has(name));
    const paidMentioned = mentionedNames.filter((name) => paidNames.has(name));
    const foreignMentioned = mentionedNames.filter(
      (name) => !authorizedNames.has(name) && !paidNames.has(name),
    );

    if (authorizedMentioned.length > 0) hasAuthorizedClaim = true;
    if (foreignMentioned.length > 0) hasUnauthorizedClaim = true;

    // A package recap may list the paid course together with delivered
    // bonuses. The paid course alone cannot be asserted as included/free.
    if (paidMentioned.length > 0 && authorizedMentioned.length === 0) {
      hasUnauthorizedClaim = true;
    }
  }

  return {
    has_authorized_claim: hasAuthorizedClaim,
    has_unauthorized_claim: hasUnauthorizedClaim,
  };
}

function foldAccentsAndCase(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').replace(/\s+/gu, ' ').trim();
}

/**
 * An offer_course_bonus effect is only real if the customer-visible copy names
 * the bonus course by its canonical display_name (accents/case folded, whole
 * words). Catalog identities have no short aliases: the same exact-name rule
 * as `inspectCourseBonusClaimsV1` applies.
 */
export function copyNamesCourseV1(copy: string, displayName: string): boolean {
  const name = foldAccentsAndCase(displayName);
  if (!name) return false;
  return exactCanonicalNameOccurrences(foldAccentsAndCase(copy), name).length > 0;
}
