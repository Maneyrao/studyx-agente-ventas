import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AUTHORITY_PATH = 'docs/authority/prompt-agente-a-studyx-v2.md';
const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATHS = [
  'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts',
  'src/shared/prompts/studyx-agent-a-canonical.generated.ts',
] as const;

const TECHNICAL_ANNEX = `## Anexo técnico

- La especificación de bonificación se traduce al contrato real \`AgentATurnProposalV1\`: no existe \`move=negotiate\` y \`proposed_action\` es un objeto.
- \`accept_promotion\` lleva la identidad completa del contexto: \`promotion_code\`, \`interest_offering_code\`, \`promotion_cycle_id\` y \`offer_version\`.
- Ante el rechazo de una bonificación se quita sólo el curso nuevo y se conservan los ya entregados.
- La \`price_objection\` que habilita la bonificación debe estar registrada en un turno anterior.
- Los temarios y el texto del certificado llegan al modelo como datos autorizados mediante \`fact_id\`.
`;

describe('Agent A canonical sales prompt authority', () => {
  it('copies the Gabi/Lisandro authority byte-for-byte and appends only the permitted technical adaptations', () => {
    // Authority: AGENTS.md, “Autoridad única” + “Adaptaciones técnicas permitidas”.
    const authority = readFileSync(AUTHORITY_PATH, 'utf8');
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toBe(`${authority}\n${TECHNICAL_ANNEX}`);
  });

  it('keeps both generated modules byte-identical to the canonical source at v101', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    const generated = GENERATED_PATHS.map((path) => readFileSync(path, 'utf8'));

    expect(generated[0]).toBe(generated[1]);
    expect(generated[0]).toContain(
      `export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`,
    );
    expect(generated[0]).toContain(
      "export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v104' as const;",
    );
  });

  it('retains the closed identity, negotiation and call decisions from authority', () => {
    // Authority prompt lines 7, 98-112 and 196-207.
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toContain('«Soy {{NOMBRE_ASESOR}}, asesora de Studyx»');
    expect(prompt).toContain('presenta el plan de 12 cuotas como la forma más accesible');
    expect(prompt).toContain('La llamada es una herramienta de cierre complementaria');
    expect(prompt).not.toMatch(/asesora virtual|administrativa/iu);
  });
});

describe('Agent A canonical prompt v104 (Gabi manual integration)', () => {
  const prompt = readFileSync(PROMPT_PATH, 'utf8');
  const authority = readFileSync(AUTHORITY_PATH, 'utf8');

  it('mentions no 699, no scholarship and no inverted marks outside the rule that forbids them', () => {
    expect(authority).not.toMatch(/\b699\b|beca/iu);
    expect(authority.replace(/`¿` ni `¡`/u, '')).not.toMatch(/[¡¿]/u);
  });

  it('speaks with tú, never voseo, in the text it teaches', () => {
    const withoutRule = authority.replace(/nunca de vos, aunque el cliente use voseo/u, '');
    expect(withoutRule).not.toMatch(/\b(?:querés|podés|tenés|hacés|sabés|preferís|necesitás|contame|decime|mandá|dejá|fijate|imaginate|confirmás|avisame)\b/iu);
  });

  it('carries the manual: real testimonials, licensed trades, honest title answer and no second paid course', () => {
    for (const phrase of ['Felipe Serrano', 'Cristian y Ana María', 'Amparo y Edson', 'no reemplaza esa licencia',
      'cuánto cobrarías por un servicio cuando termines', 'qué parte te gustaría pensar: el curso, el precio o el tiempo',
      'Nunca vendas un segundo curso pago', 'baja de bonificados', 'nunca de precio', 'prefiero seguir por acá']) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).not.toMatch(/cierre con beca|cierre por inicio de clases/iu);
  });

  it('pins the canonical source in the generator', () => {
    const generator = readFileSync('scripts/generate-agent-a-prompt-module.mjs', 'utf8');
    expect(generator).toContain('studyx-agent-a-canonical-v104');
    expect(generator).toContain(`lineCount !== ${prompt.match(/\n/gu)!.length}`);
  });
});
