// Verifies that the committed general facts quote Gabi's manual and carry no
// forbidden text (699, beca, $, USD). Exits non-zero otherwise.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'supabase/seed/data/studyx-general-facts-2026-11-03.json'), 'utf8'));
const manual = readFileSync(resolve(root, data.source), 'utf8').replace(/\s+/gu, ' ');
const FORBIDDEN = /\b699\b|beca|\$|USD/iu;
for (const fact of data.facts) {
  if (FORBIDDEN.test(fact.value)) throw new Error(`STUDYX_GENERAL_FACT_FORBIDDEN_TEXT:${fact.id}`);
  for (const quote of fact.source_quotes) {
    if (!manual.includes(quote.replace(/\s+/gu, ' '))) throw new Error(`STUDYX_GENERAL_FACT_QUOTE_NOT_IN_MANUAL:${fact.id}:${quote}`);
  }
}
console.log(`verified ${data.facts.length} general facts`);
