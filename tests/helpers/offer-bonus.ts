import { offerDirectCourseBonusV1, type OfferDirectCourseBonusInputV1 } from '@/features/promotions/application/direct-course-bonus-service';

type Client = Parameters<typeof offerDirectCourseBonusV1>[0];
type Input = Omit<OfferDirectCourseBonusInputV1, 'motive' | 'declared_moves'> & Partial<Pick<OfferDirectCourseBonusInputV1, 'motive' | 'declared_moves'>>;

/**
 * Fixture setup for suites that are not about the motive: the bonus motive comes
 * from the current batch, so unless the test sets one, quote the whole text of
 * the source turn as a price complaint (a structurally valid motive).
 */
export async function offerBonusWithMotive(client: Client, input: Input) {
  if ('motive' in input) return offerDirectCourseBonusV1(client, input as OfferDirectCourseBonusInputV1);
  const [turn] = await client`SELECT content FROM messages WHERE id=${input.source_turn_id}::uuid`;
  return offerDirectCourseBonusV1(client, { ...input, motive: { kind: 'price_objection', quote: String(turn?.content ?? '') },
    declared_moves: ['price_objection'] });
}
