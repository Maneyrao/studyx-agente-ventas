import { currentFactualCourseReferencesV1 } from '@/features/orchestration/domain/course-focus';

/**
 * Owner "Emma vende" (2026-11-03): while the package is open the customer may
 * swap the single offered bonus ("cambiar Inglés 2 por Reparación de PC"). One
 * shared literal detector for the backend capability, the turn policy and the
 * durable service, so the three never disagree. It never infers a course:
 * exactly one active, literally named course that is neither the paid course
 * nor already gifted.
 *
 * Adding a gift is not detected here any more (owner 2026-11-03, model-owned
 * sales): the model proposes it and a course the customer names literally only
 * widens the authorized set (`courseCodesNamedInBatchV1`).
 *
 * A swap is supported only for a package with exactly one bonus (architect
 * review 2026-11-03): cancel that cycle and open a new one with the chosen
 * course, without bypassing the append-only bonus triggers.
 */
export type CustomerBonusRequestV1 =
  | { readonly kind: 'swap'; readonly replaced_offering_code: string; readonly bonus_offering_code: string };

export interface CustomerBonusRequestInputV1 {
  readonly batch_texts: readonly string[];
  readonly offerings: ReadonlyArray<{ readonly code: string; readonly display_name: string; readonly aliases?: readonly string[] | null }>;
  readonly paid_offering_code: string;
  readonly offered_bonus_codes: readonly string[];
  readonly max_bonus_courses: number;
  /** Recent agent replies: "reparacion de pcs" resolves to a course the agent just named. */
  readonly previous_agent_messages?: readonly string[];
}

const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const SWAP_VERB = /\b(?:cambi\w*|reemplaz\w*|en vez de|en lugar de)\b/u;
const REFUSAL = /\bno\s+(?:me\s+)?(?:quiero|interesa|hace falta|bonifiques|sumes|agregues|cambies|regales)\b/u;

export function customerBonusRequestV1(input: CustomerBonusRequestInputV1): CustomerBonusRequestV1 | null {
  const text = normalized(input.batch_texts.join(' '));
  if (REFUSAL.test(text)) return null;
  if (!SWAP_VERB.test(text)) return null;
  const index = { as_of: new Date(0).toISOString(), offerings_total: input.offerings.length, injection_suspected_count: 0,
    offerings: input.offerings.map(offering => ({ code: offering.code, display_name: offering.display_name,
      aliases: [...(offering.aliases ?? [])], academy: null })) };
  const referenced = [...new Set(currentFactualCourseReferencesV1(input.batch_texts, index, input.previous_agent_messages ?? [])
    .map(reference => reference.offeringCode))];
  const candidates = referenced.filter(code => code !== input.paid_offering_code && !input.offered_bonus_codes.includes(code));
  if (candidates.length !== 1) return null;
  const bonus = candidates[0]!;
  // "En vez de Inglés 1 tomo X" names the paid course: that is a course change, not a gift.
  if (referenced.includes(input.paid_offering_code) || input.offered_bonus_codes.length !== 1) return null;
  const replaced = input.offered_bonus_codes[0]!;
  const words = (value: string) => ` ${normalized(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const replacedName = input.offerings.find(offering => offering.code === replaced)?.display_name ?? replaced;
  if (!referenced.includes(replaced) && !words(text).includes(words(replacedName))
    && !/\b(?:bonific\w*|regal\w*|gratis|sin costo)\b/u.test(text)) return null;
  return { kind: 'swap', replaced_offering_code: replaced, bonus_offering_code: bonus };
}
