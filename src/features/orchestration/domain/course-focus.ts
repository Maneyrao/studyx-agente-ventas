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
  const latest = recentTurns.findLast((turn) => turn.direction === 'outbound');
  return latest ? [latest.content] : [];
}

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
  return deriveCourseSelection({
    ...input,
    current: resolveCatalogFromSnapshot(input.currentMessageTexts, input.catalogIndex,
      latestAgentTurnMessages(input.recentTurns)),
  });
}
export { activeSessionRecentTurns as activeSessionRecentTurnsV1 };
