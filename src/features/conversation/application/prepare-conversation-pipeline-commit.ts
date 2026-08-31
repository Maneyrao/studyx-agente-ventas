import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { DecisionV4 } from '@/features/orchestration/domain/decision-v4';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';
import type { OrchestrationStore } from '@/features/orchestration/ports/orchestration-store';
import type {
  ComposedNarrativeV1,
  ConversationMoveV1,
  ConversationStateTransitionV1,
  TurnPlanV1,
} from '../domain/conversation-pipeline';
import { authoritativelyPlanConversationTurnV1 } from './plan-conversation-turn';
import {
  buildCanonicalFactRegistry,
  materializeCanonicalFactRequests,
} from '../domain/canonical-fact-registry';
import { assembleCanonicalConversationResponseV1 } from '../domain/canonical-response-assembler';
import type { ProtectedFactRef } from '@/features/orchestration/domain/egress-guard';
import { materializeCanonicalCatalogFacts } from '@/features/orchestration/domain/canonical-offering-egress';

export class ConversationPlanMismatchError extends Error {
  readonly code = 'CONVERSATION_PLAN_MISMATCH';
  constructor() {
    super('CONVERSATION_PLAN_MISMATCH');
    this.name = 'ConversationPlanMismatchError';
  }
}

function renderDecimal(amount: string): string {
  return amount.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function protectedFactsFromCanonicalSelection(input: {
  readonly facts: readonly import('../domain/conversation-pipeline').CanonicalFactV1[];
  readonly used_fact_ids: readonly string[];
  readonly business_context: BusinessContextView | null;
}): ProtectedFactRef[] {
  const used = new Set(input.used_fact_ids);
  const facts: ProtectedFactRef[] = [];
  for (const fact of input.facts) {
    if (!used.has(fact.id)) continue;
    if (fact.kind === 'offering_duration') facts.push({ kind: 'duration', value: fact.value });
    if (fact.kind === 'offering_modality') facts.push({ kind: 'modality', value: fact.value });
    if (fact.kind === 'payment_plan_price') facts.push({ kind: 'price', value: fact.value });
    if (fact.kind === 'payment_plan_label' && fact.payment_plan) {
      const option = input.business_context?.workspace.payment_options.find(
        (candidate) => candidate.code === fact.payment_plan,
      );
      if (option) {
        facts.push({
          kind: 'price',
          value: `${option.total.currency} ${renderDecimal(option.installment_amount)}`,
        });
      }
    }
  }
  return [...new Map(facts.map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])).values()];
}

function decisionFromPlan(input: {
  readonly move: ConversationMoveV1;
  readonly plan: TurnPlanV1;
  readonly response: string;
}): DecisionV4 {
  const { plan, move } = input;
  const isClarification = plan.response_goal === 'clarify_current_step';
  const requestsCall = plan.allowed_business_action.type === 'request_call_now';
  const businessAction: DecisionV4['business_action'] = requestsCall
    ? {
        type: 'request_call_now',
        reason: plan.allowed_business_action.reason,
        ...(plan.selected_offering_code
          ? { course_of_interest: plan.selected_offering_code }
          : {}),
      }
    : plan.allowed_business_action.type === 'send_payment_link'
      ? {
          type: 'send_payment_link',
          plan_code: plan.allowed_business_action.payment_plan,
          offering_sku: plan.allowed_business_action.offering_code,
        }
      : null;
  return {
    schema_version: 4,
    intent: move.move === 'decline_call' || move.move === 'decline_purchase'
      ? 'commercial_decline'
      : 'commercial',
    kind: isClarification ? 'clarify' : 'reply',
    response: input.response,
    response_type: requestsCall
      ? 'call_confirmation'
      : plan.should_offer_call
        ? 'call_offer'
        : isClarification
          ? 'clarification'
          : 'commercial_reply',
    confidence: move.confidence,
    reason_code: 'CONVERSATION_PIPELINE_V1',
    business_action: businessAction,
    memory_candidates: [],
    missing_information: [...plan.missing_information],
    next_state: plan.next_stage === 'closed' ? 'completed' : 'waiting_user',
    retrieval_used: null,
  };
}

export async function prepareConversationPipelineCommitV1(input: {
  readonly turn: {
    readonly id: string;
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
  };
  readonly workspace_slug: string;
  readonly move: ConversationMoveV1;
  readonly expected_plan_hash: string;
  readonly composition: ComposedNarrativeV1;
  readonly business_context: BusinessContextView | null;
  readonly catalog_index: CatalogIndexView | null;
}, deps: {
  readonly state_store: ConversationStateStoreV1;
  readonly call_facts?: Pick<OrchestrationStore, 'loadClaimedCallFacts'>;
}): Promise<{
  readonly decision: DecisionV4;
  readonly plan: TurnPlanV1;
  readonly transition: ConversationStateTransitionV1;
  readonly authorized_offering_code: string | null;
  readonly authorized_payment_plan: TurnPlanV1['selected_payment_plan'];
  readonly authorized_protected_facts: readonly ProtectedFactRef[];
}> {
  const authoritative = await authoritativelyPlanConversationTurnV1({
    turn: {
      workspace_id: input.turn.workspace_id,
      conversation_id: input.turn.conversation_id,
      contact_id: input.turn.contact_id,
    },
    workspace_slug: input.workspace_slug,
    move: input.move,
    business_context: input.business_context,
    catalog_index: input.catalog_index,
  }, { state_store: deps.state_store, call_facts: deps.call_facts });
  if (authoritative.plan_hash !== input.expected_plan_hash) {
    throw new ConversationPlanMismatchError();
  }
  const registry = buildCanonicalFactRegistry({
    business_context: input.business_context,
    catalog_index: input.catalog_index,
  });
  const materialized = materializeCanonicalFactRequests({
    requests: authoritative.plan.canonical_fact_requests,
    registry,
  });
  const assembled = assembleCanonicalConversationResponseV1({
    plan: authoritative.plan,
    fact_refs: authoritative.fact_refs,
    facts: materialized.facts,
    composition: input.composition,
  });
  const catalogFacts = materializeCanonicalCatalogFacts({
    content: assembled.content,
    offerings: input.catalog_index?.offerings.map((offering) => ({
      code: offering.code,
      display_name: offering.display_name,
    })) ?? [],
  });
  return {
    decision: decisionFromPlan({
      move: input.move,
      plan: authoritative.plan,
      response: assembled.content,
    }),
    plan: authoritative.plan,
    transition: {
      workspace_slug: input.workspace_slug,
      conversation_id: input.turn.conversation_id,
      contact_id: input.turn.contact_id,
      selected_offering_code: authoritative.plan.selected_offering_code,
      selected_payment_plan: authoritative.plan.selected_payment_plan,
      stage: authoritative.plan.next_stage,
      call_preference: authoritative.plan.next_call_preference,
      call_offer_status: authoritative.plan.next_call_offer_status,
      call_offer_count: authoritative.plan.next_call_offer_count,
      awaiting_reply: authoritative.plan.next_awaiting_reply,
      source_turn_id: input.turn.id,
    },
    authorized_offering_code: authoritative.plan.selected_offering_code,
    authorized_payment_plan: authoritative.plan.selected_payment_plan,
    authorized_protected_facts: [...new Map([
      ...protectedFactsFromCanonicalSelection({
        facts: materialized.facts,
        used_fact_ids: assembled.used_fact_ids,
        business_context: input.business_context,
      }),
      ...catalogFacts,
    ].map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])).values()],
  };
}
