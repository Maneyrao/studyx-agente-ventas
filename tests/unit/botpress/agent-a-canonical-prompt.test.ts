import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATH = 'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts';
const EXPECTED_SHA256 = 'b2bc9f09b566eeed449205d52b7e3f16a0e0cd25cdff479878b658b923fdbb4d';

describe('Agent A canonical sales prompt', () => {
  it('ships the complete approved prompt and a byte-equivalent generated module', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt.match(/\n/g) ?? []).toHaveLength(57);
    expect(createHash('sha256').update(prompt).digest('hex')).toBe(EXPECTED_SHA256);
    expect(existsSync(GENERATED_PATH)).toBe(true);

    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(`export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`);
    expect(generated).toContain("export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v51' as const;");
  });

  it('combines warm Meta-lead selling with autonomous objection and post-call handling', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/leads? c[aá]lidos?.*Meta/iu);
    expect(prompt).toMatch(/vender con iniciativa/iu);
    expect(prompt).toMatch(/objeci[oó]n[\s\S]*reconoce[\s\S]*responde[\s\S]*avanza/iu);
    expect(prompt).toMatch(/no fue atendida[\s\S]*reintentar[\s\S]*chat/iu);
    expect(prompt).toMatch(/pago informado[\s\S]*no[\s\S]*pago verificado/iu);
    expect(prompt).toMatch(/equipo humano[\s\S]*verific/iu);
  });

  it('teaches a scannable multi-message rhythm without imposing literal templates', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/formato orientativo, no (?:una )?plantilla literal/iu);
    expect(prompt).toMatch(/dos mensajes[\s\S]*respuesta concreta[\s\S]*siguiente paso/iu);
    expect(prompt).toMatch(/dos o m[aá]s (?:cursos|opciones)[\s\S]*lista/iu);
    expect(prompt).toMatch(/no conviertas cada elemento[\s\S]*mensaje separado/iu);
  });

  it('makes the initial name request and first eligible call invitation explicit without canned copy', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/nombre[\s\S]*primer intercambio[\s\S]*sin bloquear/iu);
    expect(prompt).toMatch(/ofrece la primera[\s\S]*segunda intervenci[oó]n elegible/iu);
    expect(prompt).toMatch(/redacta ambas para el contexto[\s\S]*sin frases fijas/iu);
  });

});
