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
    if (block.type === 'narrative') { parts.push(block.text); continue; }
    const key = block.type === 'fact' ? block.fact_id : block.preparation_id;
    const source = block.type === 'fact' ? table.facts : table.artifacts;
    const value = source.get(key);
    if (value === undefined) missing.push(key);
    else parts.push(value);
  }
  return { text: parts.join('\n\n'), missing };
}

const URL_IN_NARRATIVE =
  /https?:\/\/\S+|\bwww\.\S+|(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/\S*)?/iu;

const DIGIT_VALUE = String.raw`\d[\d.,]*`;
const NUMBER_WORD = String.raw`(?:cero|un(?:o|a)?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci(?:s[eé]is|siete|ocho|nueve)|veinte|veinti(?:uno|una|d[oó]s|tr[eé]s|cuatro|cinco|s[eé]is|siete|ocho|nueve)|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient(?:os|as)|trescient(?:os|as)|cuatrocient(?:os|as)|quinient(?:os|as)|seiscient(?:os|as)|setecient(?:os|as)|ochocient(?:os|as)|novecient(?:os|as)|mil|mill[oó]n(?:es)?)`;
const WRITTEN_VALUE = String.raw`${NUMBER_WORD}(?:\s+(?:y\s+)?${NUMBER_WORD})*`;
const AMOUNT_VALUE = String.raw`(?:${DIGIT_VALUE}|${WRITTEN_VALUE})`;
const CURRENCY = String.raw`(?:usd|ars|eur|u\s*\$\s*s|d[oó]lares?|pesos?|euros?)`;

const AMOUNT_IN_NARRATIVE = new RegExp([
  String.raw`(?:\b(?:usd|ars|eur)\b\s*\$?|u\s*\$\s*s|\$)\s*${AMOUNT_VALUE}\b`,
  String.raw`\b${AMOUNT_VALUE}\s*${CURRENCY}\b`,
  String.raw`\b(?:sale|cuesta|vale)\s+${DIGIT_VALUE}\b`,
  String.raw`\b(?:el\s+)?(?:precio|valor)(?:\s+(?:es|de))?\s+${DIGIT_VALUE}\b`,
  String.raw`\b${DIGIT_VALUE}\s+cuotas?\s+de\s+${DIGIT_VALUE}\b`,
].join('|'), 'iu');

const DURATION_UNIT = String.raw`(?:clases?|m[oó]dulos?|semanas?|meses?|a[nñ]os?|horas?|d[ií]as?|minutos?)`;
const DURATION_IN_NARRATIVE = new RegExp([
  String.raw`\b(?:dura(?:ci[oó]n)?(?:\s+(?:es|de))?|son|incluye|consta\s+de|hay|tiene|tenemos|se\s+cursa\s+en|cursarlo\s+en|carrera\s+de|curso\s+de)\s+${AMOUNT_VALUE}\s*${DURATION_UNIT}\b`,
  String.raw`\b${AMOUNT_VALUE}\s*${DURATION_UNIT}\s+(?:en\s+total|de\s+cursada)\b`,
].join('|'), 'iu');

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
