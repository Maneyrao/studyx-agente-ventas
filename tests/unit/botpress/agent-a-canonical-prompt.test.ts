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
      "export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v101' as const;",
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
