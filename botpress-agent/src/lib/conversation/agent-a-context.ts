import {
  AgentAContextV1Schema,
  type AgentAContextV1,
} from '../../schemas/agent-a-brain';
import type { ClaimedTurn } from '../../schemas/contracts';
import type { ConversationMoveV1 } from '../../schemas/conversation-pipeline';
import {
  classifyCurrentPaymentIntent,
  derivePaymentPlanSelectionFromBatch,
  hasExplicitPurchaseDecline,
  hasTemporalPaymentDeferral,
} from '../../utils/payment-choice';

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
  'select_payment_plan',
  'defer_payment',
  'request_payment_link',
  'decline_purchase',
]);

const LOW_INFORMATION_TOKENS = new Set([
  'buen', 'buenas', 'como', 'cual', 'cuales', 'curso', 'cursos', 'dame',
  'detalle', 'detalles', 'dia', 'disponible', 'disponibles', 'favor', 'hay',
  'hola', 'holi', 'info', 'informacion', 'necesito', 'noche', 'ofrece',
  'ofrecen', 'opcion', 'opciones', 'pasame', 'por', 'que', 'quien', 'quiero',
  'saber', 'sos', 'tarde', 'tenes', 'tienen', 'toda', 'todas', 'todos', 'vos',
]);

function currentTurnIsUnderspecifiedV1(claimed: ClaimedTurn): boolean {
  const normalized = claimed.context.batch_messages
    .filter((message) => message.message_type === 'text')
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
 * Vinculación de dinero y área desde el mensaje ACTUAL.
 *
 * Ya no clasifica intención: DeepSeek elige el `move`. Lo único que el backend
 * sigue imponiendo acá es la selección de plan de pago derivada del mensaje
 * actual o de una aceptación corta de la única opción del último outbound
 * —nunca de la memoria— y la desambiguación de un área nombrada. Son las dos
 * cosas cuyo error cuesta dinero o manda al cliente a otro lado.
 */
export function bindCurrentConversationalIntentToMoveV1(
  move: ConversationMoveV1,
  claimed: ClaimedTurn,
): ConversationMoveV1 {
  const currentBatchMessages = claimed.context.batch_messages
    .filter((message) => message.message_type === 'text')
    .map((message) => ({ content: message.content }));
  const currentBatch = currentBatchMessages
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
  const explicitPaymentPlan = derivePaymentPlanSelectionFromBatch(currentBatchMessages);
  const currentPaymentIntent = classifyCurrentPaymentIntent(currentBatchMessages);
  const shortContextualAcceptance = /^(?:si(?:\s+por\s+favor)?|dale|de\s+una|bueno|ok|okay|perfecto|listo)$/u
    .test(currentBatch);
  const previousTurn = claimed.context.recent_turns.at(-1);
  const lastAgentReply = previousTurn?.direction === 'outbound'
    ? previousTurn.content
    : undefined;
  const contextualPaymentPlan = shortContextualAcceptance && lastAgentReply
    ? derivePaymentPlanSelectionFromBatch([{ content: lastAgentReply }])
    : null;
  const awaitingPaymentReply = claimed.conversation_state_v1?.awaiting_reply === 'payment_confirmation'
    || claimed.conversation_state_v1?.awaiting_reply === 'contact_details';
  const currentPaymentDeferral = hasTemporalPaymentDeferral(
    currentBatchMessages,
    awaitingPaymentReply,
  );
  const currentPurchaseDecline = hasExplicitPurchaseDecline(currentBatchMessages);
  const unsupportedDeferral = !currentPaymentDeferral;
  const unsupportedDecline = !currentPurchaseDecline;
  const sanitizedSecondaryMoves = [...new Set(move.secondary_moves
    .map((kind): ConversationMoveV1['move'] => (
      kind === 'decline_purchase' && unsupportedDecline && currentPaymentDeferral
        ? 'defer_payment'
        : kind
    ))
    .filter((kind) => !(
      (kind === 'defer_payment' && unsupportedDeferral)
      || (kind === 'decline_purchase' && unsupportedDecline)
    )))].filter((kind) => kind !== move.move).slice(0, 2);
  const secondaryMovesChanged = sanitizedSecondaryMoves.length !== move.secondary_moves.length
    || sanitizedSecondaryMoves.some((kind, index) => kind !== move.secondary_moves[index]);
  if (move.move === 'decline_purchase' && unsupportedDecline && currentPaymentDeferral) {
    const { payment_plan: _ignoredPaymentPlan, ...withoutPlan } = move;
    return {
      ...withoutPlan,
      move: 'defer_payment',
      secondary_moves: sanitizedSecondaryMoves,
      vetoes: withoutPlan.vetoes.filter((veto) => veto !== 'purchase'),
      confidence: 1,
    };
  }
  const unsupportedPrimaryExit = (move.move === 'defer_payment' && unsupportedDeferral)
    || (move.move === 'decline_purchase' && unsupportedDecline);
  if (unsupportedPrimaryExit) {
    const continuePendingIntake = claimed.conversation_state_v1?.awaiting_reply === 'contact_details';
    const { payment_plan: _ignoredPaymentPlan, ...withoutPlan } = move;
    return {
      ...withoutPlan,
      move: continuePendingIntake ? 'provide_contact_details' : 'unknown',
      secondary_moves: sanitizedSecondaryMoves.filter((kind) => !PAYMENT_INTENT_MOVES.has(kind)),
      vetoes: withoutPlan.vetoes.filter((veto) => veto !== 'payment_link' && veto !== 'purchase'),
      confidence: 1,
    };
  }
  if (secondaryMovesChanged) {
    return {
      ...move,
      secondary_moves: sanitizedSecondaryMoves,
      vetoes: move.vetoes.filter((veto) => (
        !(unsupportedDeferral && veto === 'payment_link')
        && !(unsupportedDecline && veto === 'purchase')
      )),
    };
  }
  if (move.move === 'select_payment_plan' && currentPaymentIntent.kind === 'none') {
    if (contextualPaymentPlan !== null) {
      return { ...move, payment_plan: contextualPaymentPlan };
    }
    const { payment_plan: _ignoredPaymentPlan, ...withoutPlan } = move;
    return {
      ...withoutPlan,
      move: 'ask_payment_options',
      secondary_moves: withoutPlan.secondary_moves.filter((kind) => !PAYMENT_INTENT_MOVES.has(kind)),
      confidence: 1,
    };
  }
  if (explicitPaymentPlan && move.move === 'request_payment_link') {
    return {
      ...move,
      payment_plan: explicitPaymentPlan,
      // The planner makes the dependency explicit: select first, then request.
      // This is authority derived from the current batch, never from memory.
      secondary_moves: [...new Set([
        'select_payment_plan' as const,
        ...move.secondary_moves,
      ])].filter((kind) => kind !== move.move).slice(0, 2),
    };
  }
  if (explicitPaymentPlan && move.move === 'select_payment_plan') {
    const bound = { ...move, payment_plan: explicitPaymentPlan };
    if (
      (explicitLinkRequest || resumesDeferredLink)
      && !move.vetoes.includes('payment_link')
      && !move.vetoes.includes('purchase')
    ) {
      return {
        ...bound,
        secondary_moves: [...new Set([
          ...bound.secondary_moves,
          'request_payment_link' as const,
        ])].slice(0, 2),
      };
    }
    return bound;
  }
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
  // Las dos reescrituras de intención que vivían acá —forzar
  // `ask_course_information` ante una pregunta de precio, y forzar
  // `browse_catalog` ante «info»— se eliminaron: DeepSeek elige la intención.
  // El backend sólo sigue vinculando lo que es dinero (el plan de pago
  // explícito del mensaje actual) y la desambiguación de área.
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
  // Persisted conversation state remains authoritative across turns. Within
  // the current turn, an exact backend catalog resolution is newer evidence:
  // expose its facts to the brain and clear any plan belonging to another
  // course. The planner will persist the transition atomically at commit.
  const currentCode = claimed.catalog_resolution.kind === 'exact'
    ? claimed.catalog_resolution.offeringCode
    : null;
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
  const suppressContactMemories = wanderingTurn;
  // El scoping gobierna qué memorias se muestran, nunca qué datos faltan.
  // Atarle el intake convertía «nadie consultó» en «no falta nada», y con el
  // flag apagado —que es el default— el contexto declaraba intake completo
  // sobre un contacto del que no sabía nada.
  const intakeAnswered = Array.isArray(claimed.contact_intake_missing);
  const intakeMissing = intakeAnswered ? claimed.contact_intake_missing! : [];
  const intakeStatus: 'known' | 'unknown' = intakeAnswered ? 'known' : 'unknown';
  // Desconocido no abre el gate. La única lectura segura de una respuesta que
  // nadie dio es que todavía falta algo.
  const maySendPaymentLink = claimed.policy.may_respond
    && selectedCode !== null
    && selectedPlan !== null
    && state.stage !== 'payment_link_sent'
    && intakeStatus === 'known'
    && intakeMissing.length === 0;
  const obligations = options.rigidObligations !== true ? null : salesObligationsV1({
    spokeBefore: claimed.context.recent_turns.some((turn) => turn.direction === 'outbound'),
    courseChosenThisTurn: currentCourseChanged,
    selectedCode,
    selectedPlan,
    stage: state.stage,
    awaitingReply: state.awaiting_reply,
    paymentReported: state.payment_reported === true,
    intakeMissing,
    maySendPaymentLink,
  });

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
      selected_offering_code: selectedCode,
      selected_payment_plan: selectedPlan,
      // Ocultar el curso y seguir diciendo `course_selected` describiría un
      // estado que el modelo no puede ver: el turno vuelve a exploración.
      stage: currentCourseChanged ? 'course_selected' : state.stage,
      call_preference: state.call_preference,
      call_offer_status: state.call_offer_status,
      call_offer_count: callOfferCount,
      awaiting_reply: currentCourseChanged ? 'none' : state.awaiting_reply,
      // The customer already said they paid. The model must be able to see
      // that so it neither asks for the payment again nor claims it is
      // verified — this field is the claim, never a verification.
      payment_reported: state.payment_reported === true,
    },
    // Ausente salvo en la variante rígida: `commercial_state` ya describe los
    // hechos persistidos y el preámbulo explica que eso no son fases de venta
    // cumplidas. Una deuda calculada encima volvía a imponer un recorrido.
    ...(obligations === null ? {} : {
      obligations: {
        stage: currentCourseChanged ? 'course_selected' : state.stage,
        owes: obligations.owes,
        not_yet: obligations.not_yet,
      },
    }),
    catalog: {
      selected_offering: selectedOffering,
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
      // Con una venta enfocada las alternativas distraen, así que no viajan.
      // Pero si la persona dejó de apuntar a algo concreto y no hay paso
      // pendiente, una lista vacía es justamente lo que dejaba al modelo sin
      // nada que ofrecer: ahí las alternativas son la respuesta.
      candidate_offerings: selectedOffering && !wanderingTurn ? [] : candidates,
      // El id sigue el esquema del registro canónico del backend, igual que
      // `area:<code>:name:v1` arriba. Sin offering seleccionado no hay plan que
      // referenciar, así que la lista queda vacía.
      payment_plans: selectedOffering === null
        ? []
        : (claimed.business_context?.workspace.payment_options ?? []).map((option) => ({
          code: option.code,
          fact_id: `payment:${selectedOffering.code}:${option.code}:label:v1`,
          label: option.label,
        })),
    },
    capabilities: {
      may_reply: claimed.policy.may_respond,
      may_offer_call: claimed.policy.may_respond
        && intakeStatus === 'known'
        && !intakeMissing.includes('nombre')
        && state.call_preference === 'unknown'
        && callOfferCount < 2,
      may_request_call_now: claimed.policy.may_respond
        && !claimed.contact.blocked
        && claimed.sales_context.allowed_actions.includes('request_call_now'),
      may_present_payment_options: claimed.policy.may_respond
        && selectedCode !== null
        && (claimed.business_context?.workspace.payment_options.length ?? 0) > 0,
      may_send_payment_link: maySendPaymentLink,
      intake_status: intakeStatus,
      authorized_payment_plan: selectedPlan,
      intake_missing: intakeMissing,
    },
  });
}
