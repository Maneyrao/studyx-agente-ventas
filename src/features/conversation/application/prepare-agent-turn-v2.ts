import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { DecisionV4 } from '@/features/orchestration/domain/decision-v4';
import type { ProtectedFactRef } from '@/features/orchestration/domain/egress-guard';
import { materializeCanonicalCatalogFacts } from '@/features/orchestration/domain/canonical-offering-egress';
import type { OrchestrationStore } from '@/features/orchestration/ports/orchestration-store';
import { loadConversationSessionConfig } from '@/lib/config';
import type { AgentATurnProposalV1 } from '../domain/agent-a-brain';
import { authorizeAgentTurnV2 } from '../domain/agent-turn-policy-v2';
import { buildCanonicalFactRegistry } from '../domain/canonical-fact-registry';
import type {
  CanonicalFactV1,
  ConversationStateTransitionV1,
} from '../domain/conversation-pipeline';
import {
  createDefaultConversationStateV1,
  effectiveConversationStateV1,
  missingContactIntakeFieldsV1,
  type ContactIntakeV1,
} from '../domain/conversation-planner';
import { solicitsACall } from '../domain/operational-promise-guard';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';

export class AgentTurnV2RejectedError extends Error {
  readonly code = 'AGENT_TURN_V2_REJECTED';

  constructor(readonly reasons: readonly string[]) {
    super(`AGENT_TURN_V2_REJECTED:${reasons.join(',')}`);
    this.name = 'AgentTurnV2RejectedError';
  }
}

function renderDecimal(amount: string): string {
  return amount.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function protectedFactsFromCitations(input: {
  readonly facts: readonly CanonicalFactV1[];
  readonly authorized_fact_ids: readonly string[];
  readonly business_context: BusinessContextView | null;
}): ProtectedFactRef[] {
  const authorized = new Set(input.authorized_fact_ids);
  const result: ProtectedFactRef[] = [];
  for (const fact of input.facts) {
    if (!authorized.has(fact.id)) continue;
    if (fact.kind === 'offering_duration') result.push({ kind: 'duration', value: fact.value });
    if (fact.kind === 'offering_modality') result.push({ kind: 'modality', value: fact.value });
    if (fact.kind === 'payment_plan_price') result.push({ kind: 'price', value: fact.value });
    if (fact.kind === 'payment_plan_label' && fact.payment_plan) {
      const option = input.business_context?.workspace.payment_options.find(
        (candidate) => candidate.code === fact.payment_plan,
      );
      if (option) {
        result.push({
          kind: 'price',
          value: `${option.total.currency} ${renderDecimal(option.installment_amount)}`,
        });
      }
    }
  }
  return result;
}

function uniqueProtectedFacts(facts: readonly ProtectedFactRef[]): ProtectedFactRef[] {
  return [...new Map(facts.map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])).values()];
}

function suppliesFirstNameInCurrentTurn(messages: readonly string[] | undefined): boolean {
  return (messages ?? []).some((message) => (
    /\b(?:soy|me llamo|mi nombre es)\s+[\p{L}]{2,}/iu.test(message)
  ));
}

function responseType(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly response: string;
}): DecisionV4['response_type'] {
  if (input.proposal.proposed_action.type === 'request_call_now') return 'call_confirmation';
  if (input.proposal.response.call_offer || solicitsACall(input.response)) return 'call_offer';
  if (input.proposal.move.move === 'greeting') return 'social_reply';
  return 'commercial_reply';
}

function decisionFromAuthorizedTurn(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly response: string;
  readonly selected_offering_code: string | null;
}): DecisionV4 {
  const action = input.proposal.proposed_action;
  const businessAction: DecisionV4['business_action'] = action.type === 'request_call_now'
    ? {
        type: 'request_call_now', reason: action.reason,
        ...(input.selected_offering_code ? { course_of_interest: input.selected_offering_code } : {}),
      }
    : action.type === 'send_payment_link'
      ? { type: 'send_payment_link', offering_sku: action.offering_code, plan_code: action.payment_plan }
      : null;
  return {
    schema_version: 4,
    intent: input.proposal.move.move === 'greeting'
      ? 'social'
      : input.proposal.move.move === 'decline_call' || input.proposal.move.move === 'decline_purchase'
        ? 'commercial_decline'
        : 'commercial',
    kind: 'reply',
    response: input.response,
    response_type: responseType(input),
    confidence: input.proposal.move.confidence,
    reason_code: 'AGENT_A_PLANNERLESS_V2',
    business_action: businessAction,
    memory_candidates: [...input.proposal.memory_candidates],
    missing_information: [],
    next_state: input.proposal.move.move === 'decline_purchase' ? 'completed' : 'waiting_user',
    retrieval_used: null,
  };
}

/**
 * Backend preparation for a model-owned turn. It reloads authority and may
 * accept or reject the proposal, but never chooses the response goal or
 * rewrites the model's customer-facing language.
 */
export async function prepareAgentTurnV2(input: {
  readonly turn: {
    readonly id: string;
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
  };
  readonly workspace_slug: string;
  readonly current_customer_messages?: readonly string[];
  readonly proposal: AgentATurnProposalV1;
  readonly business_context: BusinessContextView | null;
  readonly catalog_index: CatalogIndexView | null;
}, deps: {
  readonly state_store: Pick<ConversationStateStoreV1, 'load'>;
  readonly call_facts?: Pick<OrchestrationStore, 'loadClaimedCallFacts'>;
  readonly contact_intake?: (contactId: string) => Promise<ContactIntakeV1>;
  readonly now?: () => number;
}): Promise<{
  readonly decision: DecisionV4;
  readonly response_messages: readonly string[];
  readonly transition: ConversationStateTransitionV1;
  readonly authorized_offering_code: string | null;
  readonly authorized_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  readonly authorized_protected_facts: readonly ProtectedFactRef[];
}> {
  const [loaded, callFacts, contactIntake] = await Promise.all([
    deps.state_store.load(input.workspace_slug, input.turn.conversation_id, input.turn.contact_id),
    deps.call_facts?.loadClaimedCallFacts({
      conversation_id: input.turn.conversation_id,
      contact_id: input.turn.contact_id,
    }) ?? Promise.resolve(null),
    deps.contact_intake?.(input.turn.contact_id) ?? Promise.resolve(undefined),
  ]);
  const state = loaded
    ? effectiveConversationStateV1(
        loaded,
        deps.now?.() ?? Date.now(),
        loadConversationSessionConfig().sessionIdleMs,
      )
    : createDefaultConversationStateV1(input.turn);
  const registry = buildCanonicalFactRegistry({
    business_context: input.business_context,
    catalog_index: input.catalog_index,
  });
  const facts = [...registry.facts.values()];
  const offerings = (input.catalog_index?.offerings ?? input.business_context?.offerings ?? []).map(
    (offering) => ({
      code: offering.code,
      display_name: offering.display_name,
      aliases: offering.aliases,
    }),
  );
  const noActiveCall = callFacts?.active_call == null;
  const firstNameKnown = !missingContactIntakeFieldsV1(contactIntake).includes('nombre')
    || suppliesFirstNameInCurrentTurn(input.current_customer_messages);
  const authority = authorizeAgentTurnV2({
    proposal: input.proposal,
    state,
    offerings,
    facts,
    contact_intake: contactIntake,
    current_customer_messages: input.current_customer_messages,
    call_policy: {
      may_offer_call: firstNameKnown && noActiveCall && callFacts?.last_decline_at == null,
      // A direct customer request remains valid after an earlier decline.
      may_request_call_now: noActiveCall,
    },
  });
  if (!authority.ok) throw new AgentTurnV2RejectedError(authority.reasons);

  const transition: ConversationStateTransitionV1 = {
    workspace_slug: input.workspace_slug,
    conversation_id: input.turn.conversation_id,
    contact_id: input.turn.contact_id,
    ...authority.transition,
    source_turn_id: input.turn.id,
  };
  const decision = decisionFromAuthorizedTurn({
    proposal: { ...input.proposal, proposed_action: authority.action },
    response: authority.response,
    selected_offering_code: authority.transition.selected_offering_code,
  });
  const catalogFacts = materializeCanonicalCatalogFacts({
    content: authority.response,
    offerings: offerings.map((offering) => ({ code: offering.code, display_name: offering.display_name })),
  });
  return {
    decision,
    response_messages: authority.response_messages,
    transition,
    authorized_offering_code: authority.transition.selected_offering_code,
    authorized_payment_plan: authority.action.type === 'send_payment_link'
      ? authority.action.payment_plan
      : input.proposal.move.move === 'select_payment_plan'
        ? authority.transition.selected_payment_plan
        : null,
    authorized_protected_facts: uniqueProtectedFacts([
      ...protectedFactsFromCitations({
        facts,
        authorized_fact_ids: authority.authorized_fact_ids,
        business_context: input.business_context,
      }),
      ...catalogFacts,
    ]),
  };
}
