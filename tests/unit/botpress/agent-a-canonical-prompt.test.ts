import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATH = 'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts';
const EXPECTED_SHA256 = '172c2965a2c4e369ad191d84e8f8ac7aae5690bc7febfb3f4a3b919f1ddc9b72';

describe('Agent A canonical sales prompt', () => {
  it('ships the complete approved prompt and a byte-equivalent generated module', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt.match(/\n/g) ?? []).toHaveLength(63);
    expect(createHash('sha256').update(prompt).digest('hex')).toBe(EXPECTED_SHA256);
    expect(existsSync(GENERATED_PATH)).toBe(true);

    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(`export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`);
    expect(generated).toContain("export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v61' as const;");
  });

  it('combines warm Meta-lead selling with autonomous objection and post-call handling', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/leads? c[aá]lidos?.*Meta/iu);
    expect(prompt).toMatch(/iniciativa[\s\S]*llamada[\s\S]*inscripci[oó]n/iu);
    expect(prompt).toMatch(/objeci[oó]n[\s\S]*entiend[ea][\s\S]*personaliza[\s\S]*avanza/iu);
    expect(prompt).toMatch(/no fue atendida[\s\S]*reintentar[\s\S]*chat/iu);
    expect(prompt).toMatch(/report_payment[\s\S]*payment_verification[\s\S]*[uú]nica autoridad/iu);
    expect(prompt).toMatch(/`paid` con `paid_at`[\s\S]*state:payment_verified:v1/iu);
    expect(prompt).toMatch(/a[uú]n no pudiste verificarlo/iu);
  });

  it('keeps intake confirmation brief instead of combining it with another sales explanation', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/Es un paso propio/iu);
    expect(prompt).toMatch(/no vuelvas a explicar el curso ni a listar planes/iu);
  });

  it('teaches a variable WhatsApp rhythm without imposing two bubbles on every turn', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/formato orientativo, no (?:una )?plantilla literal/iu);
    expect(prompt).toMatch(/uno o dos mensajes[\s\S]*no fuerces dos/iu);
    expect(prompt).toMatch(/dos o m[aá]s (?:cursos|opciones)[\s\S]*lista/iu);
    expect(prompt).toMatch(/no conviertas cada elemento[\s\S]*mensaje separado/iu);
  });

  it('prioritizes only new information and does not force a closing question', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/responde s[oó]lo con informaci[oó]n nueva/iu);
    expect(prompt).toMatch(/pregunta es opcional/iu);
    expect(prompt).toMatch(/una opci[oó]n por l[ií]nea/iu);
  });

  it('uses Emma identity, collects name and surname early, and keeps calls commercially useful', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toContain('Eres {{NOMBRE_ASESOR}}, administrativa de {{NOMBRE_ACADEMIA}}');
    expect(prompt).toContain('«Soy {{NOMBRE_ASESOR}}, administrativa de {{NOMBRE_ACADEMIA}}»');
    expect(prompt).toMatch(/nombre y apellido[\s\S]*primeras interacciones[\s\S]*sin bloquear/iu);
    expect(prompt).toMatch(/curso concreto[\s\S]*segunda intervenci[oó]n comercial[\s\S]*primera invitaci[oó]n/iu);
    expect(prompt).toMatch(/m[aá]ximo dos invitaciones[\s\S]*segunda[\s\S]*motivo nuevo/iu);
    expect(prompt).toMatch(/ad[aá]ptalas al contexto[\s\S]*sin frases fijas/iu);
  });

  it('keeps Lisandro humanized selling as the primary behavior instead of a questionnaire', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/WhatsApp no es una llamada escrita/iu);
    expect(prompt).toMatch(/no uses una plantilla fija/iu);
    expect(prompt).toMatch(/no encadenes preguntas para completar campos/iu);
    expect(prompt).toMatch(/situaci[oó]n actual[\s\S]*deseo[\s\S]*motivaci[oó]n[\s\S]*distancia[\s\S]*frenos/iu);
    expect(prompt).toMatch(/informaci[oó]n del cliente[\s\S]*necesidad[\s\S]*hecho verificado[\s\S]*utilidad personal/iu);
    expect(prompt).toMatch(/ejemplos[^.]*no son scripts/iu);
  });

  it('sells consultatively from the current message instead of completing a questionnaire', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/situaci[oó]n actual[\s\S]*deseo[\s\S]*motivaci[oó]n[\s\S]*freno/iu);
    expect(prompt).toMatch(/lentes[^.]*no como secuencia r[ií]gida/iu);
    expect(prompt).toMatch(/informaci[oó]n del cliente[\s\S]*hecho verificado[\s\S]*utilidad/iu);
    expect(prompt).toMatch(/objeci[oó]n[\s\S]*entiend[ea][\s\S]*personaliza[\s\S]*comprueba/iu);
    expect(prompt).toMatch(/memory_candidates[\s\S]*hechos expresados/iu);
  });

  it('asks availability on one turn and dispatches only after the following confirmation', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/aceptar o pedir una llamada[\s\S]*proposed_action=none/iu);
    expect(prompt).toMatch(/puede atender ahora/iu);
    expect(prompt).toMatch(/respuesta posterior[\s\S]*request_call_now/iu);
    expect(prompt).toMatch(/si no puede[\s\S]*sigue por chat/iu);
    expect(prompt).toMatch(/pedido posterior[\s\S]*repite esta confirmaci[oó]n/iu);
  });

});
