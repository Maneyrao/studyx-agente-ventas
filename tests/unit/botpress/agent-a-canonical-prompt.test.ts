import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATH = 'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts';
const EXPECTED_SHA256 = '181ce5b6b3355ade6d8dfe5294f7d10d69ee1f0fcc494656721a22c5bb6e0ae2';

describe('Agent A canonical sales prompt', () => {
  it('ships the complete approved prompt and a byte-equivalent generated module', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt.match(/\n/g) ?? []).toHaveLength(123);
    expect(createHash('sha256').update(prompt).digest('hex')).toBe(EXPECTED_SHA256);
    expect(existsSync(GENERATED_PATH)).toBe(true);

    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(`export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`);
    expect(generated).toContain("export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v36' as const;");
  });

  it('uses two natural bubbles for information plus commercial advancement', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toContain('Cuando la respuesta combine información y un avance comercial, usa dos mensajes breves');
    expect(prompt).toContain('No cortes una oración por la mitad ni repitas la misma idea');
    expect(prompt).not.toContain('Elige uno o dos mensajes breves y naturales');
  });
});
