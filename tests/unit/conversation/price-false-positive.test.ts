import { describe, expect, it } from 'vitest';
import { extractProtectedFacts as botpressExtract } from '../../../botpress-agent/src/utils/authorized-egress';
import { protectedFactsInContentV1 as backendExtract } from '@/features/orchestration/domain/egress-guard';

// focused-29-41-r3 29/expensive: "menos de lo que cuesta una salida a comer" was read as the price "cuesta una".
describe('"cuesta un/una <noun>" is a comparison, not a price', () => {
  for (const [name, extract] of [['botpress', botpressExtract], ['backend', backendExtract]] as const) {
    it(`${name}: ignores the comparison and keeps real prices`, () => {
      const prices = (text: string) => extract(text).filter(fact => fact.kind === 'price').map(fact => fact.value);
      expect(prices('Son USD 30 al mes, menos de lo que cuesta una salida a comer.')).toEqual(['usd 30']);
      expect(prices('Es menos de lo que cuesta un almuerzo por semana.')).toEqual([]);
      expect(prices('El curso cuesta 360 dólares')).toHaveLength(1);
      expect(prices('El curso cuesta USD 360')).toHaveLength(1);
      expect(prices('cuesta trescientos sesenta dólares')).toHaveLength(1);
    });
  }
});
