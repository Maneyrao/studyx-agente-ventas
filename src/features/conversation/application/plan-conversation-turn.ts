import { createHash } from 'node:crypto';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';
import type {
  CanonicalFactRefV1,
  ConversationMoveV1,
  TurnPlanV1,
} from '../domain/conversation-pipeline';
import {
  canonicalReferenceKey,
  createDefaultConversationStateV1,
  planConversationTurn,
  type PlanningBusinessContextV1,
} from '../domain/conversation-planner';
import {
  buildCanonicalFactRegistry,
  materializeCanonicalFactRequests,
} from '../domain/canonical-fact-registry';

export interface AuthoritativeConversationPlanV1 {
  readonly plan: TurnPlanV1;
  readonly fact_refs: readonly CanonicalFactRefV1[];
  readonly state_version: number;
  readonly plan_hash: string;
}

export interface AuthoritativeConversationPlanInputV1 {
  readonly turn: {
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
  };
  readonly workspace_slug: string;
  readonly move: ConversationMoveV1;
  readonly business_context: BusinessContextView | null;
  readonly catalog_index: CatalogIndexView | null;
}

export interface AuthoritativeConversationPlanDependenciesV1 {
  readonly state_store: Pick<ConversationStateStoreV1, 'load'>;
}

export function buildPlanningBusinessContextV1(
  business: BusinessContextView | null,
  catalog: CatalogIndexView | null,
): PlanningBusinessContextV1 {
  const areas = new Map<string, string>();
  const offerings = (catalog?.offerings ?? []).map((offering) => {
    const areaCode = offering.academy
      ? canonicalReferenceKey(offering.academy).split(' ').join('-')
      : null;
    if (areaCode && offering.academy) areas.set(areaCode, offering.academy);
    return {
      code: offering.code,
      display_name: offering.display_name,
      area_code: areaCode,
      aliases: offering.aliases,
    };
  });
  return {
    catalog_available: business !== null && catalog !== null,
    areas: [...areas].map(([code, display_name]) => ({ code, display_name })),
    offerings,
    payment_plans: (business?.workspace.payment_options ?? []).map((option) => option.code),
  };
}

function planHash(input: {
  readonly turn: AuthoritativeConversationPlanInputV1['turn'];
  readonly state_version: number;
  readonly business_as_of: string | null;
  readonly catalog_as_of: string | null;
  readonly plan: TurnPlanV1;
  readonly fact_refs: readonly CanonicalFactRefV1[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/**
 * Backend authority boundary. The interpreter contributes meaning only; this
 * function reloads state and resolves all commercial references from canonical
 * snapshots. Planning is read-only: state is persisted atomically with commit.
 */
export async function authoritativelyPlanConversationTurnV1(
  input: AuthoritativeConversationPlanInputV1,
  deps: AuthoritativeConversationPlanDependenciesV1,
): Promise<AuthoritativeConversationPlanV1> {
  const loaded = await deps.state_store.load(
    input.workspace_slug,
    input.turn.conversation_id,
    input.turn.contact_id,
  );
  const state = loaded ?? createDefaultConversationStateV1(input.turn);
  const plan = planConversationTurn({
    move: input.move,
    sales_context: state,
    business_context: buildPlanningBusinessContextV1(input.business_context, input.catalog_index),
  });
  const registry = buildCanonicalFactRegistry({
    business_context: input.business_context,
    catalog_index: input.catalog_index,
  });
  const { refs } = materializeCanonicalFactRequests({
    requests: plan.canonical_fact_requests,
    registry,
  });
  const hashInput = {
    turn: input.turn,
    state_version: state.version,
    business_as_of: input.business_context?.as_of ?? null,
    catalog_as_of: input.catalog_index?.as_of ?? null,
    plan,
    fact_refs: refs,
  };
  return {
    plan,
    fact_refs: refs,
    state_version: state.version,
    plan_hash: planHash(hashInput),
  };
}
