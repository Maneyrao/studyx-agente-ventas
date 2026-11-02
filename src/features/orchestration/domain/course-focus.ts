import type { CatalogIndexView } from './business-context';
import { isCatalogRequestNeutral, resolveCatalogRequest, type CatalogResolution } from './catalog-resolution';
import type { BatchMessage, RecentTurn } from '../ports/orchestration-store';

/** Server-owned dialogue identity, not a purchase selection or an effect permission. */
export type CourseFocusTurnV1 = Pick<RecentTurn, 'direction' | 'content'>;

export function resolveCatalogFromSnapshot(
  messageTexts: readonly string[],
  catalogIndex: CatalogIndexView | null,
  contextualMessages: readonly string[] = [],
): CatalogResolution {
  return resolveCatalogRequest(
    messageTexts,
    catalogIndex === null
      ? null
      : {
          offerings: catalogIndex.offerings,
          offerings_truncated: Math.max(0, catalogIndex.offerings_total - catalogIndex.offerings.length),
        },
    { contextualMessages },
  );
}

export function latestAgentTurnMessages(recentTurns: readonly CourseFocusTurnV1[]): string[] {
  const latest = [...recentTurns].reverse().find((turn) => turn.direction === 'outbound');
  return latest ? [latest.content] : [];
}

export interface FactualCourseReferenceV1 {
  readonly offeringCode: string;
  readonly source: 'prior_agent_named_candidate' | 'current_customer_named_course';
  readonly matchedTerms: readonly string[];
}

/** Retrieve current literal course references from the complete active index.
 * Full names/owner aliases/codes and unambiguous code+name terms retrieve facts
 * only. They do not become aliases, purchase selections or effect permissions.
 * Prior named options retain their existing bounded-reference compatibility.
 */
export function currentFactualCourseReferencesV1(
  texts: readonly string[], index: CatalogIndexView | null, previousAgentMessages: readonly string[],
): FactualCourseReferenceV1[] {
  if (!index || index.offerings_total > index.offerings.length) return [];
  const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
  const previous = ` ${normalized(previousAgentMessages.join(' '))} `;
  const clauses = texts.flatMap(text => text.split(/[,.;:!?\n]+|\b(?:pero|prefiero|mejor|aunque)\b/iu))
    .map(clause => normalized(clause).split(' ').filter(Boolean)).filter(clause => clause.length > 0);
  const genericTerms = new Set(['curso', 'cursos', 'diplomado', 'diplomados', 'introduccion', 'especialista',
    'formacion', 'capacitacion', 'programa', 'profesional', 'integral', 'digital', 'sociales',
    ...index.offerings.flatMap(offering => normalized(offering.academy ?? '').split(' '))]);
  const references = new Map<string, Set<string>>();
  const addReference = (value: string, code: string) => {
    const key = normalized(value);
    if (key.length < 3) return;
    const codes = references.get(key) ?? new Set<string>();
    codes.add(code);
    references.set(key, codes);
  };
  for (const offering of index.offerings) {
    addReference(offering.display_name, offering.code);
    addReference(offering.code, offering.code);
    for (const alias of offering.aliases ?? []) addReference(alias, offering.code);
    const nameTerms = new Set(normalized(offering.display_name).split(' '));
    for (const term of new Set(normalized(offering.code).split(' '))) {
      if (term.length >= 3 && !genericTerms.has(term) && nameTerms.has(term)) addReference(term, offering.code);
    }
  }
  const result = new Map<string, FactualCourseReferenceV1 & { position: number }>();
  const negatedPositions = new Map<string, Set<number>>();
  let offset = 0;
  for (const clause of clauses) {
    const hits: Array<{ key: string; codes: Set<string>; start: number; end: number }> = [];
    for (const [key, codes] of references) {
      const words = key.split(' ');
      for (let start = 0; start + words.length <= clause.length; start += 1) {
        if (!words.every((word, part) => clause[start + part] === word)) continue;
        hits.push({ key, codes, start, end: start + words.length });
      }
    }
    const ambiguous = hits.filter(hit => hit.codes.size > 1);
    const negated = hits.filter(hit => clause.slice(Math.max(0, hit.start - 4), hit.start)
      .some(word => NEGATION_WORDS.has(word)) || clause[hit.end] === 'no');
    // A complete negated name vetoes its own shorter terms as well. Otherwise
    // the final token could escape the prefix window and revive that course.
    for (const hit of negated) for (const code of hit.codes) {
      const blocked = negatedPositions.get(code) ?? new Set<number>();
      for (let at = hit.start; at < hit.end; at += 1) blocked.add(offset + at);
      negatedPositions.set(code, blocked);
    }
    for (const hit of hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))) {
      if (hit.codes.size !== 1 || ambiguous.some(other => hit.start >= other.start && hit.end <= other.end)) continue;
      const code = [...hit.codes][0]!;
      if (negated.some(other => other.codes.has(code) && hit.start >= other.start && hit.end <= other.end)) continue;
      if (result.has(code)) continue;
      const offering = index.offerings.find(course => course.code === code)!;
      const priorNamed = previous.includes(` ${normalized(offering.display_name)} `);
      const matchedTerms = hit.key.split(' ').filter(term => term.length >= 3).slice(0, 8);
      if (!matchedTerms.length) continue;
      result.set(code, { offeringCode: code,
        source: priorNamed ? 'prior_agent_named_candidate' : 'current_customer_named_course',
        matchedTerms, position: offset + hit.start });
    }
    offset += clause.length;
  }
  // Existing prior-menu references may use a shared short term. Keep their
  // bounded multi-candidate semantics; they still cannot choose a purchase.
  const positiveTerms = new Map<string, number[]>();
  offset = 0;
  for (const clause of clauses) {
    clause.forEach((word, at) => {
      if (!clause.slice(Math.max(0, at - 4), at).some(term => NEGATION_WORDS.has(term))
        && clause[at + 1] !== 'no') positiveTerms.set(word, [...(positiveTerms.get(word) ?? []), offset + at]);
    });
    offset += clause.length;
  }
  for (const offering of index.offerings) {
    if (result.has(offering.code) || !previous.includes(` ${normalized(offering.display_name)} `)) continue;
    const nameTerms = new Set(normalized(offering.display_name).split(' '));
    const matches = [...new Set(normalized(offering.code).split(' '))]
      .filter(term => term.length >= 3 && nameTerms.has(term))
      .flatMap(term => {
        const position = positiveTerms.get(term)?.find(at => !negatedPositions.get(offering.code)?.has(at));
        return position === undefined ? [] : [{ term, position }];
      });
    if (matches.length) result.set(offering.code, { offeringCode: offering.code,
      source: 'prior_agent_named_candidate', matchedTerms: matches.map(match => match.term).slice(0, 8),
      position: Math.min(...matches.map(match => match.position)) });
  }
  // A neutral follow-up such as "me parece caro" contains no course token,
  // but the immediately preceding answer can still establish one factual
  // subject. Hydrate facts and validate mentions only when that answer names
  // exactly one full canonical course. This never persists a sale selection
  // or authorizes an effect.
  if (result.size === 0) {
    const priorCanonical = index.offerings.filter(offering =>
      previous.includes(` ${normalized(offering.display_name)} `));
    if (priorCanonical.length === 1) {
      const offering = priorCanonical[0]!;
      result.set(offering.code, {
        offeringCode: offering.code,
        source: 'prior_agent_named_candidate',
        matchedTerms: normalized(offering.display_name).split(' ').filter(term => term.length >= 3).slice(0, 8),
        position: offset,
      });
    }
  }
  return [...result.values()].sort((a, b) => a.position - b.position).slice(0, 3)
    .map(({ offeringCode, source, matchedTerms }) => ({ offeringCode, source, matchedTerms }));
}

const NEGATION_WORDS = new Set(['no', 'ni', 'nada', 'sin', 'tampoco', 'nunca']);

function previousAgentTurnMessages(
  recentTurns: readonly CourseFocusTurnV1[],
  beforeIndex: number,
): string[] {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index]!;
    if (turn.direction === 'outbound') return [turn.content];
  }
  return [];
}

/**
 * Course state is derived, never guessed or persisted in a second state
 * machine. The current batch wins. Only when it contains no catalog intent do
 * we walk recent inbound turns backwards; an ambiguous, missing or unavailable
 * newer request deliberately clears an older course instead of reviving it.
 */
export function deriveCourseSelection(input: {
  current: CatalogResolution;
  currentMessageTexts: readonly string[];
  recentTurns: readonly CourseFocusTurnV1[];
  catalogIndex: CatalogIndexView | null;
}): { readonly course_of_interest: string | null; readonly offering_code: string | null } {
  if (input.current.kind === 'exact') {
    return {
      course_of_interest: input.current.displayName,
      offering_code: input.current.offeringCode,
    };
  }
  if (
    input.current.kind !== 'no_catalog_intent'
    || !isCatalogRequestNeutral(input.currentMessageTexts)
    || input.catalogIndex === null
  ) {
    return { course_of_interest: null, offering_code: null };
  }

  for (let index = input.recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = input.recentTurns[index]!;
    if (turn.direction !== 'inbound') continue;
    const historical = resolveCatalogFromSnapshot(
      [turn.content],
      input.catalogIndex,
      previousAgentTurnMessages(input.recentTurns, index),
    );
    if (historical.kind === 'no_catalog_intent') {
      if (isCatalogRequestNeutral(turn.content)) continue;
      return { course_of_interest: null, offering_code: null };
    }
    if (historical.kind === 'exact') {
      return {
        course_of_interest: historical.displayName,
        offering_code: historical.offeringCode,
      };
    }
    return { course_of_interest: null, offering_code: null };
  }
  return { course_of_interest: null, offering_code: null };
}

/**
 * Recent turns are short-term dialogue, not durable memory. Keep only the
 * contiguous suffix that belongs to the current session; summaries, selected
 * memories and commercial state remain available through their own fields.
 */
export function activeSessionRecentTurns(
  recentTurns: readonly RecentTurn[],
  batchMessages: readonly Pick<BatchMessage, 'created_at'>[],
  sessionIdleMs: number,
): RecentTurn[] {
  const batchStartMs = Math.min(...batchMessages.map((message) => Date.parse(message.created_at)));
  if (!Number.isFinite(batchStartMs)) return [...recentTurns];

  const active: RecentTurn[] = [];
  let nextMessageMs = batchStartMs;
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index]!;
    const turnMs = Date.parse(turn.created_at);
    if (!Number.isFinite(turnMs) || turnMs > nextMessageMs) continue;
    if (nextMessageMs - turnMs > sessionIdleMs) break;
    active.unshift(turn);
    nextMessageMs = turnMs;
  }
  return active;
}

/** Reuse exactly the claim resolver for mention validation; caller supplies bounded server history. */
export function deriveConversationCourseFocusV1(input: {
  readonly currentMessageTexts: readonly string[];
  readonly recentTurns: readonly CourseFocusTurnV1[];
  readonly catalogIndex: CatalogIndexView | null;
}): { readonly course_of_interest: string | null; readonly offering_code: string | null } {
  const previousAgentMessages = latestAgentTurnMessages(input.recentTurns);
  const current = resolveCatalogFromSnapshot(input.currentMessageTexts, input.catalogIndex, previousAgentMessages);
  const focus = deriveCourseSelection({ ...input, current });
  if (focus.offering_code !== null || !['no_catalog_intent', 'not_found'].includes(current.kind)) return focus;
  // Same projector as the generation context: a single positive reference to a
  // current literal course reference is the course under discussion for mention
  // validation only. It never persists a selection or authorizes effects.
  const references = currentFactualCourseReferencesV1(input.currentMessageTexts, input.catalogIndex, previousAgentMessages);
  const only = references.length === 1
    ? input.catalogIndex?.offerings.find(offering => offering.code === references[0].offeringCode) : undefined;
  return only ? { course_of_interest: only.display_name, offering_code: only.code } : focus;
}
export { activeSessionRecentTurns as activeSessionRecentTurnsV1 };
