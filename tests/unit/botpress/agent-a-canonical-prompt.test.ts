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
- El motivo de la bonificación (\`motive.quote\`) debe ser literal en el mensaje entrante actual; una objeción registrada en un turno anterior no la habilita.
- Los temarios y el texto del certificado llegan al modelo como datos autorizados mediante \`fact_id\`.
`;

describe('Agent A canonical sales prompt authority', () => {
  it('copies the Gabi/Lisandro authority byte-for-byte and appends only the permitted technical adaptations', () => {
    // Authority: AGENTS.md, “Autoridad única” + “Adaptaciones técnicas permitidas”.
    const authority = readFileSync(AUTHORITY_PATH, 'utf8');
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toBe(`${authority}\n${TECHNICAL_ANNEX}`);
    const [behavior, annex] = prompt.split('\n## Anexo técnico\n');
    expect(behavior).toBe(authority);
    expect(`## Anexo técnico\n${annex}`).toBe(TECHNICAL_ANNEX);
  });

  it('keeps both generated modules byte-identical to the canonical source at v114', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    const generated = GENERATED_PATHS.map((path) => readFileSync(path, 'utf8'));

    expect(generated[0]).toBe(generated[1]);
    expect(generated[0]).toContain(
      `export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`,
    );
    expect(generated[0]).toContain(
      "export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v114' as const;",
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

describe('Agent A canonical prompt v114 (Gabi manual integration)', () => {
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

  it('grounds the general value arguments in the authorized general facts and invents no schedules',()=>{
    expect(prompt).toContain('studyx:benefits:v1');
    expect(prompt).toContain('studyx:how_it_works:v1');
    expect(prompt).toContain('no inventes días, horarios ni fechas de clase');
  });

  it('carries the owner price guidance as model guidance (merged from the retired runtime rules)', () => {
    for (const phrase of ['Da siempre el precio (USD 360 y los planes) antes de cualquier pregunta sobre el precio o la promoción',
      'sin ofrecer, insinuar ni recordar la promoción ni el bonificado, aunque ya exista el paquete',
      'sólo ante una queja de precio, un pedido de promo o de un curso de regalo',
      'Una sola pregunta por turno']) { expect(prompt).toContain(phrase); expect(authority).toContain(phrase); }
  });

  it('closes without invasion: the advance is the conversation, not an enrollment ask',()=>{
    // Real failures of run natural-1a413da: informative price ended "Cómo te acomoda más pagarlo?";
    // "ok, gracias" was answered with "seguimos con tu inscripción a Marketing Digital…";
    // a classes question ended "te paso el formulario de inscripción?" right after an enrollment ask;
    // the testimonial said "tenemos egresadas que hoy cobran por sus servicios de belleza".
    expect(prompt).not.toContain('Cada respuesta tuya debe terminar con un avance');
    for (const phrase of ['no es un pedido de inscripción o plan', 'nunca pidas la inscripción en dos turnos seguidos',
      'no vuelvas a empujar la inscripción ni repitas el paquete', 'no es una señal',
      'nunca «cómo te acomoda pagarlo?»', 'nunca «tenemos egresadas/alumnas que…» genérico']) expect(prompt).toContain(phrase);
  });

  it('does not abandon a broad-options turn as a flat menu', () => {
    const guidance = 'Si todavía no hay criterio suficiente para recomendar, no cierres después de enumerar: termina con una sola pregunta breve que realmente separe esos caminos.';
    expect(authority).toContain(guidance);
    expect(prompt).toContain(guidance);
  });

  it('separates a forgotten ad from an explicit request for options without imposing a fixed question', () => {
    const guidance = 'Si el cliente sólo dice que no recuerda qué curso o anuncio vio y todavía no identificó un área, reconócelo y haz una sola pregunta breve de orientación, sin desplegar un catálogo de áreas o cursos. Usa el contexto: no vuelvas a pedir un objetivo ya conocido ni reformules la pregunta recién ignorada. Si pide opciones expresamente, respóndelas con una orientación breve.';
    expect(authority).toContain(guidance);
    expect(prompt).toContain(guidance);
  });

  it('pins the canonical source in the generator', () => {
    const generator = readFileSync('scripts/generate-agent-a-prompt-module.mjs', 'utf8');
    expect(generator).toContain('studyx-agent-a-canonical-v114');
    expect(generator).toContain(`lineCount !== ${prompt.match(/\n/gu)!.length}`);
  });

  it('finishes with one compact natural-sales consistency check', () => {
    for (const phrase of [
      'no reformules esa misma elección',
      'no descargues una lista plana',
      'un cierre de prueba suave',
      'no desplaces una consulta, una objeción ni un paso operativo',
    ]) expect(authority).toContain(phrase);
    expect(authority).toContain('## Comprobación final antes de responder');
  });
});
