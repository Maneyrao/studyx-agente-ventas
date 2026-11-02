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

export type RuleOutcomeV1 = 'not_applicable' | 'model' | 'rewrite' | 'fixed';

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
    readonly bonus_offering_code: string; readonly display_name: string; readonly position: number } | null;
  readonly prior_price_objection_count: number;
  readonly price_only_confirmed: boolean;
  readonly may_offer_call: boolean;
  readonly call_offer_status: string;
  readonly call_offer_count: number;
  readonly call_preference: string;
  readonly customer_expressed_interest: boolean;
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
        const negations = normalizedVisible(clause).matchAll(/\b(?:no|nunca|tampoco|nada|para nada)\s+(?:(?:es|esta|me parece|resulta|lo veo|lo considero)\s+)?(?:tan\s+)?(?:car[oa]s?|costos[oa]s?)\b/gu);
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

export function isBonusCheckoutStateV1(context: {
  readonly stage: string; readonly awaiting_reply: string; readonly payment_link_request_pending: boolean;
}): boolean {
  return ['payment_link_sent', 'closed', 'handoff'].includes(context.stage)
    || context.payment_link_request_pending || CHECKOUT_AWAITING.has(context.awaiting_reply);
}

export function isCheckoutV1(context: Pick<RuleContextV1, 'stage' | 'awaiting_reply' | 'payment_link_request_pending'>, draft?: RuleDraftV1): boolean {
  if (isBonusCheckoutStateV1(context)) return true;
  if (!draft) return false;
  const moves = draftMoves(draft);
  return [...moves].some(move => CHECKOUT_MOVES.has(move))
    || ['send_payment_link', 'send_test_payment_link', 'accept_promotion'].includes(draft.proposed_action.type);
}

export type BonusRuleDecisionV1 =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'offer'; readonly trigger: 'second_price_objection' | 'price_only_barrier' | 'escalation';
      readonly paid_code: string; readonly paid_name: string; readonly bonus_code: string; readonly bonus_name: string;
      readonly position: number; readonly prior_bonus: readonly { readonly code: string; readonly display_name: string }[] };

/** Rule A trigger. The course comes only from the backend's fixed table (rule_bonus). */
export function decideBonusRuleV1(context: RuleContextV1, draft: RuleDraftV1): BonusRuleDecisionV1 {
  if (!context.bonus_enabled) return { kind: 'none', reason: 'bonus_disabled' };
  if (context.payment_paid) return { kind: 'none', reason: 'paid' };
  if (isCheckoutV1(context, draft)) return { kind: 'none', reason: 'checkout' };
  if (context.package_status === 'accepted' || context.package_status === 'attached') return { kind: 'none', reason: 'package_accepted' };
  const currentObjection = draftRecordsPriceObjectionV1(draft, context.batch_texts);
  const delivered = context.package_status === 'offered' ? context.delivered_bonus : [];
  let trigger: Extract<BonusRuleDecisionV1, { kind: 'offer' }>['trigger'];
  if (delivered.length > 0) {
    // Escalation: a new price objection in a customer reply after a delivered offer.
    if (!currentObjection) return { kind: 'none', reason: 'no_new_price_objection' };
    trigger = 'escalation';
  } else if (context.prior_price_objection_count + (currentObjection ? 1 : 0) >= 2) {
    trigger = 'second_price_objection';
  } else if (context.price_only_confirmed || draftConfirmsPriceOnlyBarrierV1(draft, context.batch_texts)) {
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
      const negatedBefore = prefix.some((word, position) => ['no', 'ni', 'nunca', 'tampoco', 'excepto'].includes(word)
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
  if (!presentsNew || decision.prior_bonus.length === 0) return presentsNew;
  return [decision.paid_name, ...decision.prior_bonus.map(course => course.display_name), decision.bonus_name]
    .every(name => positivelyNamesCourse(draft.response.messages, name));
}

export const BONUS_FALLBACK_PAUSE_MS_V1 = 20_000;

/** Fixed fallback bubbles (owner wording, 2026-11-02). Replace the whole turn. */
export function bonusFallbackMessagesV1(decision: Extract<BonusRuleDecisionV1, { kind: 'offer' }>): [string, string] {
  if (decision.prior_bonus.length === 0) return [
    'Dejame revisar qué te puedo ofrecer, dame un segundo.',
    `Te puedo sumar ${decision.bonus_name} sin costo; el precio de ${decision.paid_name} sigue igual. Avanzamos?`,
  ];
  const bonuses = [...decision.prior_bonus.map(course => course.display_name), decision.bonus_name];
  const list = bonuses.length === 1 ? bonuses[0] : `${bonuses.slice(0, -1).join(', ')} y ${bonuses[bonuses.length - 1]}`;
  return [
    'Dejame revisar qué te puedo ofrecer, dame un segundo.',
    `Te sumo también ${decision.bonus_name}. Te quedan ${decision.paid_name} + ${list} sin costo extra, al mismo precio. Avanzamos?`,
  ];
}

export type CallRuleDecisionV1 = { readonly kind: 'none'; readonly reason: string } | { readonly kind: 'offer'; readonly response_ordinal: 2 | 3 };

export const CALL_FALLBACK_OFFER_V1 = 'Si querés, coordinamos una llamada corta para verlo juntos. Te sirve?';

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
