import {
  AgentAContextV1Schema,
  type AgentAContextV1,
} from '../../schemas/agent-a-brain';
import type { ClaimedTurn } from '../../schemas/contracts';
import type { ConversationMoveV1 } from '../../schemas/conversation-pipeline';
import { classifyBatchSalesSignal } from '../../../../src/features/orchestration/domain/sales-signal';
import { supportsChatPreferenceV1 } from './channel-preference-evidence';
import { mayOfferCallV1 } from '../../../../src/shared/conversation/bonus-ladder';
import { isBonusCheckoutStateV1 } from '../../../../src/shared/conversation/deterministic-sales-rules';
import { STUDYX_GENERAL_FACTS_V1 } from '../../../../src/shared/catalog/studyx-general-facts';
import { currentFactualCourseReferencesV1, latestAgentTurnMessages,
  type FactualCourseReferenceV1 } from '../../../../src/features/orchestration/domain/course-focus';

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
  'request_course_program',
]);

const LOW_INFORMATION_TOKENS = new Set([
  'buen', 'buenas', 'como', 'cual', 'cuales', 'curso', 'cursos', 'dame',
  'detalle', 'detalles', 'dia', 'disponible', 'disponibles', 'favor', 'hay',
  'hola', 'holi', 'info', 'informacion', 'necesito', 'noche', 'ofrece',
  'ofrecen', 'opcion', 'opciones', 'pasame', 'por', 'que', 'quien', 'quiero',
  'saber', 'sos', 'tarde', 'tenes', 'tienen', 'toda', 'todas', 'todos', 'vos',
]);

// Keep enough complete interventions for conversational continuity. This is
// still bounded, but no longer throws away half of a typical ten-exchange chat.
const LOGICAL_HISTORY_LIMIT = 20;

type LogicalHistoryTurnV1 = {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly content: string;
};

type CurrentLogicalMessageV1 = {
  readonly id: string;
  readonly content: string;
};

/**
 * The database records physical messages, while the brain needs the customer
 * and agent interventions those rows make up. `batch_id` is the durable
 * customer-turn link; `in_reply_to` is the durable causal link shared by all
 * outbound bubbles from one agent turn. Rows without either link stay separate
 * so unrelated legacy rows are never guessed into the same intervention.
 */
function projectLogicalHistoryV1(claimed: ClaimedTurn): readonly LogicalHistoryTurnV1[] {
  const completeLogicalTurns = claimed.context.logical_recent_turns ?? [];
  if (completeLogicalTurns.length > 0) {
    return completeLogicalTurns
      .filter((turn) => turn.content.trim().length > 0)
      .map((turn, index) => ({
        id: `logical:${turn.created_at}:${index}`,
        direction: turn.direction,
        content: turn.content,
      }));
  }

  const projected: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    contents: string[];
  }> = [];
  const indexes = new Map<string, number>();

  for (const [index, turn] of claimed.context.recent_turns.entries()) {
    const content = turn.content;
    if (!content.trim()) continue;
    const relation = turn.direction === 'inbound' ? turn.batch_id : turn.in_reply_to;
    const key = relation === null || relation === undefined
      ? `physical:${index}`
      : `${turn.direction}:${relation}`;
    const existingIndex = indexes.get(key);
    if (existingIndex !== undefined) {
      projected[existingIndex]!.contents.push(content);
      continue;
    }
    indexes.set(key, projected.length);
    projected.push({
      id: `recent:${key}`,
      direction: turn.direction,
      contents: [content],
    });
  }

  return projected.map((turn) => ({
    id: turn.id,
    direction: turn.direction,
    content: turn.contents.join('\n'),
  }));
}

/**
 * A model result can be superseded when another customer message arrives
 * while it is still being generated. The stale reply must stay suppressed,
 * but the customer's unanswered words are still part of the same logical
 * intervention. Carry every inbound intervention after the last delivered
 * outbound into the next claim so contact data, selections and questions are
 * interpreted together instead of being silently lost.
 */
function currentLogicalMessagesV1(claimed: ClaimedTurn): readonly CurrentLogicalMessageV1[] {
  const history = projectLogicalHistoryV1(claimed);
  let lastOutboundIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.direction === 'outbound') {
      lastOutboundIndex = index;
      break;
    }
  }
  const unanswered = history
    .slice(lastOutboundIndex + 1)
    .filter((turn) => turn.direction === 'inbound')
    .map((turn) => ({ id: `unanswered:${turn.id}`, content: turn.content }));
  const current = claimed.context.batch_messages.map((message) => ({
    id: message.id,
    // Provider markers are transport details, not customer language. Keep an
    // inert placeholder in the model context and describe its meaning through
    // `input_capability` below.
    content: message.message_type === 'unsupported'
      ? '[contenido_no_interpretable]'
      : message.content,
  }));
  return [...unanswered, ...current].slice(-20);
}

function inputCapabilityV1(claimed: ClaimedTurn): NonNullable<AgentAContextV1['turn']['input_capability']> {
  const unavailableMessageCount = claimed.context.batch_messages
    .filter((message) => message.message_type === 'unsupported')
    .length;
  if (unavailableMessageCount === 0) {
    return { status: 'understood', unavailable_message_count: 0 };
  }
  if (unavailableMessageCount === claimed.context.batch_messages.length) {
    return {
      status: 'unreadable',
      unavailable_message_count: unavailableMessageCount,
    };
  }
  return {
    status: 'partially_understood',
    unavailable_message_count: unavailableMessageCount,
  };
}

function previousAgentRepliesV1(claimed: ClaimedTurn): readonly string[] {
  return projectLogicalHistoryV1(claimed)
    .filter((turn) => turn.direction === 'outbound')
    .map((turn) => turn.content);
}

function requestedFirstNameBeforeV1(replies: readonly string[]): boolean {
  return replies.some((reply) => {
    const normalized = reply
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es');
    return /\b(?:primer nombre|tu nombre|como te llamas|me dices el nombre|me decis el nombre)\b/u
      .test(normalized);
  });
}

function currentTurnIsUnderspecifiedV1(claimed: ClaimedTurn): boolean {
  const normalized = currentLogicalMessagesV1(claimed)
    .map((message) => message.content)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    // Chat typos commonly stretch the final letter: `holaa`, `infoo`.
    .replace(/([a-z])\1+/gu, '$1')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  if (normalized === '') return true;
  const tokens = normalized.split(/\s+/u);
  return tokens.length <= 5 && tokens.every((token) => LOW_INFORMATION_TOKENS.has(token));
}

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
    // Clarifying a backend-resolved family is safe: it keeps every candidate
    // visible without selecting one. The semantic action is materialized here
    // because a model's generic `unknown` would otherwise discard the
    // resolver's canonical family before the delivery contract can run.
    if (move.move === 'browse_catalog') return move;
    return {
      schema_version: 1,
      move: 'browse_catalog',
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
 * Agent A owns payment meaning, including contextual selections and consent.
 * Keep its structured move intact; canonical resources, intake and paid
 * purchases are checked at the action boundary. Only bind canonical area IDs
 * and the backend's already-established pending call intent here.
 */
export function bindCurrentConversationalIntentToMoveV1(
  move: ConversationMoveV1,
  claimed: ClaimedTurn,
): ConversationMoveV1 {
  // The backend already established unambiguous call consent, but the call
  // cannot run until Telegram supplies a real destination phone. Preserve
  // that intent as structured state while Agent A naturally asks for the
  // missing number; otherwise the next turn forgets why the phone was asked.
  if (claimed.deterministic_route === 'call_phone_required') {
    const {
      payment_plan: _ignoredPaymentPlan,
      area_reference: _ignoredAreaReference,
      ...compatible
    } = move;
    return {
      ...compatible,
      move: 'request_call',
      secondary_moves: compatible.secondary_moves
        .filter((kind) => kind !== 'request_call' && kind !== 'decline_call')
        .slice(0, 2),
      vetoes: compatible.vetoes.filter((veto) => veto !== 'call'),
      confidence: 1,
    };
  }
  if (move.move === 'select_area') {
    const currentBatch = currentLogicalMessagesV1(claimed)
      .map((message) => message.content).join(' ')
      .normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es').replace(/[^a-z0-9]+/gu, ' ').trim();
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
  return move;
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
  for (const item of claimed.context.knowledge_base ?? []) {
    if (item.offering_code !== offeringCode || !item.source_uri.startsWith('knowledge-source:')) continue;
    facts.push({
      id: item.source_uri,
      kind: 'offering_syllabus',
      value: item.content.slice(0, 1_200),
    });
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

function candidateCodes(claimed: ClaimedTurn, selectedCode: string | null, references: readonly FactualCourseReferenceV1[]): string[] {
  if (references.length) return references.map(reference => reference.offeringCode);
  if (claimed.catalog_resolution.kind === 'ambiguous') {
    return claimed.catalog_resolution.candidateCodes.slice(0, 3);
  }
  if (claimed.catalog_resolution.kind === 'not_found') {
    return claimed.catalog_resolution.alternativeCodes.slice(0, 3);
  }
  if (claimed.catalog_resolution.kind === 'no_catalog_intent' && selectedCode === null) {
    const index = claimed.catalog_index?.offerings ?? [];
    for (let turnIndex = claimed.context.recent_turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const normalizedTurn = ` ${claimed.context.recent_turns[turnIndex]!.content
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('es')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()} `;
      const mentioned = index
        .map((offering) => {
          const normalizedName = offering.display_name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/gu, '')
            .toLocaleLowerCase('es')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
          return { code: offering.code, position: normalizedTurn.indexOf(` ${normalizedName} `) };
        })
        .filter((match) => match.position >= 0)
        .sort((left, right) => left.position - right.position);
      if (mentioned.length >= 2) return mentioned.slice(0, 3).map((match) => match.code);
    }
  }
  return (claimed.catalog_index?.offerings ?? [])
    .filter((offering) => offering.code !== selectedCode)
    .slice(0, 3)
    .map((offering) => offering.code);
}

/**
 * Identidad estable que el prompt canónico delega en configuración.
 *
 * La academia sale del snapshot canónico del workspace, no de una variable de
 * proceso: es un hecho de negocio y el backend es su dueño. El nombre del
 * asesor sí es configuración de despliegue — no existe en el catálogo — y
 * llega desde la configuración del bot. Sin nombre de asesor no hay identidad:
 * se devuelve `null` y el prompt canónico viaja sin resolver, antes que
 * inventar quién habla.
 */
function agentAIdentityFromClaim(
  claimed: ClaimedTurn,
  advisorName: string | null,
): AgentAContextV1['identity'] {
  const advisor = advisorName?.trim();
  const academy = claimed.business_context?.workspace.display_name?.trim();
  if (!advisor || !academy) return null;
  return { advisor_name: advisor, academy_name: academy, website: null, instagram: null };
}

/**
 * Fase de venta y su deuda.
 *
 * El comportamiento canónico describe seis fases y `commercial_state.stage`
 * sabe en cuál está la conversación, pero nada las unía: el modelo tenía el
 * mapa y su posición sin que nadie le dijera que eran lo mismo, y sin una
 * obligación explícita respondía bien sin hacer avanzar la venta.
 *
 * Sólo se declara lo que el estado durable sostiene de verdad. Una deuda que
 * hay que adivinar del texto no es una deuda: sería otro filtro léxico.
 */
function salesObligationsV1(input: {
  readonly spokeBefore: boolean;
  readonly courseChosenThisTurn: boolean;
  readonly selectedCode: string | null;
  readonly selectedPlan: string | null;
  readonly stage: string;
  readonly awaitingReply: string;
  readonly paymentReported: boolean;
  readonly intakeMissing: readonly string[];
  readonly maySendPaymentLink: boolean;
}): { owes: string[]; not_yet: string[] } {
  const owes: string[] = [];
  if (!input.spokeBefore) owes.push('greeting');
  if (input.paymentReported) owes.push('payment_acknowledgement');
  if (input.awaitingReply === 'contact_details') {
    owes.push(input.intakeMissing.length > 0 ? 'contact_details' : 'payment_link');
  }
  if (input.courseChosenThisTurn) owes.push('diagnostic_question');
  else if (input.selectedCode !== null && input.selectedPlan === null) {
    owes.push(input.awaitingReply === 'payment_plan' ? 'option_close' : 'presentation');
  }

  const not_yet: string[] = [];
  // Fase 4 del comportamiento canónico: el precio no se da antes de que haya
  // un curso concreto sobre la mesa.
  if (input.selectedCode === null) not_yet.push('price');
  if (!input.maySendPaymentLink) not_yet.push('payment_link');
  return { owes: [...new Set(owes)], not_yet };
}

/**
 * Opciones de construcción del contexto.
 *
 * `rigidObligations` conserva la variante anterior —la que declaraba una deuda
 * de fase en cada turno— para poder caracterizarla y compararla. Está apagada
 * por defecto: el ensayo sobre turnos reales mostró que exigía `presentation`
 * en 13 de 34 turnos, incluido el de quien acababa de avisar que pagó, porque
 * la derivaba de `stage`, y `stage` no distingue diagnóstico de presentación
 * ni de precio: los tres son `course_selected`.
 */
export interface BuildAgentAContextOptionsV1 {
  readonly rigidObligations?: boolean;
}

export function buildAgentAContextV1(
  claimed: ClaimedTurn,
  advisorName: string | null = null,
  options: BuildAgentAContextOptionsV1 = {},
): AgentAContextV1 | null {
  const state = claimed.conversation_state_v1;
  if (!state) return null;
  const index = claimed.catalog_index?.offerings ?? [];
  const factualReferences = claimed.catalog_resolution.kind === 'no_catalog_intent' || claimed.catalog_resolution.kind === 'not_found'
    ? currentFactualCourseReferencesV1(claimed.context.batch_messages.map(message => message.content),
      claimed.catalog_index, latestAgentTurnMessages(claimed.context.logical_recent_turns ?? claimed.context.recent_turns)) : [];
  // Persisted conversation state remains authoritative across turns. An exact
  // catalog resolution says which course the customer is talking about now;
  // it does not prove they replaced the course already chosen for the sale.
  // Expose the referenced course as catalog focus while keeping the durable
  // selection untouched until the model emits an authorized `select_course`.
  const currentCode = claimed.catalog_resolution.kind === 'exact'
    ? claimed.catalog_resolution.offeringCode
    : null;
  // A terminal checkout cannot lend its closed stage, paid-plan flags or two
  // spent call invitations to a later exact inquiry about another course.
  // This is an effective projection for the model; the accepted turn below
  // persists the same boundary through the authority reducer.
  const currentCodeBelongsToPackage = currentCode !== null
    && (currentCode === claimed.course_bonus_capability?.interest_offering_code
      || claimed.course_bonus_capability?.bonus_offerings.some((offering) => offering.code === currentCode) === true);
  const startsFreshInterestCycle = currentCode !== null
    && currentCode !== state.selected_offering_code
    && !currentCodeBelongsToPackage
    && state.stage === 'closed';
  const effectiveStage = startsFreshInterestCycle ? 'exploring' as const : state.stage;
  const effectiveCallPreference = startsFreshInterestCycle ? 'unknown' as const : state.call_preference;
  const effectiveCallOfferStatus = startsFreshInterestCycle ? 'not_offered' as const : state.call_offer_status;
  const effectiveAwaitingReply = startsFreshInterestCycle ? 'none' as const : state.awaiting_reply;
  const effectivePaymentReported = startsFreshInterestCycle ? false : state.payment_reported === true;
  // Un turno vago no deja que una memoria vieja conteste por el cliente: de
  // ahí salía un curso que el mensaje actual nunca nombró. Las memorias se
  // recuperan por similitud y cruzan sesiones, así que son las únicas que
  // hace falta acotar al turno.
  //
  // Lo que un turno vago NO hace es cancelar la venta en curso. El curso y
  // los permisos comerciales salen del estado durable, que el backend ya
  // entrega con la sesión caducada (`claim-batch` aplica
  // `effectiveConversationStateV1`) y vuelve a verificar al autorizar el
  // turno. Acotarlos acá dejaba al ADK más estricto que su propia autoridad
  // y apagaba en silencio el ofrecimiento de llamada y la presentación de
  // planes a mitad de una compra: `may_offer_call`,
  // `may_present_payment_options` y `may_send_payment_link` cuelgan todos de
  // este código.
  const wanderingTurn = currentCode === null
    && state.awaiting_reply === 'none'
    && state.selected_payment_plan === null
    && state.payment_reported !== true
    && currentTurnIsUnderspecifiedV1(claimed);
  const selectedCode = startsFreshInterestCycle ? null : state.selected_offering_code;
  const catalogFocusCode = currentCode ?? selectedCode;
  const baseSelectedOffering = catalogFocusCode
    ? selectedOfferingFacts(claimed, catalogFocusCode)
    : null;
  // Gabi's ficha of the course in focus; the backend only sends the focus and
  // the current bonus candidates, never the whole manual.
  const focusFicha = claimed.catalog_fichas?.find((ficha) => ficha.role === 'focus'
    && ficha.offering_code === catalogFocusCode);
  const selectedOffering = baseSelectedOffering && focusFicha
    ? { ...baseSelectedOffering, facts: [...baseSelectedOffering.facts,
        { id: focusFicha.fact_id, kind: 'offering_syllabus' as const, value: focusFicha.value }] }
    : baseSelectedOffering;
  const bonusCandidateCodes = new Set(!startsFreshInterestCycle
    ? claimed.course_bonus_capability?.bonus_candidates?.map((candidate) => candidate.code) ?? [] : []);
  const bonusCandidateFichas = (claimed.catalog_fichas ?? [])
    .filter((ficha) => ficha.role === 'bonus_candidate' && bonusCandidateCodes.has(ficha.offering_code))
    .map((ficha) => ({ code: ficha.offering_code,
      fact: { id: ficha.fact_id, kind: 'offering_syllabus' as const, value: ficha.value } }));
  const areas = new Map<string, string>();
  for (const offering of index) {
    const code = areaCode(offering.academy);
    if (code && offering.academy) areas.set(code, offering.academy);
  }
  const candidates = candidateCodes(claimed, catalogFocusCode, factualReferences)
    .map((code) => index.find((offering) => offering.code === code))
    .filter((offering): offering is NonNullable<typeof offering> => offering !== undefined)
    .map((offering) => ({
      code: offering.code,
      fact_id: `offering:${offering.code}:name:v1`,
      display_name: offering.display_name,
      area_code: areaCode(offering.academy),
      ...(factualReferences.some(reference => reference.offeringCode === offering.code) ? {
        reference: { source: factualReferences.find(reference => reference.offeringCode === offering.code)!.source,
          matched_terms: factualReferences.find(reference => reference.offeringCode === offering.code)!.matchedTerms },
      } : {}),
      // Keep candidate detail bounded to the three visible courses. Payment
      // facts remain scoped to an explicitly selected course.
      facts: (selectedOfferingFacts(claimed, offering.code)?.facts ?? [])
        .filter((fact) => fact.kind === 'offering_description'
          || fact.kind === 'offering_duration'
          || fact.kind === 'offering_modality' || fact.kind === 'offering_syllabus').slice(0, 4),
    }));
  const callOfferCount = startsFreshInterestCycle
    ? 0
    : state.call_offer_count ?? (state.call_offer_status === 'not_offered' ? 0 : 1);
  const selectedPlan = selectedCode === null ? null : state.selected_payment_plan;
  const suppressContactMemories = wanderingTurn;
  // El scoping gobierna qué memorias se muestran, nunca qué datos faltan.
  // Atarle el intake convertía «nadie consultó» en «no falta nada», y con el
  // flag apagado —que es el default— el contexto declaraba intake completo
  // sobre un contacto del que no sabía nada.
  const intakeAnswered = Array.isArray(claimed.contact_intake_missing);
  const intakeMissing = intakeAnswered ? claimed.contact_intake_missing! : [];
  const callIntakeReadiness = claimed.call_intake_readiness;
  const callRequirements = callIntakeReadiness?.status === 'unknown'
    ? []
    : callIntakeReadiness?.requirements ?? [];
  const requiredContactFields = {
    call: callRequirements.map(({ field }) => field),
    // El alta y el pago usan la ficha completa. Mantener esta lista derivada
    // de la autoridad evita que el prompt adivine qué dato falta.
    payment: [...intakeMissing],
    identity: [...intakeMissing],
  };
  const intakeStatus: 'known' | 'unknown' = intakeAnswered ? 'known' : 'unknown';
  const firstNameKnownNow = Boolean(claimed.contact.name?.trim())
    || (intakeAnswered && !intakeMissing.includes('nombre'));
  const logicalHistory = projectLogicalHistoryV1(claimed);
  const currentLogicalMessages = currentLogicalMessagesV1(claimed);
  const currentSalesSignal = classifyBatchSalesSignal(
    currentLogicalMessages.map((message) => message.content),
    { pendingCallReply: effectiveAwaitingReply === 'call_or_chat' },
  );
  const currentCallAuthorization = currentSalesSignal.type === 'direct_call_request';
  const inputCapability = inputCapabilityV1(claimed);
  const hasReadableCurrentInput = inputCapability.status !== 'unreadable';
  const previousAgentReplies = previousAgentRepliesV1(claimed);
  const lastAgentReply = previousAgentReplies.at(-1) ?? null;
  const firstNameStatus = firstNameKnownNow
    ? 'known' as const
    : requestedFirstNameBeforeV1(previousAgentReplies)
      ? 'requested' as const
      : 'missing' as const;
  // This is resource availability, not consent and not a persisted-plan
  // requirement. Agent A may select a canonical plan and request its link in
  // this turn; the proposal and backend still authorize the exact purchase.
  const paymentOptions = claimed.business_context?.workspace.payment_options ?? [];
  const maySendPaymentLink = claimed.policy.may_respond
    && !claimed.contact.blocked
    && selectedCode !== null
    && index.some((offering) => offering.code === selectedCode)
    && selectedOffering?.code === selectedCode
    && paymentOptions.some((option) => !(claimed.payment_verification?.status === 'paid'
      && claimed.payment_verification.paid_at !== null
      && claimed.payment_verification.offering_code === selectedCode
      && claimed.payment_verification.plan_code === option.code))
    && intakeStatus === 'known'
    && intakeMissing.length === 0;
  const obligations = options.rigidObligations !== true ? null : salesObligationsV1({
    spokeBefore: claimed.context.recent_turns.some((turn) => turn.direction === 'outbound'),
    courseChosenThisTurn: false,
    selectedCode,
    selectedPlan,
    stage: effectiveStage,
    awaitingReply: effectiveAwaitingReply,
    paymentReported: effectivePaymentReported,
    intakeMissing,
    maySendPaymentLink,
  });
  const nonBlankOrNull = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  const canonicalContactIntake = claimed.contact_intake
    ? {
        nombre: nonBlankOrNull(claimed.contact_intake.nombre),
        apellido: nonBlankOrNull(claimed.contact_intake.apellido),
        correo: nonBlankOrNull(claimed.contact_intake.correo),
        telefono: nonBlankOrNull(claimed.contact_intake.telefono),
      }
    : null;
  const awaitingCallAvailability = effectiveCallPreference === 'call'
    && effectiveCallOfferStatus === 'accepted'
    && effectiveAwaitingReply === 'call_or_chat';
  const availabilityConfirmed = currentSalesSignal.type === 'direct_call_request'
    || currentSalesSignal.type === 'call_acceptance';
  const currentTurnChoosesChat = supportsChatPreferenceV1(
    currentLogicalMessages.map((message) => message.content).join('\n'),
    awaitingCallAvailability,
  );
  const callIntentRemainsActive = currentSalesSignal.type !== 'call_decline'
    && currentSalesSignal.type !== 'opt_out'
    && !currentTurnChoosesChat;
  const mayRequestCallNow = claimed.policy.may_respond
    && hasReadableCurrentInput
    && !claimed.contact.blocked
    && claimed.sales_context.active_call === null
    && (currentCallAuthorization || (
      awaitingCallAvailability
      && availabilityConfirmed
    ))
    && !['handoff', 'closed'].includes(effectiveStage)
    && callIntakeReadiness?.status === 'ready';
  const callExecutionNextStep = mayRequestCallNow
    ? 'dispatch_authorized' as const
    : callIntentRemainsActive
      && (currentCallAuthorization
        || (effectiveCallPreference === 'call' && effectiveCallOfferStatus === 'accepted'))
      && requiredContactFields.call.length > 0
      ? 'collect_contact_details' as const
      : callIntentRemainsActive && awaitingCallAvailability
        ? 'confirm_availability' as const
        : 'none' as const;

  const mayOfferCall = mayOfferCallV1({
    may_respond: claimed.policy.may_respond,
    blocked: claimed.contact.blocked,
    active_call: claimed.sales_context.active_call,
    call_preference: effectiveCallPreference,
    call_offer_status: effectiveCallOfferStatus,
    stage: effectiveStage,
    payment_reported: effectivePaymentReported,
    call_offer_count: callOfferCount,
  });
  // Persisted data only (decision memories, sales state, promotion tables). The
  // vector top-5 below can drop the customer's goal; this block cannot.
  const emptyProfile = { objective: [], experience: [], tentative_interest: [], objections: [],
    constraints: [], preferences: [], timeline: [], contact_preference: [] };
  const bonusCapability = startsFreshInterestCycle ? null : claimed.course_bonus_capability ?? null;
  const salesProfile = {
    ...(claimed.sales_profile ?? emptyProfile),
    selected_course: selectedCode === null ? null : {
      code: selectedCode,
      name: index.find((offering) => offering.code === selectedCode)?.display_name ?? selectedCode,
    },
    // A declined call is a customer choosing chat.
    call_preference: currentTurnChoosesChat || effectiveCallPreference === 'chat' || effectiveCallPreference === 'declined'
      ? 'chat' as const : effectiveCallPreference === 'call' ? 'call' as const : 'unknown' as const,
    active_promotion: bonusCapability?.promotion_code && bonusCapability.interest_offering_code
      && bonusCapability.package_status
      ? {
          promotion_code: bonusCapability.promotion_code,
          interest_offering_code: bonusCapability.interest_offering_code,
          status: bonusCapability.package_status === 'accepted' || bonusCapability.package_status === 'attached'
            ? 'accepted' as const : bonusCapability.package_status === 'expired' ? 'expired' as const
              : bonusCapability.package_status === 'cancelled' ? 'cancelled' as const : 'offer_available' as const,
        } : null,
    bonus_courses: (bonusCapability?.bonus_offerings ?? []).filter((course) => course.offered_at)
      .map((course) => ({ code: course.code, name: course.display_name, position: course.position })),
    missing_data: intakeMissing,
    next_allowed_effects: [
      ...(mayOfferCall ? ['offer_call'] : []),
      ...(mayRequestCallNow ? ['request_call_now'] : []),
      ...(claimed.policy.may_respond && paymentOptions.length > 0 ? ['present_payment_options'] : []),
      ...(hasReadableCurrentInput && maySendPaymentLink ? ['send_payment_link'] : []),
      // Only a current backend permission can reopen an unpaid checkout; it remains a capability, not an order.
      ...(bonusCapability?.may_offer_bonus && !isBonusCheckoutStateV1({ stage: effectiveStage,
        awaiting_reply: effectiveAwaitingReply,
        payment_link_request_pending: !startsFreshInterestCycle && state.payment_link_request?.status === 'pending',
        may_reopen_negotiation: bonusCapability.may_reopen_negotiation })
        ? ['offer_course_bonus_requires_current_motive']
        : []),
      ...(bonusCapability?.may_accept_offer ? ['accept_promotion'] : []),
    ],
    retention_used: bonusCapability?.sales_flow?.retention_used ?? bonusCapability?.ladder?.retention_used ?? null,
  };
  return AgentAContextV1Schema.parse({
    schema_version: 1,
    turn: {
      batch_messages: currentLogicalMessages.map((message) => ({
        id: message.id,
        text: message.content,
      })),
      input_capability: inputCapability,
      recent_turns: logicalHistory.slice(-LOGICAL_HISTORY_LIMIT).map((turn) => ({
        id: turn.id,
        direction: turn.direction,
        content: turn.content,
      })),
    },
    continuity: {
      assistant_has_spoken: previousAgentReplies.length > 0,
      first_name_status: firstNameStatus,
      last_agent_reply: lastAgentReply,
      ...(claimed.continuity && claimed.continuity.prior_already_said.length > 0
        ? { prior_already_said: [...claimed.continuity.prior_already_said] } : {}),
    },
    customer: {
      display_name: nonBlankOrNull(claimed.contact.name),
      conversation_summary: claimed.context.summary.text?.trim()
        ? {
            text: claimed.context.summary.text.trim(),
            version: claimed.context.summary.version,
            updated_at: claimed.context.summary.updated_at,
          }
        : null,
      contact_intake: canonicalContactIntake,
      ...(claimed.contact_profile ? { contact_profile: claimed.contact_profile } : {}),
      memories: (suppressContactMemories ? [] : [...claimed.context.selected_memories])
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
    identity: agentAIdentityFromClaim(claimed, advisorName),
    commercial_state: {
      sales_profile: salesProfile,
      ...(claimed.sale_continuity && claimed.sale_continuity.status !== 'none'
        ? { sale_continuity: claimed.sale_continuity } : {}),
      negotiation: {
        price_objections: {
          count: claimed.negotiation_facts?.price_objection_count ?? null,
          scope: 'conversation_prior_recorded_sources',
          latest_source_turn_ids: claimed.negotiation_facts?.latest_price_objection_source_turn_ids ?? [],
          latest_legacy_source_message_ids: claimed.negotiation_facts?.latest_legacy_price_objection_source_message_ids ?? [],
        },
        price_only_barrier: claimed.negotiation_facts?.price_only_barrier.status !== 'unknown'
          && claimed.negotiation_facts?.price_only_barrier.offering_code === selectedCode
          ? claimed.negotiation_facts.price_only_barrier : { status: 'unknown' },
        call_invitation: { status: effectiveCallOfferStatus, count: callOfferCount,
          authorization: mayOfferCall ? 'authorized' : 'not_authorized' },
        delivered_bonus_offers: claimed.course_bonus_capability?.delivered_bonus_offerings ?? null,
      },
      promotion: !startsFreshInterestCycle
        && claimed.course_bonus_capability?.promotion_code && claimed.course_bonus_capability.promotion_cycle_id
        && claimed.course_bonus_capability.offer_version && claimed.course_bonus_capability.interest_offering_code
        && claimed.course_bonus_capability.package_status
        && claimed.course_bonus_capability.bonus_offerings.length>0
        && claimed.course_bonus_capability.bonus_offerings.every(course => course.offered_at)
        ? {
          promotion_code:claimed.course_bonus_capability.promotion_code,
          promotion_cycle_id:claimed.course_bonus_capability.promotion_cycle_id,
          offer_version:claimed.course_bonus_capability.offer_version,
          interest_offering_code:claimed.course_bonus_capability.interest_offering_code,
          status:claimed.course_bonus_capability.package_status === 'accepted' || claimed.course_bonus_capability.package_status === 'attached'
            ? 'accepted' : claimed.course_bonus_capability.package_status === 'expired' ? 'expired'
              : claimed.course_bonus_capability.package_status === 'cancelled' ? 'cancelled' : 'offer_available',
          accepted_at:claimed.course_bonus_capability.accepted_at ?? null,
          courses_in_package:1+claimed.course_bonus_capability.bonus_offerings.length,
          courses_in_package_after_next_offer:Math.min(4,2+claimed.course_bonus_capability.bonus_offerings.length),
          bonus_offerings:claimed.course_bonus_capability.bonus_offerings.map(course => ({
            offering_code:course.code,name:course.display_name,offered_at:course.offered_at!,position:course.position,
          })),
        } : null,
      selected_offering_code: selectedCode,
      selected_payment_plan: selectedPlan,
      stage: effectiveStage,
      call_preference: effectiveCallPreference,
      call_offer_status: effectiveCallOfferStatus,
      call_offer_count: callOfferCount,
      active_call: claimed.sales_context.active_call,
      last_call_result: claimed.sales_context.last_call_result,
      awaiting_reply: effectiveAwaitingReply,
      // The customer already said they paid. The model must be able to see
      // that so it neither asks for the payment again nor claims it is
      // verified — this field is the claim, never a verification.
      payment_reported: effectivePaymentReported,
      payment_verification: claimed.payment_verification ?? null,
      payment_link_request: startsFreshInterestCycle || state.payment_link_request === undefined
        ? null
        : state.payment_link_request === null
          ? null
          : {
              status: state.payment_link_request.status,
              offering_code: state.payment_link_request.offering_code,
              payment_plan: state.payment_link_request.payment_plan,
            },
    },
    // Ausente salvo en la variante rígida: `commercial_state` ya describe los
    // hechos persistidos y el preámbulo explica que eso no son fases de venta
    // cumplidas. Una deuda calculada encima volvía a imponer un recorrido.
    ...(obligations === null ? {} : {
      obligations: {
        stage: effectiveStage,
        owes: obligations.owes,
        not_yet: obligations.not_yet,
      },
    }),
    catalog: {
      selected_offering: selectedOffering && factualReferences.length
        && !factualReferences.some(reference => reference.offeringCode === selectedOffering.code)
        ? { ...selectedOffering, facts: selectedOffering.facts.filter(fact => fact.kind === 'offering_name') }
        : selectedOffering,
      // The brain owns catalog-language interpretation. Keep the complete
      // compact identity index visible even after a course was selected so a
      // later explicit request for the full catalog can be answered without
      // guessing, losing the active sale, or relying on a three-item hint.
      available_offerings: [...index]
        .sort((left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
        .map((offering) => ({
          code: offering.code,
          fact_id: `offering:${offering.code}:name:v1`,
          display_name: offering.display_name,
          area_code: areaCode(offering.academy),
        })),
      areas: [...areas].map(([code, display_name]) => ({
        code,
        fact_id: `area:${code}:name:v1`,
        display_name,
      })),
      general_facts: STUDYX_GENERAL_FACTS_V1.map((fact) => ({ ...fact })),
      ...(bonusCandidateFichas.length ? { bonus_candidate_fichas: bonusCandidateFichas } : {}),
      // Con una venta enfocada las alternativas distraen, así que no viajan.
      // Pero si la persona dejó de apuntar a algo concreto y no hay paso
      // pendiente, una lista vacía es justamente lo que dejaba al modelo sin
      // nada que ofrecer: ahí las alternativas son la respuesta.
      candidate_offerings: selectedOffering && !wanderingTurn && !factualReferences.length ? [] : candidates,
      // Older in-process doubles used `none`; expose the canonical neutral
      // status rather than leaking that producer-only compatibility value to
      // the model contract.
      resolution: (claimed.catalog_resolution as { kind: string }).kind === 'none'
        ? 'no_catalog_intent'
        : claimed.catalog_resolution.kind,
      // Browsing a configured workspace plan is not a course selection or
      // permission to charge. Keep its scope explicit in the canonical ID.
      payment_plans: (claimed.business_context?.workspace.payment_options ?? []).map((option) => ({
        code: option.code,
        fact_id: selectedOffering === null
          ? `payment-workspace:${option.code}:label:v1`
          : `payment:${selectedOffering.code}:${option.code}:label:v1`,
        label: option.label,
      })),
      // Visible to the conversational owner as an authorized option, but kept
      // outside payment_plans so it can never become the sale's selected plan.
      test_payment_options: [{
        code: 'stripe_verification_050',
        fact_id: 'payment-test:stripe_verification_050:label:v1',
        label: 'Prueba temporal de pago de USD 0,50',
        action: 'send_test_payment_link',
      }],
    },
    capabilities: {
      may_reply: claimed.policy.may_respond,
      may_offer_call: mayOfferCall,
      // A direct request is sufficient in this turn. A short acceptance is
      // sufficient only after the persisted availability question, never
      // while an invitation or contact-data request is still pending.
      may_request_call_now: mayRequestCallNow,
      may_present_payment_options: claimed.policy.may_respond
        && (claimed.business_context?.workspace.payment_options.length ?? 0) > 0,
      may_send_payment_link: hasReadableCurrentInput && maySendPaymentLink,
      ...(!startsFreshInterestCycle && claimed.course_bonus_capability
        ? { course_bonus: claimed.course_bonus_capability.sales_flow === undefined
          ? claimed.course_bonus_capability
          : { ...claimed.course_bonus_capability, sales_flow: {
            retention_used: claimed.course_bonus_capability.sales_flow.retention_used,
            promo_expires_at: claimed.course_bonus_capability.sales_flow.promo_expires_at } } }
        : {}),
      ...(claimed.course_programs ? { course_programs: claimed.course_programs } : {}),
      intake_status: intakeStatus,
      authorized_payment_plan: selectedPlan,
      intake_missing: intakeMissing,
      required_contact_fields: requiredContactFields,
      call_contact_requirements: callRequirements,
      call_execution: {
        next_step: callExecutionNextStep,
        request_call_now_authorized: mayRequestCallNow,
      },
    },
  });
}
