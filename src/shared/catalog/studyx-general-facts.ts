import data from '../../../supabase/seed/data/studyx-general-facts-2026-11-03.json';

/**
 * General Studyx facts from Gabi's manual ("Lo que el alumno recibe", "Cómo se
 * cursa"): authorized value arguments that hold for every course. Verified
 * against the manual by scripts/verify-studyx-general-facts.mjs; they never
 * carry a price or the scholarship. The same ids reach the model context, the
 * backend registry and the logistics guard.
 */
export interface StudyxGeneralFactV1 {
  readonly id: string;
  readonly kind: 'offering_description';
  readonly value: string;
}

export const STUDYX_GENERAL_FACTS_V1: readonly StudyxGeneralFactV1[] = data.facts.map((fact) => ({
  id: fact.id, kind: 'offering_description' as const, value: fact.value,
}));

export const STUDYX_GENERAL_FACT_IDS_V1: ReadonlySet<string> = new Set(STUDYX_GENERAL_FACTS_V1.map((fact) => fact.id));
