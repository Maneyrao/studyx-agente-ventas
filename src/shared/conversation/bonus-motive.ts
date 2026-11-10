import { priceObservationQuoteInBatchV1 } from './deterministic-sales-rules';

/**
 * Bonus motive (owner decision 2026-11-04, AGENTS.md "Bonificación por motivo
 * actual"). `offer_course_bonus` carries `motive { kind, quote }`. The backend
 * checks structure and literal facts only, never the quality of commercial
 * text: the kind must agree with the declared move, and the quote must be
 * literal customer text of the CURRENT inbound batch. A persisted memory of an
 * earlier turn is never a motive.
 */
export const BONUS_MOTIVE_KINDS_V1 = [
  'price_objection', 'promotion_rejection', 'better_promotion_request', 'purchase_decline',
] as const;
export type BonusMotiveKindV1 = typeof BONUS_MOTIVE_KINDS_V1[number];
export interface BonusMotiveV1 { readonly kind: BonusMotiveKindV1; readonly quote: string }

export type BonusMotiveRejectionV1 =
  | 'motive_missing' | 'motive_move_incoherent' | 'motive_quote_not_in_batch'
  | 'motive_price_quote_invalid' | 'motive_needs_delivered_offer' | 'motive_retention_unavailable'
  | 'motive_first_price_objection';

/** Moves that are never a promotion motive on their own (payment, data, greeting). */
const NON_MOTIVE_PRIMARY_MOVES = new Set([
  'ask_payment_options', 'select_payment_plan', 'request_payment_link', 'report_payment',
  'provide_contact_details', 'greeting',
]);

const MOVES_BY_KIND: Readonly<Record<BonusMotiveKindV1, readonly string[]>> = {
  price_objection: ['price_objection'],
  better_promotion_request: ['explicit_promotion_request'],
  promotion_rejection: ['price_objection', 'explicit_promotion_request', 'decline_purchase'],
  purchase_decline: ['decline_purchase'],
};

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/\s+/gu, ' ').trim();

/** A quote with fewer words than this cannot stand as an ordinary price complaint ("sí"). */
const MIN_WORDS_FOR_ORDINARY_PRICE_QUOTE = 2;

function quoteIsLiteral(quote: string, batch: readonly string[]): boolean {
  const exact = normalize(quote);
  return exact.length > 0 && batch.some(text => normalize(text).includes(exact));
}

/** The quote is one whole message (or line) of the batch, ignoring edge punctuation: a bare reply such as "sí". */
function quoteIsWholeFragment(quote: string, batch: readonly string[]): boolean {
  const bare = (value: string) => normalize(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const exact = bare(quote);
  return exact.length > 0 && batch.some(text => text.split('\n').some(line => bare(line) === exact));
}

export function validateBonusMotiveV1(input: {
  readonly motive: BonusMotiveV1 | undefined;
  /** Declared `move` first, then `secondary_moves`. */
  readonly moves: readonly string[];
  readonly batch: readonly string[];
  /** A bonus of this package was already delivered (second step or later). */
  readonly has_delivered_bonus: boolean;
  readonly retention_used: boolean;
  /** The model recorded the purchase decline memory with a literal quote in this batch. */
  readonly purchase_decline_recorded: boolean;
  /** The previous agent turn declared, structurally, that it asked the price question. */
  readonly previous_turn_asked_price_question: boolean;
  /** Persisted fact: an earlier agent message of this conversation stated the paid course price. */
  readonly price_presented?: boolean;
  /** Owner 2026-11-10: an earlier answered turn recorded a price objection. */
  readonly prior_price_objection_recorded?: boolean;
  /** Owner 2026-11-10: a promotion delivered for another main course carries over. */
  readonly promotion_carried_over?: boolean;
}): BonusMotiveRejectionV1 | null {
  const { motive } = input;
  // The promotion was already earned in this conversation; it follows the
  // main course, so its first gift for the new course needs no new motive.
  if (input.promotion_carried_over === true && !input.has_delivered_bonus) return null;
  if (!motive || !motive.quote.trim()) return 'motive_missing';
  const [primary = ''] = input.moves;
  if (NON_MOTIVE_PRIMARY_MOVES.has(primary)
    || !MOVES_BY_KIND[motive.kind].some(move => input.moves.includes(move))) return 'motive_move_incoherent';
  if (!quoteIsLiteral(motive.quote, input.batch)) return 'motive_quote_not_in_batch';
  switch (motive.kind) {
    case 'price_objection': {
      // Questions never create an objection. A bare reply ("sí") counts only as
      // the whole fragment answering a price question the previous turn declared.
      if (!priceObservationQuoteInBatchV1(motive.quote, input.batch)) return 'motive_price_quote_invalid';
      const words = normalize(motive.quote).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
      const answersPriceQuestion = input.previous_turn_asked_price_question
        && quoteIsWholeFragment(motive.quote, input.batch);
      if (answersPriceQuestion) return null;
      if (words < MIN_WORDS_FOR_ORDINARY_PRICE_QUOTE) return 'motive_price_quote_invalid';
      // Owner 2026-11-10: the first price objection alone never opens the first
      // gift; it takes a second objection or the «sí» to the price question.
      return input.has_delivered_bonus || input.prior_price_objection_recorded === true
        ? null : 'motive_first_price_objection';
    }
    case 'purchase_decline':
      return input.retention_used || !input.purchase_decline_recorded ? 'motive_retention_unavailable' : null;
    case 'promotion_rejection':
      return input.has_delivered_bonus ? null : 'motive_needs_delivered_offer';
    case 'better_promotion_request':
      // Owner 2026-11-09: once the paid course price was presented, an explicit
      // discount/promotion request is enough for the first bonus.
      return input.has_delivered_bonus || input.price_presented === true ? null : 'motive_needs_delivered_offer';
  }
}
