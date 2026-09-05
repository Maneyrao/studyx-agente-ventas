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

const URL_IN_NARRATIVE = new RegExp([
  String.raw`https?:\/\/\S+`,
  String.raw`\bwww\.\S+`,
  String.raw`\b(?:localhost(?::\d{1,5})?|(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?)(?:\/\S*)`,
  String.raw`(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?!(?:js|json|ts|tsx|jsx|css|html?|md|txt|xml|ya?ml|csv|pdf|docx?|xlsx?|pptx?)\b)[a-z]{2,63}(?:\/\S*)?`,
].join('|'), 'iu');

const DIGIT_VALUE = String.raw`\d[\d.,]*`;
const NUMBER_WORD = String.raw`(?:cero|un(?:o|a)?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci(?:s[eé]is|siete|ocho|nueve)|veinte|veinti(?:uno|una|d[oó]s|tr[eé]s|cuatro|cinco|s[eé]is|siete|ocho|nueve)|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient(?:os|as)|trescient(?:os|as)|cuatrocient(?:os|as)|quinient(?:os|as)|seiscient(?:os|as)|setecient(?:os|as)|ochocient(?:os|as)|novecient(?:os|as)|mil|mill[oó]n(?:es)?)`;
const WRITTEN_VALUE = String.raw`${NUMBER_WORD}(?:\s+(?:y\s+)?${NUMBER_WORD})*`;
const AMOUNT_VALUE = String.raw`(?:${DIGIT_VALUE}|${WRITTEN_VALUE})`;
const CONTEXT_AMOUNT_VALUE = String.raw`(?:${DIGIT_VALUE}|(?!(?:un(?:o|a)?)\b)${WRITTEN_VALUE})`;
const CURRENCY = String.raw`(?:usd|ars|eur|u\s*\$\s*s|d[oó]lares?|pesos?|euros?)`;

const AMOUNT_IN_NARRATIVE = new RegExp([
  String.raw`(?:\b(?:usd|ars|eur)\b\s*\$?|u\s*\$\s*s|\$)\s*${AMOUNT_VALUE}\b`,
  String.raw`\b${AMOUNT_VALUE}\s*${CURRENCY}\b`,
  String.raw`\b(?:sale|cuesta|vale)\s+${CONTEXT_AMOUNT_VALUE}\b`,
  String.raw`\b(?:el\s+)?(?:precio|valor)(?:\s+final)?\s*(?::|\s+(?:es(?:\s+de)?|de))?\s*${CONTEXT_AMOUNT_VALUE}\b`,
  String.raw`\b(?:la\s+|el\s+)?(?:cuota|importe)\s*(?::|\s+(?:es(?:\s+de)?|de))\s*${CONTEXT_AMOUNT_VALUE}\b`,
  String.raw`\b${AMOUNT_VALUE}\s+cuotas?\s+de\s+${CONTEXT_AMOUNT_VALUE}\b`,
].join('|'), 'iu');

const COURSE_COUNT_UNIT = String.raw`(?:clases?|m[oó]dulos?)`;
const TIME_DURATION_UNIT = String.raw`(?:semanas?|meses?|a[nñ]os?|horas?|d[ií]as?|minutos?)`;
const APPROXIMATELY = String.raw`(?:(?:aproximadamente|aprox\.?)\s+)?`;
const DURATION_IN_NARRATIVE = new RegExp([
  String.raw`\b${AMOUNT_VALUE}\s*${COURSE_COUNT_UNIT}\b`,
  String.raw`\b(?:dura(?:ci[oó]n)?(?:\s+(?:es|de))?|se\s+cursa\s+en|cursarlo\s+en|carrera\s+de|curso\s+de)\s+${APPROXIMATELY}${AMOUNT_VALUE}\s*${TIME_DURATION_UNIT}\b`,
  String.raw`\b(?:curso|cursada|programa|capacitaci[oó]n|carrera)\b[^.!?;\n]{0,48}\b(?:dura|es\s+de|se\s+completa\s+en|se\s+cursa\s+en|se\s+extiende\s+(?:por|durante)|consta\s+de|incluye)\s+${APPROXIMATELY}${AMOUNT_VALUE}\s*${TIME_DURATION_UNIT}\b`,
  String.raw`\bduraci[oó]n(?:\s+del?\s+(?:curso|cursada|programa|capacitaci[oó]n|carrera))?\s*(?::|\s+(?:es(?:\s+de)?|de))\s+${APPROXIMATELY}${AMOUNT_VALUE}\s*${TIME_DURATION_UNIT}\b`,
  String.raw`\b(?:la\s+)?carga\s+horaria\s+(?:es\s+de|de|totaliza)\s+${APPROXIMATELY}${AMOUNT_VALUE}\s*${TIME_DURATION_UNIT}\b`,
  String.raw`\b${AMOUNT_VALUE}\s*${TIME_DURATION_UNIT}\s+de\s+cursada\b`,
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
