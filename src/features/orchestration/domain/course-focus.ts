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
  readonly source: 'prior_agent_named_candidate';
  readonly matchedTerms: readonly string[];
}

/** Retrieve facts for an option the agent actually named and the customer
 * refers to literally. A partial reference is not a selection or an alias.
 * Identity/selection resolution deliberately keeps its stricter contract.
 */
export function currentFactualCourseReferencesV1(
  texts: readonly string[], index: CatalogIndexView | null, previousAgentMessages: readonly string[],
): FactualCourseReferenceV1[] {
  if (!index || index.offerings_total > index.offerings.length) return [];
  const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
  const previous = ` ${normalized(previousAgentMessages.join(' '))} `;
  // A rejected option is still a literal mention, never a reference to hydrate:
  // "no me gusta ecommerce", "nada de ecommerce", "ecommerce no, prefiero X".
  const clauses = texts.flatMap(text => text.split(/[,.;:!?\n]+|\b(?:pero|prefiero|mejor|aunque)\b/iu))
    .map(clause => normalized(clause).split(' ').filter(Boolean)).filter(clause => clause.length > 0);
  const negated = (clause: readonly string[], at: number) =>
    clause.slice(Math.max(0, at - 4), at).some(word => NEGATION_WORDS.has(word)) || clause[at + 1] === 'no';
  const positiveTerms = new Map<string, number>();
  let offset = 0;
  for (const clause of clauses) {
    clause.forEach((word, at) => {
      if (!negated(clause, at) && !positiveTerms.has(word)) positiveTerms.set(word, offset + at);
    });
    offset += clause.length;
  }
  return index.offerings.flatMap(offering => {
    const name = normalized(offering.display_name);
    if (!name || previous.indexOf(` ${name} `) < 0) return [];
    const nameTerms = new Set(name.split(' '));
    const matchedTerms = [...new Set(normalized(offering.code).split(' '))]
      .filter(term => term.length >= 3 && nameTerms.has(term) && positiveTerms.has(term));
    const position = Math.min(...matchedTerms.map(term => positiveTerms.get(term)!));
    return matchedTerms.length ? [{ offeringCode: offering.code,
      source: 'prior_agent_named_candidate' as const, matchedTerms: matchedTerms.slice(0, 8), position }] : [];
  }).sort((a, b) => a.position - b.position).slice(0, 3)
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
  if (focus.offering_code !== null || current.kind !== 'no_catalog_intent') return focus;
  // Same projector as the generation context: a single positive reference to a
  // course the agent just named is the course under discussion for mention
  // validation only. It never persists a selection or authorizes effects.
  const references = currentFactualCourseReferencesV1(input.currentMessageTexts, input.catalogIndex, previousAgentMessages);
  const only = references.length === 1
    ? input.catalogIndex?.offerings.find(offering => offering.code === references[0].offeringCode) : undefined;
  return only ? { course_of_interest: only.display_name, offering_code: only.code } : focus;
}
export { activeSessionRecentTurns as activeSessionRecentTurnsV1 };
