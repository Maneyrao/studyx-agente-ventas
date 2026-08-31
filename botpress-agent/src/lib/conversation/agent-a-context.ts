import {
  AgentAContextV1Schema,
  type AgentAContextV1,
} from '../../schemas/agent-a-brain';
import type { ClaimedTurn } from '../../schemas/contracts';
import type { ConversationMoveV1 } from '../../schemas/conversation-pipeline';

const MEMORY_TYPES = new Set([
  'study_goal', 'study_context', 'preference', 'constraint',
  'objection', 'timeline', 'contact_preference',
]);

const COURSE_BOUND_MOVES = new Set<ConversationMoveV1['move']>([
  'select_course',
  'ask_course_information',
  'request_call',
  'ask_payment_options',
  'select_payment_plan',
  'defer_payment',
  'request_payment_link',
  'decline_purchase',
]);

const PAYMENT_INTENT_MOVES = new Set<ConversationMoveV1['move']>([
  'ask_payment_options',
  'select_payment_plan',
  'defer_payment',
  'request_payment_link',
  'decline_purchase',
]);

/**
 * `catalog_resolution` was produced by the backend from the current batch and
 * its complete canonical index. Bind that already-verified identity to a
 * course-scoped semantic move so fluent model copy cannot advance without the
 * same course reaching the authoritative planner.
 */
export function bindCurrentCatalogResolutionToMoveV1(
  move: ConversationMoveV1,
  claimed: ClaimedTurn,
): ConversationMoveV1 {
  if (claimed.catalog_resolution.kind === 'ambiguous') {
    return {
      schema_version: 1,
      move: 'unknown',
      secondary_moves: [],
      vetoes: move.vetoes,
      confidence: 1,
    };
  }
  if (claimed.catalog_resolution.kind !== 'exact') return move;
  const kinds = [move.move, ...move.secondary_moves];
  if (!kinds.some((kind) => COURSE_BOUND_MOVES.has(kind))) return move;
  return {
    ...move,
    course_reference: claimed.catalog_resolution.offeringCode,
  };
}

/**
 * A deliberately tiny current-batch classifier for the shortest commercial
 * request. The model still writes the response, while the backend prevents an
 * exact "info" request from being downgraded to a social greeting or from
 * reviving an older course.
 */
export function bindCurrentConversationalIntentToMoveV1(
  move: ConversationMoveV1,
  claimed: ClaimedTurn,
): ConversationMoveV1 {
  const currentBatch = claimed.context.batch_messages
    .filter((message) => message.message_type === 'text')
    .map((message) => message.content)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  const recentCustomerText = claimed.context.recent_turns
    .filter((turn) => turn.direction === 'inbound')
    .map((turn) => turn.content)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es');
  const explicitLinkRequest = /\b(?:pasame|mandame|enviame|comparti(?:me)?)\s+(?:el\s+)?(?:link|enlace)\b/u
    .test(currentBatch);
  const resumesDeferredLink = /\bahora\s+si\b/u.test(currentBatch)
    && /\b(?:no\s+(?:me\s+)?(?:mandes|envies|compartas)\s+(?:el\s+)?(?:link|enlace)|todavia\s+no|quiero\s+pensarlo)\b/u
      .test(recentCustomerText);
  if (move.move === 'select_area') {
    const normalizeArea = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/gu, ' ')
      .trim();
    const academies = [...new Set(
      (claimed.catalog_index?.offerings ?? [])
        .map((offering) => offering.academy)
        .filter((academy): academy is string => Boolean(academy)),
    )];
    const matches = academies.filter((academy) => {
      const normalized = normalizeArea(academy);
      return normalized.length > 0 && ` ${currentBatch} `.includes(` ${normalized} `);
    });
    if (matches.length === 1) {
      return { ...move, area_reference: matches[0] };
    }
  }
  if (
    move.move === 'select_payment_plan'
    && move.payment_plan
    && (explicitLinkRequest || resumesDeferredLink)
    && !move.vetoes.includes('payment_link')
    && !move.vetoes.includes('purchase')
  ) {
    return {
      ...move,
      secondary_moves: [...new Set([
        ...move.secondary_moves,
        'request_payment_link' as const,
      ])].slice(0, 2),
    };
  }
  if (claimed.catalog_resolution.kind === 'exact') {
    const resolution = claimed.catalog_resolution;
    const currentOffering = claimed.catalog_index?.offerings.find(
      (offering) => offering.code === resolution.offeringCode,
    );
    const normalize = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/gu, ' ')
      .trim();
    const identityTerms = [
      resolution.displayName,
      resolution.offeringCode,
      ...(currentOffering?.aliases ?? []),
    ].map(normalize).filter(Boolean);
    const paddedCurrentBatch = ` ${currentBatch} `;
    const mentionsCurrentOffering = identityTerms.some(
      (term) => paddedCurrentBatch.includes(` ${term} `),
    );
    const asksEconomicDetails = /\b(?:precio|precios|cuanto sale|cuanto cuesta|pagos|formas? de pago)\b/u
      .test(currentBatch);
    const alreadyRepresentsPaymentIntent = [move.move, ...move.secondary_moves]
      .some((kind) => PAYMENT_INTENT_MOVES.has(kind));
    if (mentionsCurrentOffering && asksEconomicDetails && !alreadyRepresentsPaymentIntent) {
      return {
        schema_version: 1,
        move: 'ask_course_information',
        secondary_moves: ['ask_payment_options'],
        vetoes: move.vetoes,
        confidence: 1,
        course_reference: resolution.offeringCode,
      };
    }
  }
  if (!/^(?:(?:quiero|necesito|busco|dame|pasame) )?(?:toda la )?(?:informacion|info|detalles?)$/u.test(currentBatch)) {
    return move;
  }
  return {
    schema_version: 1,
    move: 'browse_catalog',
    secondary_moves: [],
    vetoes: [],
    confidence: 1,
  };
}

function areaCode(value: string | null): string | null {
  if (!value) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '') || null;
}

function durationValue(offering: ClaimedTurn['business_context'] extends infer Context
  ? Context extends { offerings: Array<infer Offering> } ? Offering : never
  : never): string | null {
  if (offering.classes !== null) return `${offering.classes} clases`;
  if (offering.hours_per_month !== null) return `${offering.hours_per_month} horas por mes`;
  if (offering.modules !== null) return `${offering.modules} módulos`;
  return null;
}

function selectedOfferingFacts(claimed: ClaimedTurn, offeringCode: string) {
  const detail = claimed.business_context?.offerings.find((offering) => offering.code === offeringCode);
  const index = claimed.catalog_index?.offerings.find((offering) => offering.code === offeringCode);
  if (!detail && !index) return null;
  const displayName = detail?.display_name ?? index!.display_name;
  const academy = detail?.academy ?? index?.academy ?? null;
  const facts: NonNullable<AgentAContextV1['catalog']['selected_offering']>['facts'][number][] = [{
    id: `offering:${offeringCode}:name:v1`,
    kind: 'offering_name',
    value: displayName,
  }];
  if (detail?.description) {
    facts.push({
      id: `offering:${offeringCode}:description:v1`,
      kind: 'offering_description',
      value: detail.description,
    });
  }
  if (detail) {
    const duration = durationValue(detail);
    if (duration) {
      facts.push({
        id: `offering:${offeringCode}:duration:v1`,
        kind: 'offering_duration',
        value: duration,
      });
    }
    if (detail.modality) {
      facts.push({
        id: `offering:${offeringCode}:modality:v1`,
        kind: 'offering_modality',
        value: detail.modality,
      });
    }
  }
  for (const option of claimed.business_context?.workspace.payment_options ?? []) {
    facts.push({
      id: `payment:${offeringCode}:${option.code}:label:v1`,
      kind: 'payment_plan_label',
      value: option.label,
    });
    facts.push({
      id: `payment:${offeringCode}:${option.code}:price:v1`,
      kind: 'payment_plan_price',
      value: `${option.total.currency} ${option.total.amount}`,
    });
  }
  return {
    code: offeringCode,
    display_name: displayName,
    area_code: areaCode(academy),
    facts,
  };
}

function candidateCodes(claimed: ClaimedTurn, selectedCode: string | null): string[] {
  if (claimed.catalog_resolution.kind === 'ambiguous') {
    return claimed.catalog_resolution.candidateCodes.slice(0, 3);
  }
  if (claimed.catalog_resolution.kind === 'not_found') {
    return claimed.catalog_resolution.alternativeCodes.slice(0, 3);
  }
  return (claimed.catalog_index?.offerings ?? [])
    .filter((offering) => offering.code !== selectedCode)
    .slice(0, 3)
    .map((offering) => offering.code);
}

export function buildAgentAContextV1(claimed: ClaimedTurn): AgentAContextV1 | null {
  const state = claimed.conversation_state_v1;
  if (!state) return null;
  const index = claimed.catalog_index?.offerings ?? [];
  // Persisted conversation state remains authoritative across turns. Within
  // the current turn, an exact backend catalog resolution is newer evidence:
  // expose its facts to the brain and clear any plan belonging to another
  // course. The planner will persist the transition atomically at commit.
  const currentCode = claimed.catalog_resolution.kind === 'exact'
    ? claimed.catalog_resolution.offeringCode
    : null;
  const selectedCode = currentCode ?? state.selected_offering_code;
  const currentCourseChanged = currentCode !== null
    && currentCode !== state.selected_offering_code;
  const selectedOffering = selectedCode ? selectedOfferingFacts(claimed, selectedCode) : null;
  const areas = new Map<string, string>();
  for (const offering of index) {
    const code = areaCode(offering.academy);
    if (code && offering.academy) areas.set(code, offering.academy);
  }
  const candidates = candidateCodes(claimed, selectedCode)
    .map((code) => index.find((offering) => offering.code === code))
    .filter((offering): offering is NonNullable<typeof offering> => offering !== undefined)
    .map((offering) => ({
      code: offering.code,
      fact_id: `offering:${offering.code}:name:v1`,
      display_name: offering.display_name,
      area_code: areaCode(offering.academy),
    }));
  const callOfferCount = state.call_offer_count ?? (state.call_offer_status === 'not_offered' ? 0 : 1);
  const selectedPlan = currentCourseChanged ? null : state.selected_payment_plan;

  return AgentAContextV1Schema.parse({
    schema_version: 1,
    turn: {
      batch_messages: claimed.context.batch_messages.map((message) => ({
        id: message.id,
        text: message.content,
      })),
      recent_turns: claimed.context.recent_turns.slice(-8).map((turn, index) => ({
        id: `recent:${turn.created_at}:${index}`,
        direction: turn.direction,
        content: turn.content,
      })),
    },
    customer: {
      display_name: claimed.contact.name,
      memories: [...claimed.context.selected_memories]
        .sort((left, right) => right.similarity - left.similarity)
        .filter((memory) => MEMORY_TYPES.has(memory.type))
        .slice(0, 5)
        .map((memory) => ({
          id: memory.memory_id,
          type: memory.type,
          key: memory.key,
          value: memory.value,
          confidence: Math.min(1, Math.max(0, memory.similarity)),
        })),
    },
    commercial_state: {
      selected_offering_code: selectedCode,
      selected_payment_plan: selectedPlan,
      stage: currentCourseChanged ? 'course_selected' : state.stage,
      call_preference: state.call_preference,
      call_offer_status: state.call_offer_status,
      call_offer_count: callOfferCount,
      awaiting_reply: currentCourseChanged ? 'none' : state.awaiting_reply,
    },
    catalog: {
      selected_offering: selectedOffering,
      areas: [...areas].map(([code, display_name]) => ({
        code,
        fact_id: `area:${code}:name:v1`,
        display_name,
      })),
      candidate_offerings: selectedOffering ? [] : candidates,
      payment_plans: (claimed.business_context?.workspace.payment_options ?? []).map((option) => ({
        code: option.code,
        label: option.label,
      })),
    },
    capabilities: {
      may_reply: claimed.policy.may_respond,
      may_offer_call: claimed.policy.may_respond
        && selectedCode !== null
        && state.call_preference === 'unknown'
        && callOfferCount < 2,
      may_request_call_now: claimed.policy.may_respond
        && !claimed.contact.blocked
        && claimed.sales_context.allowed_actions.includes('request_call_now'),
      may_present_payment_options: claimed.policy.may_respond
        && selectedCode !== null
        && (claimed.business_context?.workspace.payment_options.length ?? 0) > 0,
      may_send_payment_link: claimed.policy.may_respond
        && selectedCode !== null
        && selectedPlan !== null,
      authorized_payment_plan: selectedPlan,
    },
  });
}
