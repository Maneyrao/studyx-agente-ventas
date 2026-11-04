import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertNoForbiddenText, buildFichas, OFFERING_CODE_BY_MANUAL_NAME } from '../../../scripts/generate-gabi-fichas-seed.mjs';
import data from '../../../supabase/seed/data/fichas-gabi-2026-11-03.json';
import { claimFichasV1, fichaFactIdV1, fichaFactValueV1, fichaOfferingCodes } from '@/shared/catalog/gabi-fichas';
import { buildCanonicalFactRegistry } from '@/features/conversation/domain/canonical-fact-registry';

const manual = readFileSync('docs/authority/material-gabi-2026-11-03/Manual_Capacitacion_Studyx_2026.txt', 'utf8');
const index = readFileSync('docs/authority/material-gabi-2026-11-03/indice_para_el_agente.csv', 'utf8');

describe('Gabi fichas generator', () => {
  it.each(['USD 699', 'Beca Studyx', 'cuesta $50', 'pagas 699', 'una beca'])('aborts on forbidden text: %s', (text) => {
    expect(() => assertNoForbiddenText({ courses: [{ descripcion: text }] })).toThrow('FICHA_FORBIDDEN_TEXT');
  });

  it('rebuilds the committed file from the manual and the index, with 57 courses', () => {
    const built = buildFichas(manual, index);
    expect(built.courses).toHaveLength(57);
    expect(JSON.parse(JSON.stringify(built))).toEqual(data);
    expect(built.unmapped).toContain('Real Estate');
    expect(JSON.stringify(built)).not.toMatch(/\b699\b|beca|\$|USD/iu);
  });

  it('maps only to real catalog codes and lists the rest as unmapped', () => {
    const seed = readFileSync('supabase/seed/studyx.sql', 'utf8') + readFileSync('supabase/seed/studyx-manual.sql', 'utf8');
    const codes = (Object.values(OFFERING_CODE_BY_MANUAL_NAME) as Array<string | null>).filter((code): code is string => code !== null);
    for (const code of codes) expect(seed, code).toContain(`'${code}'`);
    expect(data.unmapped.length).toBe((Object.values(OFFERING_CODE_BY_MANUAL_NAME) as Array<string | null>).filter((code) => code === null).length);
  });
});

describe('ficha facts', () => {
  const active = new Set(fichaOfferingCodes());

  it('renders a bounded fact without price, scholarship or class count, only for active offerings', () => {
    for (const code of active) {
      const value = fichaFactValueV1(code, { activeCodes: active })!;
      expect(value.length).toBeLessThanOrEqual(1_200);
      expect(value).not.toMatch(/\b699\b|beca|\$|USD/iu);
    }
    expect(fichaFactValueV1('unas_gelificadas', { activeCodes: new Set(['maquillaje_profesional']) })).toBeNull();
    expect(fichaFactValueV1('real_estate', { activeCodes: active })).toBeNull();
    const nails = fichaFactValueV1('unas_gelificadas', { activeCodes: active })!;
    expect(nails).toContain('Beauty freelance: Maquillaje Profesional + Uñas Gelificadas + Instagram para Emprendedores');
  });

  it('routes only name courses that are active', () => {
    const value = fichaFactValueV1('unas_gelificadas', { activeCodes: new Set(['unas_gelificadas', 'maquillaje_profesional']) })!;
    expect(value).toContain('Maquillaje Profesional + Uñas Gelificadas');
    expect(value).not.toContain('Instagram para Emprendedores (');
  });

  it("carries the manual's «Combínalo con» and only active route courses in the focus and candidate fichas", () => {
    const nails = fichaFactValueV1('unas_gelificadas', { activeCodes: active })!;
    expect(nails).toMatch(/Combínalo con: [^.]+\./u);
    const candidate = claimFichasV1({ focusCode: 'unas_gelificadas', bonusCandidateCodes: ['maquillaje_profesional'], activeCodes: active })
      .find((ficha) => ficha.role === 'bonus_candidate')!;
    expect(candidate.value).toContain('Rutas de carrera (solo argumento)');
    // The ficha is argument for the model; the permission set stays the backend's (AGENTS.md: pertenencia al conjunto).
    const withoutPartner = fichaFactValueV1('unas_gelificadas', { activeCodes: new Set(['unas_gelificadas']) })!;
    expect(withoutPartner).not.toContain('Rutas de carrera');
  });

  it('claims only the focus ficha and the bonus candidates, never the whole manual', () => {
    const fichas = claimFichasV1({ focusCode: 'unas_gelificadas',
      bonusCandidateCodes: ['maquillaje_profesional', 'unas_gelificadas', 'barista_inexistente'], activeCodes: active });
    expect(fichas.map((ficha) => [ficha.offering_code, ficha.role])).toEqual([
      ['unas_gelificadas', 'focus'], ['maquillaje_profesional', 'bonus_candidate']]);
    expect(claimFichasV1({ focusCode: null, bonusCandidateCodes: [], activeCodes: active })).toEqual([]);
    expect(claimFichasV1({ focusCode: 'unas_gelificadas', bonusCandidateCodes: [], activeCodes: new Set() })).toEqual([]);
  });

  it('is citable through the backend fact registry for active catalog offerings only', () => {
    const registry = buildCanonicalFactRegistry({ business_context: null, catalog_index: {
      as_of: '2026-11-03T00:00:00.000Z', offerings_total: 2, injection_suspected_count: 0,
      offerings: [{ code: 'unas_gelificadas', display_name: 'Uñas', aliases: [], academy: 'Moda' },
        { code: 'curso_sin_ficha', display_name: 'Otro', aliases: [], academy: 'Moda' }],
    } as never });
    expect(registry.facts.get(fichaFactIdV1('unas_gelificadas'))).toMatchObject({ kind: 'offering_syllabus', offering_code: 'unas_gelificadas' });
    expect(registry.facts.has(fichaFactIdV1('maquillaje_profesional'))).toBe(false);
    expect(registry.facts.has(fichaFactIdV1('curso_sin_ficha'))).toBe(false);
  });
});
