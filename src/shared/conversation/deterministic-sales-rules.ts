/**
 * Model-owned sales (owner decision 2026-11-03, AGENTS.md "Venta interpretada
 * por el modelo"): the model interprets the conversation and proposes
 * `offer_course_bonus`; the backend only validates the permission. This module
 * holds the pure, text-free pieces of that permission: the affinity set, the
 * literal-quote checks that bind model memory to the customer's words, and the
 * checkout state. Nothing here decides whether a reply sells, closes or probes.
 */
import { fichaCombinationCodesV1 } from '../catalog/gabi-fichas';

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

/** Bonus candidates are a set, not a sequence: the manual's "Combinalo con" and
 * career routes of the paid course, the fallback affinity row, the universal
 * bridges and any course the customer named literally. The model
 * chooses among them. Codes absent from the active catalog are never offered. */
export function authorizedBonusCodesV1(input: {
  readonly paid_code: string; readonly active_codes: Iterable<string>; readonly named_codes?: Iterable<string>;
}): string[] {
  const active = new Set(input.active_codes);
  const candidates = [...fichaCombinationCodesV1(input.paid_code), ...(BONUS_AFFINITY_TABLE_V1[input.paid_code] ?? []), ...UNIVERSAL_BONUS_BRIDGES_V1, ...(input.named_codes ?? [])];
  return [...new Set(candidates)].filter(code => code !== input.paid_code && active.has(code));
}

function normalizedVisible(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const words = (value: string) => ` ${normalizedVisible(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Active courses whose exact catalog name appears literally in the customer's batch. */
export function courseCodesNamedInBatchV1(batch: readonly string[],
  courses: ReadonlyArray<{ readonly code: string; readonly display_name: string }>): string[] {
  const text = words(batch.join(' '));
  return courses.filter(course => text.includes(words(course.display_name))).map(course => course.code);
}

export interface RuleDraftV1 {
  readonly response: { readonly messages: readonly string[]; readonly call_offer?: string | null };
  readonly proposed_action: { readonly type: string; readonly [key: string]: unknown };
  readonly move: { readonly move: string; readonly secondary_moves: readonly string[]; readonly vetoes?: readonly string[] };
  readonly memory_candidates: readonly { readonly type: string; readonly key: string; readonly value: string; readonly source_quote: string }[];
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

/** Model-declared purchase decline (retention, once per conversation): memory
 * objection/purchase_decline whose literal source_quote is in the customer's batch. */
export function draftDeclinesPurchaseV1(draft: Pick<RuleDraftV1, 'memory_candidates'>, batch: readonly string[]): boolean {
  return draft.memory_candidates.some(candidate => candidate.type === 'objection'
    && candidate.key === PURCHASE_DECLINE_MEMORY_KEY && declineQuoteInBatchV1(candidate.source_quote, batch));
}

export const PURCHASE_DECLINE_MEMORY_KEY = 'purchase_decline';

/** Literal provenance only: the quote must be customer text, never interpreted here. */
export function declineQuoteInBatchV1(quote: string, batch: readonly string[]): boolean {
  const exact = quote.trim();
  return exact.length > 0 && batch.some(text => text.includes(exact));
}

type CheckoutStateV1 = { readonly stage: string; readonly awaiting_reply: string; readonly payment_link_request_pending: boolean };

/** Checkout by durable state only; no customer-text exception. */
export function isBonusCheckoutStateV1(context: CheckoutStateV1): boolean {
  return ['payment_link_sent', 'closed', 'handoff'].includes(context.stage)
    || context.payment_link_request_pending || CHECKOUT_AWAITING.has(context.awaiting_reply);
}

/** State, or an actual link/plan/payment effect in the draft (used for call offers). */
export function isCheckoutV1(context: CheckoutStateV1, draft?: RuleDraftV1): boolean {
  if (isBonusCheckoutStateV1(context)) return true;
  if (!draft) return false;
  return [...draftMoves(draft)].some(move => CHECKOUT_MOVES.has(move))
    || ['send_payment_link', 'send_test_payment_link', 'accept_promotion'].includes(draft.proposed_action.type);
}
