import { describe, expect, it } from 'vitest';
import { protectedFactsInContentV1 } from '@/features/orchestration/domain/egress-guard';
import { extractProtectedFacts } from '../../../botpress-agent/src/utils/authorized-egress';

/** Owner value register (2026-11-03): "dos cursos al precio de uno" is an idiom, not an amount. */
describe('price idiom "al precio de uno"', () => {
  const prices = (text: string) => [protectedFactsInContentV1(text), extractProtectedFacts(text)]
    .map(facts => facts.filter(fact => fact.kind === 'price').map(fact => fact.value));
  it.each(['te llevas dos cursos al precio de uno!', 'tres cursos al precio de uno', 'todo al precio de un curso'])(
    'is not a price claim: %s', (text) => expect(prices(text)).toEqual([[], []]));
  it.each(['el precio de un millón', 'el precio es 360 dólares', 'precio de uno mil dolares',
    'al precio de uno con cincuenta', 'precio de un ciento', 'precio de uno 360'])(
    'still extracts a real amount: %s', (text) => {
      for (const found of prices(text)) expect(found.length).toBeGreaterThan(0);
    });
});
