import type { EarlyCallOfferEvidenceV1, GoldenModelAttemptV1 } from './judge';

interface ExchangeLikeV1 {
  readonly boundary: 'deepseek' | 'backend';
  readonly url?: string;
  readonly requestBody: unknown;
  readonly responseBody: unknown;
  readonly status: number | null;
  readonly error: string | null;
}

interface DeliveryCaptureLikeV1 {
  readonly outboundId: string | null;
  readonly providerMessageId: string;
}

/** Every physical bubble has its own outbound id. A multi-bubble golden turn
 * must confirm all of them; otherwise the offer bubble can remain pending and
 * the following turn observes a package that was never delivered. */
export function deliveryAcknowledgementTargetsV1(
  captures: readonly DeliveryCaptureLikeV1[],
): readonly { readonly outboundId: string; readonly providerMessageId: string }[] {
  const seen = new Set<string>();
  const targets: Array<{ outboundId: string; providerMessageId: string }> = [];
  for (const capture of captures) {
    if (!capture.outboundId || seen.has(capture.outboundId)) continue;
    seen.add(capture.outboundId);
    targets.push({ outboundId: capture.outboundId, providerMessageId: capture.providerMessageId });
  }
  return targets;
}

export function extractFinalBackendDecisionErrorV1(
  exchanges: readonly ExchangeLikeV1[],
): string | null {
  const finalDecision = exchanges.filter((exchange) => (
    exchange.boundary === 'backend' && exchange.url?.endsWith('/decision')
  )).at(-1);
  if (!finalDecision || (finalDecision.status !== null && finalDecision.status < 400)) return null;
  const body = record(finalDecision.responseBody);
  if (typeof body?.reason === 'string') return body.reason;
  if (typeof body?.error === 'string') return body.error;
  return finalDecision.error ?? `BACKEND_DECISION_HTTP_${String(finalDecision.status)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function outputText(payload: unknown): string | null {
  const root = record(payload);
  if (!root) return null;
  if (typeof root.output_text === 'string') return root.output_text;
  if (!Array.isArray(root.output)) return null;
  const fragments: string[] = [];
  for (const output of root.output) {
    const content = record(output)?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const part = record(item);
      if (typeof part?.text === 'string') fragments.push(part.text);
    }
  }
  return fragments.length > 0 ? fragments.join('') : null;
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const candidate = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try { return record(JSON.parse(candidate)); } catch { return null; }
}

export function extractAuthorizedContextV1(requestBody: unknown): Record<string, unknown> | null {
  const instructions = record(requestBody)?.instructions;
  if (typeof instructions !== 'string') return null;
  const serialized = instructions.match(
    /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
  )?.[1];
  return serialized ? parseJsonObject(serialized) : null;
}

function proposalResponse(proposal: Record<string, unknown> | null): string | null {
  const response = record(proposal?.response);
  const messages = response?.messages;
  if (!Array.isArray(messages)) return null;
  const texts = messages.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (typeof response?.call_offer === 'string' && response.call_offer.trim()) texts.push(response.call_offer);
  return texts.length > 0 ? texts.join('\n') : null;
}

/** Only a successful decision receipt establishes which proposal was committed.
 * The last model draft can differ from the whole-turn Rule A fixed fallback. */
function committedExchangeV1(exchanges: readonly ExchangeLikeV1[]): ExchangeLikeV1 | null {
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = exchanges[index]!;
    if (exchange.boundary !== 'backend' || !exchange.url?.endsWith('/decision')
      || exchange.status === null || exchange.status < 200 || exchange.status >= 300 || exchange.error) continue;
    const receipt = record(exchange.responseBody);
    if (!['committed', 'duplicate'].includes(String(receipt?.status))) continue;
    const request = record(exchange.requestBody);
    const proposal = record(record(request?.agent_turn_v2)?.proposal);
    if (proposal) return exchange;
  }
  return null;
}

export function extractCommittedProposalV1(exchanges: readonly ExchangeLikeV1[]): Record<string, unknown> | null {
  const exchange = committedExchangeV1(exchanges);
  return record(record(record(exchange?.requestBody)?.agent_turn_v2)?.proposal);
}

export function extractCommittedCallIdV1(exchanges: readonly ExchangeLikeV1[]): string | null {
  const receipt = record(committedExchangeV1(exchanges)?.responseBody);
  const callRequest = record(receipt?.call_request);
  return callRequest?.status === 'requested' && typeof callRequest.call_id === 'string'
    ? callRequest.call_id
    : null;
}

/** Final repairs can replace an earlier model outcome with a fixed fallback.
 * No proposal hash is emitted: correlate the last event to the successful
 * receipt's exact turn/trace and committed effect identity, retaining raw events. */
export function extractFinalDeterministicRuleOutcomeV1(
  events: readonly Readonly<Record<string, unknown>>[], exchanges: readonly ExchangeLikeV1[],
): Readonly<Record<string, unknown>> | null {
  const exchange = committedExchangeV1(exchanges);
  const request = record(exchange?.requestBody);
  const receipt = record(exchange?.responseBody);
  const proposal = record(record(request?.agent_turn_v2)?.proposal);
  if (!proposal || typeof request?.turn_id !== 'string' || typeof request.trace_id !== 'string') return null;
  if (receipt?.turn_id !== request.turn_id
    || (typeof receipt.trace_id === 'string' && receipt.trace_id !== request.trace_id)) return null;
  let final: Readonly<Record<string, unknown>> | null = null;
  for (const event of events) {
    if (event.event === 'studyx.turn.deterministic_rules'
      && event.turn_id === request.turn_id && event.trace_id === request.trace_id) final = event;
  }
  if (!final) return null;
  const action = record(proposal.proposed_action);
  if (typeof final.rule_a_bonus_code === 'string' && (action?.type !== 'offer_course_bonus'
    || action.bonus_offering_code !== final.rule_a_bonus_code)) return null;
  if (action?.type === 'offer_course_bonus' && final.rule_a === 'not_applicable') return null;
  if (['model', 'rewrite', 'fixed'].includes(String(final.rule_b))
    && !String(record(proposal.response)?.call_offer ?? '').trim()) return null;
  return final;
}

export function proposalEvidenceV1(proposal: Record<string, unknown> | null) {
  const move = record(proposal?.move);
  const profileRequests = Array.isArray(proposal?.profile_requests) ? proposal.profile_requests : [];
  return {
    response: proposalResponse(proposal),
    move: typeof move?.move === 'string' ? move.move : null,
    secondaryMoves: Array.isArray(move?.secondary_moves)
      ? move.secondary_moves.filter((value): value is string => typeof value === 'string') : [],
    proposedAction: record(proposal?.proposed_action),
    usedFactIds: Array.isArray(proposal?.used_fact_ids)
      ? proposal.used_fact_ids.filter((value): value is string => typeof value === 'string') : [],
    profileRequestedFields: profileRequests.flatMap((request) => {
      const fields = record(request)?.fields;
      return Array.isArray(fields) ? fields.filter((value): value is string => typeof value === 'string') : [];
    }),
    callOffer: typeof record(proposal?.response)?.call_offer === 'string'
      ? String(record(proposal?.response)?.call_offer) : null,
  };
}

/** Interpretation evidence is accepted only with a literal current-message quote. */
export function quotedCurrentPriceEvidenceV1(context: Record<string, unknown> | null,
  proposal: Record<string, unknown> | null) {
  const messages = record(context?.turn)?.batch_messages;
  const texts = Array.isArray(messages) ? messages.map(message => record(message)?.text)
    .filter((value): value is string => typeof value === 'string') : [];
  const memories = Array.isArray(proposal?.memory_candidates) ? proposal.memory_candidates : [];
  const quoted = memories.map(record).filter(candidate => typeof candidate?.source_quote === 'string'
    && candidate.source_quote.trim().length > 0
    && texts.some(text => text.includes(String(candidate.source_quote).trim())));
  return {
    currentPriceObjectionQuoted: quoted.some(candidate => candidate?.type === 'objection' && candidate.key === 'price_objection'),
    currentPriceOnlyBarrierQuoted: quoted.some(candidate => candidate?.type === 'constraint'
      && candidate.key === 'price_only_barrier' && candidate.value === 'confirmed'),
  };
}

/** Capture facts, not invitation prose quality: a Rule B ordinal, successful
 * receipt, persisted count and the exact committed invitation delivered locally. */
export function appendEarlyCallOfferEvidenceV1(input: {
  readonly prior: readonly EarlyCallOfferEvidenceV1[];
  readonly conversationId: string;
  readonly turnId: string | null;
  readonly callOffer: string | null;
  readonly response: string;
  readonly ruleBReason: unknown;
  readonly committed: boolean;
  readonly persistedOfferCount: number;
}): readonly EarlyCallOfferEvidenceV1[] {
  const prior = input.prior.filter(source => source.conversationId === input.conversationId);
  const ordinal = input.ruleBReason === 'response_2' ? 2 : input.ruleBReason === 'response_3' ? 3 : null;
  if (!ordinal || !input.turnId || !input.callOffer?.trim() || !input.committed
    || input.persistedOfferCount < 1 || !input.response.includes(input.callOffer)) return prior;
  return [...prior, { conversationId: input.conversationId, turnId: input.turnId,
    responseOrdinal: ordinal, callOffer: input.callOffer, committed: true, delivered: true,
    persistedOfferCount: input.persistedOfferCount }];
}

export function extractModelAttemptsV1(
  exchanges: readonly ExchangeLikeV1[],
): readonly GoldenModelAttemptV1[] {
  return exchanges.filter((exchange) => exchange.boundary === 'deepseek').map((exchange, index) => {
    const proposal = parseJsonObject(outputText(exchange.responseBody));
    const move = record(proposal?.move);
    const context = extractAuthorizedContextV1(exchange.requestBody);
    return {
      attempt: index + 1,
      response: proposalResponse(proposal),
      move: typeof move?.move === 'string' ? move.move : null,
      proposedAction: record(proposal?.proposed_action),
      turnRejection: context?.turn_rejection ?? null,
      providerStatus: exchange.status,
      providerError: exchange.error,
    };
  });
}

export function extractLastProposalV1(exchanges: readonly ExchangeLikeV1[]): {
  readonly response: string | null;
  readonly move: string | null;
  readonly secondaryMoves: readonly string[];
  readonly proposedAction: Record<string, unknown> | null;
  readonly usedFactIds: readonly string[];
  readonly profileRequestedFields: readonly string[];
} {
  const attempts = exchanges.filter((exchange) => exchange.boundary === 'deepseek');
  for (const exchange of attempts.toReversed()) {
    const proposal = parseJsonObject(outputText(exchange.responseBody));
    if (!proposal) continue;
    const move = record(proposal.move);
    const profileRequests = Array.isArray(proposal.profile_requests) ? proposal.profile_requests : [];
    return {
      response: proposalResponse(proposal),
      move: typeof move?.move === 'string' ? move.move : null,
      secondaryMoves: Array.isArray(move?.secondary_moves)
        ? move.secondary_moves.filter((value): value is string => typeof value === 'string') : [],
      proposedAction: record(proposal.proposed_action),
      usedFactIds: Array.isArray(proposal.used_fact_ids)
        ? proposal.used_fact_ids.filter((value): value is string => typeof value === 'string') : [],
      profileRequestedFields: profileRequests.flatMap((request) => {
        const fields = record(request)?.fields;
        return Array.isArray(fields) ? fields.filter((value): value is string => typeof value === 'string') : [];
      }),
    };
  }
  return { response: null, move: null, secondaryMoves: [], proposedAction: null,
    usedFactIds: [], profileRequestedFields: [] };
}

export function normalizePromotionStatusV1(value: string | null): string | null {
  if (value === 'offered') return 'offer_available';
  if (value === 'attached') return 'accepted';
  return value;
}

export function extractBackendRejectionsV1(exchanges: readonly ExchangeLikeV1[]): readonly unknown[] {
  const contextRejections = exchanges
    .filter((exchange) => exchange.boundary === 'deepseek')
    .map((exchange) => extractAuthorizedContextV1(exchange.requestBody)?.turn_rejection)
    .filter((value) => value !== null && value !== undefined);
  const backendRejections = exchanges
    .filter((exchange) => exchange.boundary === 'backend')
    .flatMap((exchange) => {
      const body = record(exchange.responseBody);
      const rejection = body?.turn_rejection ?? body?.rejection ?? body?.rejections;
      if (Array.isArray(rejection)) return rejection;
      return rejection === null || rejection === undefined ? [] : [rejection];
    });
  return [...contextRejections, ...backendRejections].filter((value, index, values) => (
    values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(value)) === index
  ));
}

export function extractContextEvidenceV1(exchanges: readonly ExchangeLikeV1[]): {
  readonly authorizedFactIds: readonly string[];
  readonly authorizedFacts: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
  readonly availableOfferings: readonly { readonly code: string; readonly displayName: string }[];
  readonly selectedOfferingFacts: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
  readonly callRequirements: readonly string[];
  readonly mayOfferCall: boolean | null;
  readonly courseBonus: {
    readonly enabled: boolean | null;
    readonly maxBonusCourses: number | null;
    readonly mayOfferBonus: boolean | null;
    readonly status: string | null;
  };
} {
  const contexts = exchanges.filter((exchange) => exchange.boundary === 'deepseek')
    .map((exchange) => extractAuthorizedContextV1(exchange.requestBody)).filter(Boolean) as Record<string, unknown>[];
  const context = contexts.at(-1) ?? {};
  const catalog = record(context.catalog);
  const rawOfferings = Array.isArray(catalog?.available_offerings) ? catalog.available_offerings : [];
  const selectedOffering = record(catalog?.selected_offering);
  const candidateFacts = (Array.isArray(catalog?.candidate_offerings) ? catalog.candidate_offerings : [])
    .flatMap((candidate) => {
      const facts = record(candidate)?.facts;
      return Array.isArray(facts) ? facts : [];
    });
  const facts = [
    ...(Array.isArray(selectedOffering?.facts) ? selectedOffering.facts : []),
    ...candidateFacts,
    ...(Array.isArray(context.authorized_facts) ? context.authorized_facts : []),
    ...(Array.isArray(context.facts) ? context.facts : []),
  ];
  const normalizedFacts = facts.flatMap((item) => {
    const fact = record(item);
    if (!fact) return [];
    const id = fact?.fact_id ?? fact?.id;
    if (typeof id !== 'string') return [];
    const kind = typeof fact.kind === 'string' ? fact.kind : typeof fact.type === 'string' ? fact.type : '';
    const value = typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value ?? fact);
    return [{ id, kind, value }];
  });
  const capabilities = record(context.capabilities);
  const courseBonus = record(capabilities?.course_bonus);
  const callContactRequirements = Array.isArray(capabilities?.call_contact_requirements)
    ? capabilities.call_contact_requirements : [];
  const rawRequirements = callContactRequirements.length > 0
    ? callContactRequirements.map((requirement) => record(requirement)?.field)
    : record(capabilities?.required_contact_fields)?.call;
  return {
    authorizedFactIds: normalizedFacts.map((fact) => fact.id),
    authorizedFacts: normalizedFacts,
    availableOfferings: rawOfferings.flatMap((item) => {
      const offering = record(item);
      if (!offering) return [];
      const code = offering?.code;
      if (typeof code !== 'string') return [];
      const displayName = typeof offering.display_name === 'string' ? offering.display_name : code;
      return [{ code, displayName }];
    }),
    selectedOfferingFacts: normalizedFacts.filter((fact) => /syllabus|temario|module|program/iu.test(`${fact.id} ${fact.kind}`)),
    callRequirements: Array.isArray(rawRequirements)
      ? rawRequirements.filter((value): value is string => typeof value === 'string') : [],
    mayOfferCall: typeof capabilities?.may_offer_call === 'boolean'
      ? capabilities.may_offer_call : null,
    courseBonus: {
      enabled: typeof courseBonus?.enabled === 'boolean' ? courseBonus.enabled : null,
      maxBonusCourses: typeof courseBonus?.max_bonus_courses === 'number'
        ? courseBonus.max_bonus_courses : null,
      mayOfferBonus: typeof courseBonus?.may_offer_bonus === 'boolean'
        ? courseBonus.may_offer_bonus : null,
      status: typeof courseBonus?.status === 'string' ? courseBonus.status : null,
    },
  };
}

/** Minimal turn shape the results report needs (the live runner's TurnResultV1 satisfies it). */
export interface ReportTurnV1 {
  readonly turn_id: string;
  readonly approved: boolean | null;
  readonly execution_status: 'executed' | 'not_executed' | 'evaluation_error';
  readonly invariant_status?: string;
  readonly failures: readonly unknown[];
}

/** approved=true, approved=false and approved=null always add up to the number of turns. */
export function reportTurnTotalsV1(turns: readonly ReportTurnV1[]) {
  return {
    total: turns.length,
    approved: turns.filter((turn) => turn.approved === true).length,
    failed: turns.filter((turn) => turn.approved === false).length,
    no_verdict: turns.filter((turn) => turn.approved === null).length,
    evaluation_error: turns.filter((turn) => turn.execution_status === 'evaluation_error').length,
  };
}

export function reportTurnLabelV1(turn: ReportTurnV1): string {
  if (turn.execution_status === 'not_executed') return 'NO_EJECUTADO';
  if (turn.execution_status === 'evaluation_error') return 'ERROR_EVALUACIÓN';
  if (turn.approved === null) return 'SIN_VEREDICTO';
  return turn.approved ? 'APROBADO' : 'FALLIDO';
}

/** Why a turn without verdict (approved=null) has no failures to list. */
export function noVerdictReasonV1(turn: ReportTurnV1): string {
  const parts = [`execution_status=${turn.execution_status}`];
  if (turn.invariant_status) parts.push(`invariant_status=${turn.invariant_status}`);
  parts.push('el evaluador no emitió veredicto (evidencia o juez indeterminado), no hay fallos que listar');
  return parts.join('; ');
}
