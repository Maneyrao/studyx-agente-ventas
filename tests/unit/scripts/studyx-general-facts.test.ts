import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STUDYX_GENERAL_FACTS_V1, STUDYX_GENERAL_FACT_IDS_V1 } from '@/shared/catalog/studyx-general-facts';
import { courseLogisticsInV1 } from '@/shared/conversation/course-logistics';
import { buildCanonicalFactRegistry } from '@/features/conversation/domain/canonical-fact-registry';
import { canonicalTruthSetFromOfferingsV1, enforceCommercialTruthV1 } from '@/features/orchestration/domain/commercial-truth-guard';

describe('Studyx general facts (Gabi manual)', () => {
  it('has the two ids, quotes the manual and carries no forbidden text', () => {
    expect([...STUDYX_GENERAL_FACT_IDS_V1]).toEqual(['studyx:benefits:v1', 'studyx:how_it_works:v1']);
    const data = JSON.parse(readFileSync('supabase/seed/data/studyx-general-facts-2026-11-03.json', 'utf8'));
    const manual = readFileSync(data.source, 'utf8').replace(/\s+/gu, ' ');
    for (const fact of data.facts) {
      expect(fact.value).not.toMatch(/\b699\b|beca|\$|USD/iu);
      for (const quote of fact.source_quotes) expect(manual).toContain(quote);
    }
  });

  it('authorizes flexibility but never a concrete schedule', () => {
    const authorized = new Set(STUDYX_GENERAL_FACTS_V1.flatMap((fact) => courseLogisticsInV1(fact.value)));
    expect(authorized).toEqual(new Set(['self_paced', 'live_classes', 'recorded_classes']));
    expect(courseLogisticsInV1('Las clases en vivo son todos los martes a las 19 h.')).toContain('fixed_schedule');
    expect(authorized.has('fixed_schedule')).toBe(false);
  });

  it('is registered as backend facts', () => {
    const registry = buildCanonicalFactRegistry({ business_context: null, catalog_index: null });
    for (const id of STUDYX_GENERAL_FACT_IDS_V1) expect(registry.facts.get(id)?.value).toBeTruthy();
  });

  it('lets the egress guard pass the general claims but still block an invented schedule', () => {
    const canonical = canonicalTruthSetFromOfferingsV1({ offerings: [], selected_offering_code: null });
    const codes = (content: string) => enforceCommercialTruthV1({ content, authorized_urls: [], canonical }).violations.map((v) => v.code);
    expect(codes('Tienes clases en vivo y grabadas, y avanzas a tu ritmo.')).not.toContain('LOGISTICS_NOT_CANONICAL');
    expect(codes('Las clases en vivo son todos los martes a las 19 h.')).toContain('LOGISTICS_NOT_CANONICAL');
  });
});
