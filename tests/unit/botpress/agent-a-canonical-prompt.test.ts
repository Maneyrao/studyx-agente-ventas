import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATH = 'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts';
describe('Agent A canonical sales prompt', () => {
  it('ships the complete approved prompt and a byte-equivalent generated module', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt.match(/\n/g) ?? []).toHaveLength(65);
    expect(createHash('sha256').update(prompt).digest('hex')).toMatch(/^[a-f0-9]{64}$/u);
    expect(existsSync(GENERATED_PATH)).toBe(true);

    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(`export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`);
    expect(generated).toContain("export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v74' as const;");
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

    expect(prompt).toMatch(/espera esa confirmaci[oó]n antes de cualquier enlace/iu);
    expect(prompt).toMatch(/no reexplique el curso, liste planes/iu);
  });

  it('reconfirms complete data once and waits for corrections or confirmation before the payment link', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    expect(prompt).toMatch(/resumen[^:]*: nombre, apellido, correo y tel[eé]fono/iu);
    expect(prompt).toMatch(/espera esa confirmaci[oó]n antes de cualquier enlace/iu);
    expect(prompt).toContain('Si corrige un dato, actualízalo y reconfirma');
    expect(prompt).toMatch(/ni repita un resumen aceptado sin cambios/iu);
    expect(prompt).not.toContain('confirma brevemente si aún hace falta');
  });

  it('uses occasional emojis for warmth without forcing them into every reply', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    expect(prompt).toMatch(/emoji de vez en cuando/iu);
    expect(prompt).toMatch(/es opcional/iu);
    expect(prompt).toMatch(/nunca mec[aá]nicamente/iu);
    expect(prompt).toMatch(/bienvenida final/iu);
  });

  it('explains both access delivery channels with the link and reserves welcome for confirmed new students', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    expect(prompt).toMatch(/alta será automática[\s\S]*primera inscripción[\s\S]*email y WhatsApp/iu);
    expect(prompt).toMatch(/cuenta[\s\S]*conservará sus credenciales/iu);
    expect(prompt).toMatch(/redactas toda la parte conversacional de postventa[\s\S]*personalidad[\s\S]*contexto del cliente/iu);
    expect(prompt).toMatch(/backend añade únicamente hechos inmutables[\s\S]*Usuario\/Contraseña[\s\S]*enlace de acceso/iu);
    expect(prompt).toMatch(/cuentas nuevas[\s\S]*bienvenida cálida[\s\S]*cuenta existente[\s\S]*sin recibirla como nueva/iu);
    expect(prompt).toMatch(/access_message_status=`sent`[\s\S]*ya fue enviado[\s\S]*no hables en futuro/iu);
  });

  it('teaches a variable WhatsApp rhythm without imposing two bubbles on every turn', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/formato orientativo, no (?:una )?plantilla literal/iu);
    expect(prompt).toMatch(/uno o dos mensajes[\s\S]*usa tres s[oó]lo si mejora la lectura/iu);
    expect(prompt).toMatch(/dos o m[aá]s (?:cursos|opciones)[\s\S]*lista/iu);
    expect(prompt).toMatch(/no conviertas cada elemento[\s\S]*mensaje separado/iu);
  });

  it('prioritizes only new information and does not force a closing question', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/responde s[oó]lo con informaci[oó]n nueva/iu);
    expect(prompt).toMatch(/preguntar es opcional/iu);
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
    expect(prompt).toMatch(/contenido no interpretable/iu);
    expect(prompt).toMatch(/reenvíe el audio|escriba el mensaje/iu);
    expect(prompt).toMatch(/var[ií]a:[^\n]*responde[^\n]*reacciona[^\n]*profundiza/iu);
    expect(prompt).toMatch(/no encadenes preguntas para completar campos/iu);
    expect(prompt).toMatch(/situaci[oó]n actual[\s\S]*deseo[\s\S]*motivaci[oó]n[\s\S]*distancia[\s\S]*frenos/iu);
    expect(prompt).toMatch(/informaci[oó]n del cliente[\s\S]*necesidad[\s\S]*hecho verificado[\s\S]*utilidad personal/iu);
    expect(prompt).toMatch(/ejemplos[^.]*no son scripts/iu);
  });

  it('keeps commercial firmness collaborative instead of blaming or ordering the prospect', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/s[eé] firme sin impaciencia, reproches ni [oó]rdenes/iu);
    expect(prompt).toMatch(/pide de forma colaborativa/iu);
  });

  it('runs Lisandro humanity check before returning the model-authored reply', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/persona real[^.]*WhatsApp/iu);
    expect(prompt).toMatch(/gen[eé]ric[oa][^.]*(?:fr[ií][oa])[^.]*(?:administrativ[oa])[^.]*(?:repetitiv[oa])/iu);
    expect(prompt).toMatch(/reescr[ií]b[^.]*menos palabras[^.]*sin alterar hechos ni acciones/iu);
  });

  it('offers a call for a commercial reason rather than for turn position alone', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/segunda intervenci[oó]n comercial[^.]*raz[oó]n concreta/iu);
    expect(prompt).toMatch(/posici[oó]n temporal[^.]*no sustituye[^.]*raz[oó]n comercial/iu);
  });

  it('retains the richer commercial context Lisandro expects without storing inference', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/trabajo[^.]*habilidad[^.]*reconocimiento de terceros/iu);
    expect(prompt).toMatch(/frustraci[oó]n[^.]*persona relevante[^.]*oportunidad[^.]*visi[oó]n futura/iu);
    expect(prompt).toMatch(/no guardes inferencias/iu);
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
    expect(prompt).toMatch(/confirmaci[oó]n posterior[\s\S]*request_call_now/iu);
    expect(prompt).toMatch(/si no puede[\s\S]*sigue por chat/iu);
    expect(prompt).toMatch(/reconfirma ante un pedido posterior/iu);
  });

  it('advances calls and payment links without redundant permissions or repeated summaries', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/intenci[oó]n ya est[aá] clara[\s\S]*sin pedir permisos redundantes/iu);
    expect(prompt).toMatch(/con datos completos[\s\S]*ll[aá]mame[\s\S]*request_call_now[\s\S]*ese turno/iu);
    expect(prompt).toMatch(/curso, plan y datos completos[\s\S]*directo al resumen[\s\S]*sin reconfirmar el plan/iu);
    expect(prompt).toMatch(/confirmaci[oó]n del resumen[\s\S]*env[ií]a el enlace[\s\S]*sin pedir otro «dale»/iu);
  });

});
