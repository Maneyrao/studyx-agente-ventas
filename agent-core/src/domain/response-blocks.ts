export type ResponseBlockV3 =
  | { readonly type: 'narrative'; readonly text: string }
  | { readonly type: 'fact'; readonly fact_id: string }
  | { readonly type: 'artifact'; readonly preparation_id: string };

export interface ArtifactTableV3 {
  readonly facts: ReadonlyMap<string, string>;
  readonly artifacts: ReadonlyMap<string, string>;
}

/**
 * Materializa referencias. No interpreta, no reescribe, no reordena, no poda.
 * Una referencia sin resolver se REPORTA; nunca se descarta en silencio.
 */
export function renderBlocksV3(
  blocks: readonly ResponseBlockV3[],
  table: ArtifactTableV3,
): { readonly text: string; readonly missing: readonly string[] } {
  const parts: string[] = [];
  const missing: string[] = [];
  for (const block of blocks) {
    if (block.type === 'narrative') { parts.push(block.text.trim()); continue; }
    const key = block.type === 'fact' ? block.fact_id : block.preparation_id;
    const source = block.type === 'fact' ? table.facts : table.artifacts;
    const value = source.get(key);
    if (value === undefined) missing.push(key);
    else parts.push(value);
  }
  return { text: parts.filter((part) => part.length > 0).join('\n\n'), missing };
}

const URL_IN_NARRATIVE = /https?:\/\/\S+|\bwww\.\S+/iu;
const AMOUNT_IN_NARRATIVE =
  /(?:\b(?:usd|ars|eur)\s*\$?\s*\d|\$\s*\d|\d[\d.,]*\s*(?:usd|ars|eur|d[oó]lares?)\b)/iu;
const DURATION_IN_NARRATIVE =
  /\b\d+(?:[.,]\d+)?\s*(?:clases?|m[oó]dulos?|semanas?|meses?|a[nñ]os?|horas?)\b/iu;

/**
 * Restricción ESTRUCTURAL de la narrativa. El control de integridad la usa para
 * RECHAZAR, nunca para podar: precios, links y duraciones sólo viajan como
 * `fact` o `artifact`.
 */
export function narrativeViolationsV3(text: string): readonly (
  'NARRATIVE_CONTAINS_URL' | 'NARRATIVE_CONTAINS_AMOUNT' | 'NARRATIVE_CONTAINS_DURATION'
)[] {
  const violations: ('NARRATIVE_CONTAINS_URL' | 'NARRATIVE_CONTAINS_AMOUNT' | 'NARRATIVE_CONTAINS_DURATION')[] = [];
  if (URL_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_URL');
  if (AMOUNT_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_AMOUNT');
  if (DURATION_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_DURATION');
  return violations;
}
