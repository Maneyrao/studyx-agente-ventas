/**
 * Owner decision (2026-11-02), exception to the authority prompt: the backend
 * decides WHEN (rule A bonus, rule B call) and WHICH bonus course; the model
 * writes the whole turn; a fixed fallback replaces the turn only when the model
 * fails to present the decided effect after one rewrite. See AGENTS.md.
 *
 * Pure functions only: no I/O, no customer-text interpretation beyond the
 * logged price-expression hint, which never triggers anything by itself.
 */

/** Gabi's affinity map (docs/authority/prompt-agente-a-studyx-v2.md:142-187),
 * flattened per paid course: same path → complementary → bridge. Codes absent
 * from the active catalog are skipped at runtime; never invented. */
export const BONUS_AFFINITY_TABLE_V1: Readonly<Record<string, readonly string[]>> = {
  marketing_digital: ['publicidad_redes_sociales', 'especialista_marketing', 'diseno_photoshop'],
  publicidad_redes_sociales: ['marketing_digital', 'especialista_marketing', 'community_manager'],
  especialista_marketing: ['marketing_digital', 'publicidad_redes_sociales', 'especialista_ventas'],
  community_manager: ['influencers_creadores_contenidos', 'publicidad_redes_sociales', 'diseno_photoshop'],
  influencers_creadores_contenidos: ['community_manager', 'publicidad_redes_sociales', 'oratoria'],
  introduccion_ecommerce: ['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores'],
  fotografia_celulares_tiendas_online: ['introduccion_ecommerce', 'publicidad_redes_sociales', 'fotografia_profesional'],
  diseno_corel_draw: ['diseno_photoshop', 'diseno_illustrator', 'community_manager'],
  diseno_photoshop: ['diseno_corel_draw', 'diseno_illustrator', 'fotografia_profesional'],
  diseno_illustrator: ['diseno_photoshop', 'diseno_corel_draw', 'marketing_digital'],
  fotografia_profesional: ['diseno_photoshop', 'fotografia_celulares_tiendas_online', 'decoracion_de_interiores'],
  decoracion_de_interiores: ['autocad_interiores', 'paisajismo_jardineria', 'fotografia_profesional'],
  autocad_interiores: ['decoracion_de_interiores'],
  paisajismo_jardineria: ['decoracion_de_interiores'],
  organizador_eventos_sociales: ['organizacion_baby_shower', 'introduccion_catering', 'vino_cata_maridaje'],
  organizacion_baby_shower: ['organizador_eventos_sociales', 'introduccion_catering'],
  introduccion_catering: ['barista', 'vino_cata_maridaje', 'sushi_principiantes', 'organizador_eventos_sociales'],
  vino_cata_maridaje: ['introduccion_catering', 'organizador_eventos_sociales', 'organizacion_baby_shower'],
  sushi_principiantes: ['introduccion_catering', 'organizacion_baby_shower'],
  barista: ['introduccion_catering', 'organizacion_baby_shower'],
  entrenamiento_funcional: ['nutricion_alimentacion', 'masoterapia'],
  nutricion_alimentacion: ['entrenamiento_funcional', 'masoterapia', 'cuidador_adultos_mayores'],
  masoterapia: ['entrenamiento_funcional', 'estetica_integral', 'nutricion_alimentacion'],
  cuidador_adultos_mayores: ['nutricion_alimentacion'],
  maquillaje_profesional: ['unas_gelificadas', 'estetica_integral', 'instagram_emprendedores'],
  unas_gelificadas: ['maquillaje_profesional', 'estetica_integral', 'instagram_emprendedores'],
  estetica_integral: ['maquillaje_profesional', 'depilacion_definitiva', 'masoterapia'],
  depilacion_definitiva: ['estetica_integral', 'masoterapia'],
  camaras_seguridad: ['redes_informaticas', 'armado_reparacion_pc'],
  redes_informaticas: ['camaras_seguridad', 'armado_reparacion_pc'],
  armado_reparacion_pc: ['reparacion_celulares', 'redes_informaticas', 'camaras_seguridad'],
  reparacion_celulares: ['armado_reparacion_pc'],
  aires_acondicionados: ['energia_solar_fotovoltaica'],
  energia_solar_fotovoltaica: ['aires_acondicionados'],
  estrategias_emprender: ['instagram_emprendedores', 'especialista_ventas'],
  instagram_emprendedores: ['estrategias_emprender', 'especialista_ventas', 'fotografia_celulares_tiendas_online'],
  especialista_ventas: ['especialista_marketing', 'oratoria', 'estrategias_emprender'],
  excel_integral: ['introduccion_criptomonedas'],
  introduccion_criptomonedas: ['excel_integral', 'estrategias_emprender'],
  coaching_liderazgo: ['comunicacion_interna_empresas', 'oratoria'],
  comunicacion_interna_empresas: ['coaching_liderazgo', 'oratoria'],
  oratoria: ['coaching_liderazgo', 'comunicacion_interna_empresas', 'especialista_ventas'],
  ingles_1: ['ingles_2', 'ingles_3'],
  ingles_2: ['ingles_3'],
  ingles_3: [],
};

/** "Puentes universales para emprender" (authority prompt:144). */
export const UNIVERSAL_BONUS_BRIDGES_V1 = [
  'estrategias_emprender', 'instagram_emprendedores', 'fotografia_celulares_tiendas_online', 'especialista_ventas',
] as const;

export const MAX_RULE_BONUS_COURSES_V1 = 3;

/** Ordered bonus courses for one paid course, restricted to active codes. */
export function bonusSequenceForPaidCourseV1(paidCode: string, activeCodes: Iterable<string>): string[] {
  const active = new Set(activeCodes);
  const sequence: string[] = [];
  for (const code of [...(BONUS_AFFINITY_TABLE_V1[paidCode] ?? []), ...UNIVERSAL_BONUS_BRIDGES_V1]) {
    if (code !== paidCode && active.has(code) && !sequence.includes(code)) sequence.push(code);
    if (sequence.length === MAX_RULE_BONUS_COURSES_V1) break;
  }
  return sequence;
}

/** Next table course not yet delivered, or null when the table or the limit is exhausted. */
export function nextRuleBonusCodeV1(input: {
  readonly paid_code: string; readonly active_codes: Iterable<string>;
  readonly delivered_codes: readonly string[]; readonly max_bonus_courses: number;
}): string | null {
  if (input.delivered_codes.length >= Math.min(input.max_bonus_courses, MAX_RULE_BONUS_COURSES_V1)) return null;
  return bonusSequenceForPaidCourseV1(input.paid_code, input.active_codes)
    .find(code => !input.delivered_codes.includes(code)) ?? null;
}

const PRICE_EXPRESSIONS = /\b(caro|cara|caros|costoso|costosa|no me alcanza|mucha plata|mucho dinero|es un monton|un monton de plata|no tengo (?:el )?presupuesto|poco presupuesto|no puedo pagar(?:lo)?|fuera de mi presupuesto|es bastante|se me va de presupuesto)\b/u;

/** Logged hint only. Never authorizes a bonus: the model's price_objection memory does.
 * Questions ("es caro?") and negations ("no es caro") are not objections. */
export function priceExpressionHintV1(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return normalized.split(/[\n.;!]+/u).some(clause => {
    const trimmed = clause.trim();
    if (!trimmed || trimmed.endsWith('?') || /\?/u.test(trimmed)) return false;
    const match = PRICE_EXPRESSIONS.exec(trimmed);
    if (!match) return false;
    const before = trimmed.slice(0, match.index).split(/\s+/u).filter(Boolean).slice(-3);
    const negatedExpression = /^no\b/u.test(match[0]);
    return negatedExpression || !before.some(word => ['no', 'ni', 'nada', 'tampoco', 'nunca'].includes(word));
  });
}

/** Owner decision (2026-11-02, second revision, bounded the same day): ANY
 * request or hint about a promotion or discount enables the offer instantly,
 * except when the customer negates it. Deterministic and literal. */
const PROMO_REQUEST = /\b(?:promo|promos|promocion|promociones|descuento|descuentos|descontar|descontame|rebaja|rebajar|rebajame|bonificacion|bonificar|beca|becas|cupon|gratis|gratuito|gratuita|sin costo|mas barato|mas barata|precio especial|me haces precio|haceme precio|un mejor precio)\b/gu;
const NEGATION_WORDS = new Set(['no', 'ni', 'nunca', 'tampoco', 'nada']);

function clausesOf(text: string): string[] {
  return normalizedVisible(text).split(/[,.;:!?\n]+|\b(?:pero|aunque)\b/u).map(clause => clause.trim()).filter(Boolean);
}

/** Owner 4f (2026-11-03): "beneficio" is a promo request only while talking about price. */
const BENEFIT_WITH_PRICE = /\b(?:beneficio|beneficios|ventaja|ventajas)\b[^.?!]*\b(?:precio|pago|pagar|cuota|cuotas|caro|cara|plata|usd|valor)\b|\b(?:precio|pago|pagar|cuota|cuotas|caro|cara|plata|valor)\b[^.?!]*\b(?:beneficio|beneficios|ventaja|ventajas)\b/u;

export function promoRequestV1(text: string): boolean {
  if (BENEFIT_WITH_PRICE.test(normalizedVisible(text))) return true;
  return clausesOf(text).some(clause => [...clause.matchAll(PROMO_REQUEST)].some(match => {
    const before = clause.slice(0, match.index).split(/\s+/u).filter(Boolean).slice(-4);
    const hasNegation = before.some(word => NEGATION_WORDS.has(word));
    if (!hasNegation) return true;
    // In Rioplatense Spanish, “no me hacés/podés dar un descuento?” is a
    // polite request, not a refusal. Keep real refusals (“no quiero”, “no
    // necesito”, “ni promo”) excluded while accepting that interrogative
    // construction and “no hay promo?”.
    const prefix = before.join(' ');
    return /\bno\s+(?:me\s+)?(?:haces|podes|podrias|darias|das|ofreces|conseguis|aplicas|hay|tienen|tenes|existe)\b/u
      .test(prefix);
  }));
}

/** Choosing a plan is checkout, not a price concern ("elijo 12 cuotas", "pago único"). */
const PLAN_CHOICE = /\b(?:\d+\s*cuotas|(?:en|de)\s+(?:doce|seis|una?)\s+cuotas?|pago unico|un (?:solo )?pago|de contado|al contado|las? \d+ cuotas|el plan de \d+)\b/u;

export function planChoiceV1(text: string): boolean {
  return PLAN_CHOICE.test(normalizedVisible(text));
}

/** Purchase intent goes to checkout (with any live offer attached), never to a new bonus. */
const PURCHASE_INTENT = /\b(?:pasame el link|pasame el enlace|mandame el link|manda(?:me)? el enlace|quiero pagar|como pago|lo compro|lo quiero|me inscribo|quiero inscribirme|inscribime|arranquemos|avancemos|vamos con eso|lo tomo)\b/u;

export function purchaseIntentV1(text: string): boolean {
  return PURCHASE_INTENT.test(normalizedVisible(text));
}

const STRONG_PRICE_QUESTION = /\b(?:cuanto (?:sale|cuesta|vale|es|seria|salen|cuestan|queda|pago|tengo que pagar)|que precio|cual es el precio|el precio)\b/u;
const WEAK_PRICE_WORDS = /\b(?:precio|precios|valor|costo|coste|cuotas?)\b/u;
const OBJECTION_WORDS = /\b(?:caro|cara|caros|costoso|costosa)\b/u;

/** A price question or objection this turn (owner rule C). A plan choice is not one. */
export function priceConcernTextV1(text: string): boolean {
  const objection = priceExpressionHintV1(text) || clausesOf(text).some(clause => {
    const match = OBJECTION_WORDS.exec(clause);
    return match !== null && !clause.slice(0, match.index).split(/\s+/u).filter(Boolean).slice(-3).some(word => NEGATION_WORDS.has(word));
  });
  if (objection) return true;
  const normalized = normalizedVisible(text);
  if (planChoiceV1(text) || purchaseIntentV1(text)) return false;
  return STRONG_PRICE_QUESTION.test(normalized) || (normalized.includes('?') && WEAK_PRICE_WORDS.test(normalized));
}

/** A new price objection (not a question): only this confirms the probe besides an affirmation. */
function priceObjectionTextV1(text: string): boolean {
  // Excludes questions ("es caro?") and negations ("no es caro").
  return priceExpressionHintV1(text);
}

/** Owner wording for rule C. */
export const PRICE_PROBE_V1 = 'El precio es el único inconveniente? Te puedo buscar una promoción que se adapte si es el caso';

export function messagesContainPriceProbeV1(messages: readonly string[]): boolean {
  const text = normalizedVisible(messages.join(' '));
  // Owner wording 2026-11-03 and the earlier 2026-11-02 one (history still holds it).
  return text.includes('precio es el unico inconveniente')
    && (text.includes('revisar una promocion') || text.includes('buscar una promocion'));
}

/** "No" to the price-only question (owner 2026-11-03: then find the real reason). */
export function deniesPriceProbeV1(batch: readonly string[], previousAgentMessages: readonly string[]): boolean {
  if (!agentAskedPriceOnlyV1(previousAgentMessages) || confirmsPriceProbeV1(batch, previousAgentMessages)) return false;
  return batch.some(text => /^\W*(?:no|nop|nah|para nada|no es eso|no solo)\b/u.test(normalizedVisible(text)));
}

const AFFIRMATIVE = /^(?:si|sii+|sip|claro|obvio|exacto|correcto|asi es|totalmente|seguro|es eso|eso|tal cual|solo eso|solo el precio|el precio|es el precio)\b/u;

/** The agent asked whether price is the only obstacle, with the owner's words
 * or its own ("el precio es lo único que te frena…?", 2026-11-02 live). */
export function agentAskedPriceOnlyV1(messages: readonly string[]): boolean {
  if (messagesContainPriceProbeV1(messages)) return true;
  return messages.some(message => normalizedVisible(message).split(/(?<=\?)/u).some(question => question.trim().endsWith('?')
    && /\bprecio\b/u.test(question) && /\b(?:unico|unica|lo unico|solo|solamente)\b/u.test(question)));
}

/** Only an affirmation answering THAT question, or a new price objection. */
export function confirmsPriceProbeV1(batch: readonly string[], previousAgentMessages: readonly string[]): boolean {
  if (!agentAskedPriceOnlyV1(previousAgentMessages)) return false;
  if (batch.some(text => purchaseIntentV1(text) || planChoiceV1(text))) return false;
  return batch.some(text => {
    const normalized = normalizedVisible(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
    return AFFIRMATIVE.test(normalized) || priceObjectionTextV1(text);
  });
}

/** Passive closings the owner forbids ("lo ves tranquilo"...). */
const PASSIVE_CLOSING = /\b(?:lo ves tranquil[oa]|lo pensas tranquil[oa]|pensalo tranquil[oa]|tomate (?:tu|el) tiempo|sin apuro|sin presion|cuando quieras|cuando puedas|cuando lo decidas|avisame|me avisas|quedo atent[oa]|quedo a disposicion|aca estoy|estoy a disposicion|lo que decidas|cualquier cosa me escribis|si te decidis)\b/u;

export function passiveClosingSentencesV1(messages: readonly string[]): string[] {
  return messages.flatMap(message => message.split(/(?<=[.!?])\s+|\n+/u))
    .filter(sentence => PASSIVE_CLOSING.test(normalizedVisible(sentence)));
}

/** Rule D fallback: drop only the passive sentences; never empties a bubble. */
export function withoutPassiveClosingV1(messages: readonly string[]): string[] {
  const cleaned = messages.map(message => message.split(/(?<=[.!?])\s+|\n+/u)
    .filter(sentence => !PASSIVE_CLOSING.test(normalizedVisible(sentence))).join(' ').trim());
  const kept = cleaned.filter(message => message.length > 0);
  return kept.length ? kept : [...messages];
}

const CALL_COORDINATION_MOVES = new Set(['request_call', 'decline_call', 'continue_by_chat']);
const TERMINAL_MOVES = new Set(['decline_purchase']);

/** Rule D applies only to negotiation closings with the sale open (owner bound):
 * not checkout, data collection, call coordination, post-sale, a definitive no or opt-out. */
export function passiveRuleAppliesV1(context: RuleContextV1, draft: RuleDraftV1 & { readonly profile_requests?: readonly unknown[] }): boolean {
  if (context.payment_paid || context.payment_reported === true || context.opted_out === true) return false;
  if (isCheckoutV1(context, draft) || context.awaiting_reply === 'call_or_chat') return false;
  if (context.call_offer_status === 'accepted' || context.active_call === true) return false;
  const moves = draftMoves(draft);
  if ([...moves].some(move => CALL_COORDINATION_MOVES.has(move) || TERMINAL_MOVES.has(move))) return false;
  if (['request_call_now'].includes(draft.proposed_action.type) || (draft.profile_requests?.length ?? 0) > 0) return false;
  return true;
}

export type PriceProbeRuleDecisionV1 = { readonly kind: 'none'; readonly reason: string } | { readonly kind: 'ask' };

/** Rule C: once per conversation (owner bound), outside checkout, and never for a plan choice. */
export function decidePriceProbeRuleV1(context: RuleContextV1, draft: RuleDraftV1, bonus: BonusRuleDecisionV1): PriceProbeRuleDecisionV1 {
  if (bonus.kind === 'offer') return { kind: 'none', reason: 'bonus_turn' };
  if (!context.bonus_enabled) return { kind: 'none', reason: 'bonus_disabled' };
  if (context.payment_paid) return { kind: 'none', reason: 'paid' };
  if (isCheckoutV1(context, draft)) return { kind: 'none', reason: 'checkout' };
  if (context.package_status === 'offered' || context.package_status === 'accepted' || context.package_status === 'attached')
    return { kind: 'none', reason: 'package_exists' };
  // Owner 2026-11-03: once per conversation, from the persisted flag (paraphrases included).
  if (context.price_probe_status && context.price_probe_status !== 'not_asked') return { kind: 'none', reason: 'already_asked' };
  if (context.recent_turns.some(turn => turn.direction === 'outbound' && agentAskedPriceOnlyV1([turn.content])))
    return { kind: 'none', reason: 'already_asked' };
  if (!context.recent_turns_complete) return { kind: 'none', reason: 'history_truncated' };
  if (context.batch_texts.some(text => planChoiceV1(text) || purchaseIntentV1(text))) return { kind: 'none', reason: 'plan_choice' };
  const concern = context.batch_texts.some(priceConcernTextV1) || draftRecordsPriceObjectionV1(draft, context.batch_texts)
    // "Me bonificás X?" before the question: ask it first (owner 4e).
    || context.gift_request_pending_probe === true;
  return concern ? { kind: 'ask' } : { kind: 'none', reason: 'no_price_concern' };
}

/** Rule C fallback: the model's answer bubble plus the fixed probe bubble. */
export function withPriceProbeV1(messages: readonly string[]): [string, string] | [string] {
  const answer = messages.find(message => !messagesContainPriceProbeV1([message]));
  return answer ? [answer, PRICE_PROBE_V1] : [PRICE_PROBE_V1];
}

export type RuleOutcomeV1 = 'not_applicable' | 'model' | 'rewrite' | 'fixed' | 'unmet';

export interface RuleDraftV1 {
  readonly response: { readonly messages: readonly string[]; readonly call_offer?: string | null };
  readonly proposed_action: { readonly type: string; readonly [key: string]: unknown };
  readonly move: { readonly move: string; readonly secondary_moves: readonly string[]; readonly vetoes?: readonly string[] };
  readonly memory_candidates: readonly { readonly type: string; readonly key: string; readonly value: string; readonly source_quote: string }[];
}

export interface RuleContextV1 {
  readonly batch_texts: readonly string[];
  readonly recent_turns: readonly { readonly direction: 'inbound' | 'outbound'; readonly content: string }[];
  /** False when recent_turns may be truncated: the response ordinal is then unknown. */
  readonly recent_turns_complete: boolean;
  readonly stage: string;
  readonly awaiting_reply: string;
  readonly payment_paid: boolean;
  readonly payment_link_request_pending: boolean;
  readonly bonus_enabled: boolean;
  readonly package_status: string | null;
  readonly delivered_bonus: readonly { readonly code: string; readonly display_name: string }[];
  /** Backend authority: next course of the fixed table for the effective paid course. */
  readonly rule_bonus: { readonly paid_offering_code: string; readonly paid_display_name: string;
    readonly bonus_offering_code: string; readonly display_name: string; readonly position: number;
    readonly source?: 'customer_request'; readonly replaces_offering_code?: string; readonly replaces_display_name?: string } | null;
  readonly prior_price_objection_count: number;
  readonly price_only_confirmed: boolean;
  readonly may_offer_call: boolean;
  readonly call_offer_status: string;
  readonly call_offer_count: number;
  readonly call_preference: string;
  readonly customer_expressed_interest: boolean;
  /** Latest agent bubbles, for confirming the rule C question. */
  readonly previous_agent_messages?: readonly string[];
  readonly payment_reported?: boolean;
  readonly active_call?: boolean;
  readonly opted_out?: boolean;
  /** Owner 2026-11-03 flow, persisted by the backend (audit markers), never inferred from text. */
  readonly price_probe_status?: 'not_asked' | 'asked' | 'yes' | 'no';
  readonly retention_used?: boolean;
  readonly gift_request_pending_probe?: boolean;
  /** Real expiry of the live promotion cycle, if any ("tiempo limitado" only then). */
  readonly promo_expires_at?: string | null;
  /** Effective paid course (selected course or package), for Rule E. */
  readonly paid_display_name?: string | null;
  readonly paid_offering_code?: string | null;
}

const CHECKOUT_AWAITING = new Set(['payment_plan', 'payment_confirmation', 'contact_details']);
const CHECKOUT_MOVES = new Set(['request_payment_link', 'select_payment_plan', 'provide_contact_details', 'report_payment']);

function draftMoves(draft: RuleDraftV1): Set<string> {
  return new Set([draft.move.move, ...draft.move.secondary_moves]);
}

/** Exclusion only: these syntactic questions/negations never create an objection.
 * No positive keyword or regex can grant permission; the model memory is required. */
export function priceObservationQuoteInBatchV1(quote: string, batch: readonly string[]): boolean {
  const exact = quote.trim();
  if (!exact) return false;
  return batch.some(text => {
    // Check the full literal quote first: a model may cite several sentences
    // or lines. Segmentation is used only for the syntactic exclusion veto.
    for (let start = text.indexOf(exact); start >= 0; start = text.indexOf(exact, start + 1)) {
      const end = start + exact.length;
      const clauses = [...text.matchAll(/[^.!?;\n]+[.!?;]?/gu)]
        .filter(match => match.index < end && match.index + match[0].length > start);
      const excluded = clauses.some(match => {
        const clause = match[0];
        if (clause.trim().endsWith('?')) return true;
        const localStart = Math.max(0, start - match.index);
        const localEnd = Math.min(clause.length, end - match.index);
        const quoteStart = normalizedVisible(clause.slice(0, localStart)).length;
        const quoteEnd = normalizedVisible(clause.slice(0, localEnd)).length;
        // Also "no estoy diciendo que me parezca caro": any negation earlier in the clause.
        const negations = normalizedVisible(clause).matchAll(/\b(?:no|nunca|tampoco|nada|para nada)\b[^.!?;]*?\b(?:car[oa]s?|costos[oa]s?)\b/gu);
        return [...negations].some(negation => negation.index < quoteEnd
          && negation.index + negation[0].length > quoteStart);
      });
      if (clauses.length && !excluded) return true;
    }
    return false;
  });
}

/** Model-recorded evidence for this turn, bound to the literal customer text. */
export function draftRecordsPriceObjectionV1(draft: RuleDraftV1, batch: readonly string[]): boolean {
  return draft.memory_candidates.some(candidate => candidate.type === 'objection'
    && candidate.key === 'price_objection' && priceObservationQuoteInBatchV1(candidate.source_quote, batch));
}

export function draftConfirmsPriceOnlyBarrierV1(draft: RuleDraftV1, batch: readonly string[]): boolean {
  return draft.memory_candidates.some(candidate => candidate.type === 'constraint'
    && candidate.key === 'price_only_barrier' && candidate.value === 'confirmed' && priceObservationQuoteInBatchV1(candidate.source_quote, batch));
}

/** Owner (2026-11-02, promotion mode): while the agent is only collecting
 * contact data (no link sent, no plan chosen), a literal promo request or price
 * objection in this customer message interrupts that checkout for Rule A. A
 * purchase intent or plan choice in the same message keeps checkout. */
export function bonusInterruptsDataCollectionV1(context: {
  readonly stage: string; readonly awaiting_reply: string;
}, batch: readonly string[] | undefined): boolean {
  if (!batch?.length || ['payment_link_sent', 'closed', 'handoff'].includes(context.stage)) return false;
  if (context.awaiting_reply !== 'contact_details' && context.awaiting_reply !== 'none') return false;
  if (batch.some(text => purchaseIntentV1(text) || planChoiceV1(text))) return false;
  return batch.some(text => promoRequestV1(text) || priceExpressionHintV1(text));
}

export function isBonusCheckoutStateV1(context: {
  readonly stage: string; readonly awaiting_reply: string; readonly payment_link_request_pending: boolean;
}, batch?: readonly string[]): boolean {
  if (bonusInterruptsDataCollectionV1(context, batch)) return false;
  return ['payment_link_sent', 'closed', 'handoff'].includes(context.stage)
    || context.payment_link_request_pending || CHECKOUT_AWAITING.has(context.awaiting_reply);
}

export function isCheckoutV1(context: Pick<RuleContextV1, 'stage' | 'awaiting_reply' | 'payment_link_request_pending'>, draft?: RuleDraftV1,
  bonusBatch?: readonly string[]): boolean {
  const interrupted = bonusInterruptsDataCollectionV1(context, bonusBatch);
  if (isBonusCheckoutStateV1(context, bonusBatch)) return true;
  if (interrupted && draft) {
    // Collecting data is interrupted; only an actual link/plan/payment effect is checkout.
    const moves = draftMoves(draft);
    return [...moves].some(move => CHECKOUT_MOVES.has(move) && move !== 'provide_contact_details')
      || ['send_payment_link', 'send_test_payment_link', 'accept_promotion'].includes(draft.proposed_action.type);
  }
  if (!draft) return false;
  const moves = draftMoves(draft);
  return [...moves].some(move => CHECKOUT_MOVES.has(move))
    || ['send_payment_link', 'send_test_payment_link', 'accept_promotion'].includes(draft.proposed_action.type);
}

export type BonusRuleDecisionV1 =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'offer'; readonly trigger: 'second_price_objection' | 'price_only_barrier' | 'escalation' | 'promo_request' | 'price_probe_confirmed' | 'customer_request' | 'retention';
      readonly paid_code: string; readonly paid_name: string; readonly bonus_code: string; readonly bonus_name: string;
      readonly position: number; readonly prior_bonus: readonly { readonly code: string; readonly display_name: string }[];
      /** Owner 2026-11-03: the customer's chosen course replaces this single bonus (new package cycle). */
      readonly replaces?: { readonly code: string; readonly display_name: string } };

/** Rule A trigger. The course comes only from the backend's fixed table (rule_bonus). */
export function decideBonusRuleV1(context: RuleContextV1, draft: RuleDraftV1): BonusRuleDecisionV1 {
  if (!context.bonus_enabled) return { kind: 'none', reason: 'bonus_disabled' };
  if (context.payment_paid) return { kind: 'none', reason: 'paid' };
  if (isCheckoutV1(context, draft, context.batch_texts)) return { kind: 'none', reason: 'checkout' };
  if (context.package_status === 'accepted' || context.package_status === 'attached') return { kind: 'none', reason: 'package_accepted' };
  // Owner 2026-11-03: the customer chose the gift (or a replacement) literally this turn.
  const chosen = context.rule_bonus?.source === 'customer_request' ? context.rule_bonus : null;
  if (chosen) {
    const swap = chosen.replaces_offering_code
      ? { code: chosen.replaces_offering_code, display_name: chosen.replaces_display_name ?? chosen.replaces_offering_code } : undefined;
    return { kind: 'offer', trigger: 'customer_request', paid_code: chosen.paid_offering_code, paid_name: chosen.paid_display_name,
      bonus_code: chosen.bonus_offering_code, bonus_name: chosen.display_name, position: chosen.position,
      prior_bonus: swap || context.package_status !== 'offered' ? [] : context.delivered_bonus, ...(swap ? { replaces: swap } : {}) };
  }
  const currentObjection = draftRecordsPriceObjectionV1(draft, context.batch_texts);
  const currentPriceOnly = draftConfirmsPriceOnlyBarrierV1(draft, context.batch_texts);
  const promoRequest = context.batch_texts.some(promoRequestV1);
  const probeConfirmed = confirmsPriceProbeV1(context.batch_texts, context.previous_agent_messages ?? []);
  const delivered = context.package_status === 'offered' ? context.delivered_bonus : [];
  let trigger: Extract<BonusRuleDecisionV1, { kind: 'offer' }>['trigger'];
  if (delivered.length > 0) {
    // Escalation: a new price objection or promo request in a reply after a delivered offer.
    // Owner: ANY price objection escalates after an offer; a literal objection
    // (questions and negations excluded) counts even if the model missed it.
    const literalObjection = context.batch_texts.some(priceExpressionHintV1);
    if (!currentObjection && !currentPriceOnly && !promoRequest && !probeConfirmed && !literalObjection) {
      return { kind: 'none', reason: 'no_new_price_objection' };
    }
    trigger = 'escalation';
  } else if (promoRequest) {
    trigger = 'promo_request';
  } else if (probeConfirmed) {
    trigger = 'price_probe_confirmed';
  } else if (context.price_probe_status === 'no' && (currentObjection || context.batch_texts.some(priceExpressionHintV1))) {
    // Owner 4c (2026-11-03): after a "no" to the price question, a new complaint offers directly.
    trigger = 'second_price_objection';
  } else if (context.prior_price_objection_count + (currentObjection ? 1 : 0) >= 2) {
    trigger = 'second_price_objection';
  } else if (context.price_only_confirmed || currentPriceOnly) {
    trigger = 'price_only_barrier';
  } else return { kind: 'none', reason: 'trigger_not_met' };
  const rule = context.rule_bonus;
  if (!rule) return { kind: 'none', reason: delivered.length >= MAX_RULE_BONUS_COURSES_V1 ? 'limit_reached' : 'no_rule_course' };
  return { kind: 'offer', trigger, paid_code: rule.paid_offering_code, paid_name: rule.paid_display_name,
    bonus_code: rule.bonus_offering_code, bonus_name: rule.display_name, position: rule.position, prior_bonus: delivered };
}

function normalizedVisible(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Literal identity check for an escalation recap. This does not evaluate
 * persuasiveness or infer a package from prose; the backend already owns it.
 * Obviously negated/excluded names do not establish the required identity. */
function positivelyNamesCourse(messages: readonly string[], name: string): boolean {
  const words = (value: string) => normalizedVisible(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/u);
  const course = words(name);
  return messages.some(message => message.split(/[,.;:!?\n]+|\bpero\b/iu).some(clause => {
    const tokens = words(clause);
    for (let start = 0; start + course.length <= tokens.length; start += 1) {
      if (!course.every((word, part) => word === tokens[start + part])) continue;
      const prefix = tokens.slice(Math.max(0, start - 4), start);
      const negatedBefore = prefix.some((word, position) => (['no', 'ni', 'nunca', 'tampoco', 'excepto'].includes(word)
        // "no solo X, también Y" keeps X included.
        && !(word === 'no' && ['solo', 'solamente', 'unicamente'].includes(prefix[position + 1] ?? '')))
        || word === 'sin' && !['costo', 'coste', 'cargo'].includes(prefix[position + 1] ?? ''));
      const after = tokens.slice(start + course.length);
      const negatedAfter = after[0] === 'no' && (after.length === 1 || ['esta', 'va', 'entra', 'queda', 'se'].includes(after[1]));
      if (!negatedBefore && !negatedAfter) return true;
    }
    return false;
  }));
}

/** First offer: the exact effect and new course. Escalation: additionally name
 * the paid course and every already delivered bonus in the complete recap. */
export function draftPresentsBonusV1(draft: RuleDraftV1, decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>): boolean {
  const action = draft.proposed_action;
  const presentsNew = action.type === 'offer_course_bonus' && action.bonus_offering_code === decision.bonus_code
    && action.interest_offering_code === decision.paid_code
    && draft.response.messages.some(message => normalizedVisible(message).includes(normalizedVisible(decision.bonus_name)));
  // The owner's retention copy offers the next gift without a recap.
  if (!presentsNew || decision.prior_bonus.length === 0 || decision.trigger === 'retention') return presentsNew;
  return [decision.paid_name, ...decision.prior_bonus.map(course => course.display_name), decision.bonus_name]
    .every(name => positivelyNamesCourse(draft.response.messages, name));
}

export const BONUS_FALLBACK_PAUSE_MS_V1 = 20_000;

/** Owner "modo promoción" (2026-11-02, third revision). In a Rule A turn the
 * model receives one short, concrete task at the end of its instructions
 * instead of competing with the whole guide. Data come from the backend. */
export interface PromotionTaskDataV1 {
  /** Configured payment plan codes (monthly_12, monthly_6, one_time). */
  readonly plan_codes: readonly string[];
  /** Customer's own goal from durable memory, if any. */
  readonly customer_goal: string | null;
}

function joinNamesV1(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function planAlternativeV1(plans: readonly string[]): string | null {
  if (plans.includes('monthly_12') && plans.includes('monthly_6')) return '12 cuotas de USD 30 o 6 de USD 60';
  if (plans.includes('monthly_12')) return '12 cuotas de USD 30';
  return null;
}

const PROMOTION_TASK_PROHIBITIONS_V1 = 'Prohibido: abrir con el precio, «el precio sigue siendo», «el precio no cambia», «se mantiene el precio», «la bonificación ya está aplicada» como frase seca, «compra aparte», «no es un cambio», «no incluye descuento», volver sólo a las cuotas, comparaciones con gastos (comida, salidas, café), frases defensivas, montos de ahorro inventados. Máximo 2 mensajes y una sola pregunta. Usa tú, con «!» y sin «¡».';

const COUNT_WORDS_V1 = ['', 'un', 'dos', 'tres', 'cuatro'] as const;

/** "dos cursos al precio de uno" from the package this offer persists. */
export function packageValuePhraseV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>): string {
  return `${COUNT_WORDS_V1[decision.prior_bonus.length + 2]} cursos al precio de uno`;
}

export function promotionTaskV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>, data: PromotionTaskDataV1): string {
  const plans = planAlternativeV1(data.plan_codes);
  const close = plans
    ? `Cierra con energía y una sola pregunta que ofrezca el plan: ${plans} (por ejemplo «Lo arrancamos en ${plans}?!»).`
    : 'Cierra con energía y una sola pregunta para avanzar (por ejemplo «Lo hacemos?!»).';
  const value = `Vende el beneficio antes que el precio: «te llevas ${packageValuePhraseV1(decision)}».`;
  if (decision.trigger === 'retention') return retentionTaskV1(decision);
  if (decision.trigger === 'customer_request') {
    const prior = decision.prior_bonus.map(course => course.display_name);
    return [
      decision.replaces
        ? `El cliente te pidió cambiar ${decision.replaces.display_name} por ${decision.bonus_name}. Se puede: en este turno queda cambiado.`
        : `El cliente te pidió ${decision.bonus_name} de regalo. Se puede: en este turno queda sumado.`,
      `1) Dile que sí, con energía (por ejemplo «Listo!» o «Buenísimo!»), sin explicar trámites ni límites.`,
      `2) Recapitula el paquete como ganancia: ${decision.paid_name} + ${joinNamesV1([...prior, decision.bonus_name])} de regalo, ${packageValuePhraseV1(decision)}.`,
      `3) ${close}`,
      PROMOTION_TASK_PROHIBITIONS_V1,
    ].join('\n');
  }
  if (decision.prior_bonus.length === 0) {
    const goal = data.customer_goal ?? 'lo que el cliente te contó que busca';
    return [
      'El cliente te dijo que el precio es su freno. En este turno:',
      '1) Reconócelo en una frase, con empatía y seguridad (sin «te entiendo» de muletilla, sin defenderte).',
      '2) Dile que se lo puedes resolver.',
      `3) Preséntale una PROMOCIÓN EXCLUSIVA: si avanza con ${decision.paid_name}, le bonificas ${decision.bonus_name}. Explica en una frase por qué le suma a su objetivo (${goal}).`,
      `4) ${value}`,
      `5) ${close}`,
      PROMOTION_TASK_PROHIBITIONS_V1,
    ].join('\n');
  }
  const prior = joinNamesV1(decision.prior_bonus.map(course => course.display_name));
  const all = joinNamesV1([...decision.prior_bonus.map(course => course.display_name), decision.bonus_name]);
  return [
    `Ya le ofreciste ${prior} con ${decision.paid_name} y el precio lo sigue frenando. En este turno:`,
    '1) No repitas la pregunta del precio ni vuelvas sólo a cuotas.',
    `2) Sube la apuesta: además de ${prior}, le sumas ${decision.bonus_name}, y explica en una frase qué le agrega.`,
    `3) Recapitula el paquete completo como ganancia: ${decision.paid_name} + ${all}, ${packageValuePhraseV1(decision)}.`,
    `4) ${close}`,
    `Mismas prohibiciones: ${PROMOTION_TASK_PROHIBITIONS_V1}`,
  ].join('\n');
}

/** Safety net only (owner): the task, not this list, is the solution. */
const EXPENSE_COMPARISON = /\b(?:(?:una|un par de|dos) salidas?|salida a comer|salir a comer|comer afuera|una comida|una cena|un almuerzo|un cafe|cafes|cafecito|pizza|cerveza|birra|netflix|delivery|gaseosa|golosina)\b/u;
const DISCOUNT_CLAIM = /(?:\b(?:descuento|descontamos|rebaja|rebajado|precio especial|mas barato)\b|\d\s?%)/u;
const DEFENSIVE = /\b(?:no te (?:lo )?puedo (?:bajar|rebajar|ofrecer|hacer)|es lo que hay|no (?:te )?(?:lo )?voy a inventar|no hay descuento|no puedo bajar)\b/u;
const PRICE_OPENING = /^\W*(?:el (?:precio|valor|costo|total|monto)|los usd|son (?:usd|u\$s|\d)|usd|\d)/u;
const PRICE_UNCHANGED = /\b(?:precio|valor|total)\b[^.!?]*\b(?:no cambia|sigue igual|sigue siendo|no baja|se mantiene)\b/u;
/** Owner value register (2026-11-03): sounds like a procedure or a limit, not a benefit. */
export const ADMINISTRATIVE_REGISTER_V1 = /\b(?:(?:seria|es) una compra aparte|compra aparte|se cursa aparte|no es un cambio|no incluye (?:ningun )?descuento|no es posible|no se puede|no puedo)\b/u;
const DRY_BONUS_OPENING = /^\W*la bonificacion ya (?:esta|quedo) aplicada\b/u;

/** Literal check of the owner's task: the decided effect and identities, at
 * most 2 messages and one question, a plan alternative, and none of the
 * forbidden openings/comparisons/defensive phrases. */
export function draftFulfillsPromotionTaskV1(draft: RuleDraftV1, decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>,
  data: PromotionTaskDataV1): boolean {
  if (!draftPresentsBonusV1(draft, decision)) return false;
  // A chosen gift keeps the paid course; select_course would read as a course change.
  if (decision.trigger === 'customer_request' && draftMoves(draft).has('select_course')) return false;
  const messages = draft.response.messages;
  if (decision.trigger === 'retention') {
    return !draftMoves(draft).has('decline_purchase') && messages.length > 0 && messages.length <= 2
      && RETENTION_MARKER_V1.test(normalizedVisible(messages.join(' ')));
  }
  if (messages.length === 0 || messages.length > 2) return false;
  const text = normalizedVisible(messages.join(' '));
  if ((text.match(/\?/gu) ?? []).length > 1) return false;
  const opening = normalizedVisible(messages[0]!).split(/(?<=[.!?])\s+|\n+/u)[0] ?? '';
  if (/^\W*te entiendo\b/u.test(opening) || PRICE_OPENING.test(opening) || DRY_BONUS_OPENING.test(opening)) return false;
  if (EXPENSE_COMPARISON.test(text) || DEFENSIVE.test(text) || DISCOUNT_CLAIM.test(text)
    || PRICE_UNCHANGED.test(text) || ADMINISTRATIVE_REGISTER_V1.test(text)) return false;
  return planAlternativeV1(data.plan_codes) === null || /\b(?:cuotas?|pagos? (?:mensuales|de usd))\b/u.test(text);
}

/** Fixed fallback (owner wording 2026-11-02, value register and tú 2026-11-03). Replaces the whole turn. */
export function bonusFallbackMessagesV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>,
  data: PromotionTaskDataV1 = { plan_codes: ['monthly_12', 'monthly_6'], customer_goal: null }): [string] {
  const plans = planAlternativeV1(data.plan_codes);
  const value = packageValuePhraseV1(decision);
  if (decision.trigger === 'retention') return [retentionOfferMessageV1(decision)];
  if (decision.trigger === 'customer_request') {
    const all = joinNamesV1([...decision.prior_bonus.map(course => course.display_name), decision.bonus_name]);
    const close = plans ? `Lo arrancamos en ${plans.replace(' o 6 ', ' o en 6 ')}?!` : 'Lo hacemos?!';
    return [decision.replaces
      ? `Listo! Cambiamos ${decision.replaces.display_name} por ${decision.bonus_name}: te queda ${decision.paid_name} + ${decision.bonus_name} de regalo, ${value}! ${close}`
      : `Listo! Te sumo ${decision.bonus_name} de regalo: te llevas ${decision.paid_name} + ${all}, ${value}! ${close}`];
  }
  if (decision.prior_bonus.length === 0) return [
    `Te lo puedo resolver! Tengo una promoción exclusiva para ti: si avanzas con ${decision.paid_name}, te bonifico ${decision.bonus_name}, así te llevas ${value}. ${plans ? `Lo arrancamos en ${plans.replace(' o 6 ', ' o en 6 ')}?!` : 'Lo hacemos?!'}`,
  ];
  const prior = joinNamesV1(decision.prior_bonus.map(course => course.display_name));
  const all = joinNamesV1([...decision.prior_bonus.map(course => course.display_name), decision.bonus_name]);
  return [
    `Hagamos algo más! Además de ${prior}, te sumo ${decision.bonus_name}: te llevas ${decision.paid_name} + ${all}, ${value}. ${data.plan_codes.includes('monthly_12') ? 'Lo arrancamos en 12 cuotas de USD 30?!' : 'Qué te parece?!'}`,
  ];
}

export type CallRuleDecisionV1 = { readonly kind: 'none'; readonly reason: string } | { readonly kind: 'offer'; readonly response_ordinal: 2 | 3 };

export const CALL_FALLBACK_OFFER_V1 = 'Si quieres, coordinamos una llamada corta para verlo juntos. Te sirve?';

/** Ordinal of the agent reply being written. Identical re-sent replies (a replayed greeting) count once. */
export function agentResponseOrdinalV1(recentTurns: RuleContextV1['recent_turns']): number {
  return new Set(recentTurns.filter(turn => turn.direction === 'outbound').map(turn => turn.content.trim())).size + 1;
}

/** Rule B trigger. */
export function decideCallRuleV1(context: RuleContextV1, draft: RuleDraftV1, bonus: BonusRuleDecisionV1): CallRuleDecisionV1 {
  // A and B may both apply to the same turn (owner request, 2026-11-02).
  void bonus;
  if (!context.may_offer_call) return { kind: 'none', reason: 'not_authorized' };
  if (context.call_offer_status !== 'not_offered' || context.call_offer_count > 0) return { kind: 'none', reason: 'already_offered' };
  if (context.call_preference === 'chat' || context.call_preference === 'declined') return { kind: 'none', reason: 'chat_preference' };
  if (isCheckoutV1(context, draft)) return { kind: 'none', reason: 'checkout' };
  const moves = draftMoves(draft);
  if (draft.move.vetoes?.includes('call') || moves.has('request_call') || moves.has('decline_call') || moves.has('continue_by_chat')) return { kind: 'none', reason: 'call_move' };
  const ordinal = agentResponseOrdinalV1(context.recent_turns);
  if (!context.recent_turns_complete || (ordinal !== 2 && ordinal !== 3)) return { kind: 'none', reason: 'outside_window' };
  if (!context.customer_expressed_interest && !draft.memory_candidates.some(candidate => candidate.type === 'study_goal'))
    return { kind: 'none', reason: 'no_expressed_interest' };
  return { kind: 'offer', response_ordinal: ordinal };
}

export function draftPresentsCallV1(draft: RuleDraftV1): boolean {
  return typeof draft.response.call_offer === 'string' && draft.response.call_offer.trim().length > 0;
}

/** Owner Rule E (2026-11-03, exception to the authority prompt :127): one
 * retention attempt on the first definitive "no" while the sale is open.
 * Never on opt-out, insults or an explicit request to end the conversation. */
export type RetentionRuleDecisionV1 =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'retain'; readonly paid_name: string; readonly paid_code: string | null };

/** Literal marker shared by the task, the fallback and the persisted once-per-conversation flag. */
export const RETENTION_MARKER_V1 = /\bestas segur[oa]\b/u;
const OPT_OUT_OR_END = /\b(?:no me (?:escrib|mand|contact|llam|molest)\w*|dej\w* de (?:escribir\w*|mandar\w*|molestar\w*|contactar\w*)|dej\w* en paz|dar(?:me)? de baja|la baja|stop|basta|no (?:quiero|me interesa) (?:hablar|seguir hablando|que me escrib\w*)|no (?:quiero|me interesa) recibir\w*|no me (?:mandes|envies|ofrezcas) (?:mas )?(?:promo\w*|ofertas?|mensajes)|bloque\w*|denunci\w*)\b/u;
const INSULT = /\b(?:idiota|estupid\w*|imbecil\w*|pelotud\w*|boludo|mierda|puta|forro|chanta|estafa\w*|ladron\w*|garca)\b/u;

/** Owner Rule E (2026-11-03): on the first definitive "no" with fewer than 3
 * gifts, one retention attempt that OFFERS the next gift (Rule A course). With
 * 3 gifts, a used retention, opt-out, insults or an explicit end: no retention. */
export function decideRetentionRuleV1(context: RuleContextV1, draft: RuleDraftV1): RetentionRuleDecisionV1 {
  if (!draftMoves(draft).has('decline_purchase')) return { kind: 'none', reason: 'no_decline' };
  const text = normalizedVisible(context.batch_texts.join(' '));
  if (context.opted_out || OPT_OUT_OR_END.test(text) || INSULT.test(text)) return { kind: 'none', reason: 'respect_end' };
  if (context.payment_paid || context.stage === 'closed' || context.stage === 'handoff') return { kind: 'none', reason: 'closed' };
  if (context.package_status === 'accepted' || context.package_status === 'attached') return { kind: 'none', reason: 'package_accepted' };
  if (context.retention_used || context.recent_turns.some(turn => turn.direction === 'outbound'
    && RETENTION_MARKER_V1.test(normalizedVisible(turn.content)))) return { kind: 'none', reason: 'already_attempted' };
  const gifts = context.package_status === 'offered' ? context.delivered_bonus.length : 0;
  if (gifts >= MAX_RULE_BONUS_COURSES_V1) return { kind: 'none', reason: 'all_gifts_offered' };
  if (!context.bonus_enabled || !context.rule_bonus) return { kind: 'none', reason: 'no_gift_available' };
  const paid = context.paid_display_name?.trim() || context.rule_bonus.paid_display_name;
  return { kind: 'retain', paid_name: paid, paid_code: context.paid_offering_code ?? context.rule_bonus.paid_offering_code };
}

/** Rule A offer carried by the retention turn (the backend authorizes it on the literal decline). */
export function retentionBonusDecisionV1(context: RuleContextV1): Extract<BonusRuleDecisionV1, { kind: 'offer' }> | null {
  const rule = context.rule_bonus;
  if (!rule) return null;
  return { kind: 'offer', trigger: 'retention', paid_code: rule.paid_offering_code, paid_name: rule.paid_display_name,
    bonus_code: rule.bonus_offering_code, bonus_name: rule.display_name, position: rule.position,
    prior_bonus: context.package_status === 'offered' ? context.delivered_bonus : [] };
}

/** Owner wording (2026-11-03). */
export function retentionOfferMessageV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>): string {
  return decision.prior_bonus.length === 0
    ? `Estás seguro? Te puedo sumar ${decision.bonus_name} sin costo con ${decision.paid_name}, seguro te interesa! Qué te parece?!`
    : `Estás seguro? Te puedo sumar ${decision.bonus_name} también sin costo, seguro te interesa! Qué te parece?!`;
}

export function retentionTaskV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>): string {
  return [
    'El cliente dijo que no por primera vez. Haz UN único intento de retención, con energía y sin presión:',
    `abre con «Estás seguro?» y ofrécele sumar ${decision.bonus_name} sin costo${decision.prior_bonus.length ? ' también' : ` con ${decision.paid_name}`}, cerrando con una sola pregunta («Qué te parece?!»).`,
    'No uses move=decline_purchase en este turno ni te despidas. Máximo 2 mensajes. Usa tú, con «!» y sin «¡».',
  ].join('\n');
}

/** The retention turn keeps the sale open and carries the literal marker. */
export function draftFulfillsRetentionV1(draft: RuleDraftV1): boolean {
  if (draftMoves(draft).has('decline_purchase')) return false;
  const messages = draft.response.messages;
  if (messages.length === 0 || messages.length > 2) return false;
  return RETENTION_MARKER_V1.test(normalizedVisible(messages.join(' ')));
}

/** Literal first definitive "no" (owner 2026-11-03 retention). Opt-out, insults
 * and explicit ends never count; a "no" answering the price question is not a decline. */
export function literalDeclineV1(texts: readonly string[]): boolean {
  const text = normalizedVisible(texts.join(' ')).trim();
  if (!text || OPT_OUT_OR_END.test(text) || INSULT.test(text)) return false;
  return /^\W*no\W*$/u.test(text)
    || (/\bno\b/u.test(text) && /\b(?:gracias|chau|adios|me interesa|lo voy a (?:comprar|hacer|tomar)|quiero|compr\w*|por ahora|paso|despues|otro momento|no puedo)\b/u.test(text))
    || /^\W*(?:paso|mejor no|dejalo|dejemoslo)\b/u.test(text);
}

