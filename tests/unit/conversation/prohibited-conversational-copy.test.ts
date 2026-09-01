import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const SEARCHED_ROOTS = ['src', 'botpress-agent/src'];

/**
 * Copy that answers no question. Each of these shipped to a real customer as a
 * substitute for a written answer: the agent replied with the same sentence to
 * "Acá te lo pasé" and to "¿Ese link que enviaste es el del pago?".
 *
 * A fixed sentence is legitimate ONLY as a fallback for an empty composition.
 * Any of these reaching the source again means a layer went back to replacing
 * the answer instead of constraining the facts inside it.
 */
const PROHIBITED_COPY = [
  'Revisá el mensaje anterior',
  'revisá el mensaje anterior',
];

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

describe('prohibited conversational copy', () => {
  const files = SEARCHED_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root)));

  it('finds production sources to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never hardcodes a sentence that replaces the answer to the current question', () => {
    const offenders = files.filter((file) => {
      const content = readFileSync(file, 'utf8');
      return PROHIBITED_COPY.some((phrase) => content.includes(phrase));
    });

    expect(offenders).toEqual([]);
  });
});
