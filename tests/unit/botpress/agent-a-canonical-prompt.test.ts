import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATH = 'docs/prompts/studyx-agent-a-canonical.md';
const GENERATED_PATH = 'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts';
describe('Agent A canonical sales prompt', () => {
  it('ships the complete approved prompt and a byte-equivalent generated module', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt.match(/\n/g) ?? []).toHaveLength(67);
    expect(createHash('sha256').update(prompt).digest('hex')).toMatch(/^[a-f0-9]{64}$/u);
    expect(existsSync(GENERATED_PATH)).toBe(true);

    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(`export const STUDYX_AGENT_A_CANONICAL_PROMPT = ${JSON.stringify(prompt)} as const;`);
    expect(generated).toContain("export const STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v95' as const;");
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

  it('keeps the payment handoff concise and reserves access details for verified post-sale', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');
    expect(prompt).toMatch(/transición (?:breve y )?humana[\s\S]*No expliques (?:el funcionamiento de )?Stripe/iu);
    expect(prompt).toMatch(/No enumeres por adelantado[\s\S]*evento verificado de postventa/iu);
    expect(prompt).toMatch(/link canónico dentro del mismo mensaje/iu);
    expect(prompt).toMatch(/redactas toda la parte conversacional de postventa[\s\S]*personalidad[\s\S]*contexto del cliente/iu);
    expect(prompt).toMatch(/backend añade únicamente hechos inmutables[\s\S]*Usuario\/Contraseña[\s\S]*enlace de acceso/iu);
    expect(prompt).toMatch(/cuentas nuevas[\s\S]*bienvenida cálida[\s\S]*cuenta existente[\s\S]*sin recibirla como nueva/iu);
    expect(prompt).toMatch(/access_message_status=`sent`[\s\S]*ya fue enviado[\s\S]*no hables en futuro/iu);
  });

  it('teaches a variable WhatsApp rhythm without imposing two bubbles on every turn', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/formato orientativo, no (?:una )?plantilla literal/iu);
    expect(prompt).toMatch(/uno o dos mensajes[\s\S]*no fuerces dos si uno basta/iu);
    expect(prompt).toMatch(/nunca hagas m[aá]s de una pregunta principal por intervenci[oó]n/iu);
    expect(prompt).toMatch(/dos o m[aá]s (?:cursos|opciones)[\s\S]*lista/iu);
    expect(prompt).toMatch(/no conviertas cada elemento[\s\S]*mensaje separado/iu);
  });

  it('prioritizes only new information and does not force a closing question', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/responde s[oó]lo con informaci[oó]n nueva/iu);
    expect(prompt).toMatch(/preguntar es opcional/iu);
    expect(prompt).toMatch(/una opci[oó]n por l[ií]nea/iu);
  });

  it('closes gratitude and post-sale turns from the actual relationship instead of a stock phrase', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/agradec(?:e|imiento)|agradece|gratitud/iu);
    expect(prompt).toMatch(/curso seleccionado|nombre concreto del curso/iu);
    expect(prompt).toMatch(/no cierres? con una oferta gen[eé]rica de ayuda|evita cierres? gen[eé]ricos/iu);
    expect(prompt).toMatch(/no vuelvas a vender|sin volver a vender/iu);
  });

  it('treats generic assistant history as failed output rather than a style to imitate', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/respuesta(?:s)? anterior(?:es)?[^.]*gen[eé]rica/iu);
    expect(prompt).toMatch(/no la imites|no las imites/iu);
    expect(prompt).toMatch(/pregunta pendiente|intenci[oó]n pendiente/iu);
  });

  it('uses Emma identity, delays data collection, and keeps calls commercially useful', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toContain('Eres {{NOMBRE_ASESOR}}, administrativa de Studyx');
    expect(prompt).toContain('«Soy {{NOMBRE_ASESOR}}, administrativa de Studyx»');
    expect(prompt).toMatch(/varía naturalmente el saludo, la puntuación y la transición/iu);
    expect(prompt).toContain('No añadas «Academia Internacional»');
    expect(prompt).not.toMatch(/asesora virtual|asistente virtual/iu);
    expect(prompt).toContain('No uses los signos invertidos de apertura `¿` ni `¡` en ningún punto');
    expect(prompt).toMatch(/no pidas nombre y apellido por rutina/iu);
    expect(prompt).toMatch(/primera duda relevante[\s\S]*necesidad o un [aá]rea[\s\S]*primera invitaci[oó]n[\s\S]*motivo real/iu);
    expect(prompt).not.toMatch(/segunda intervenci[oó]n comercial/iu);
    expect(prompt).toMatch(/m[aá]ximo dos invitaciones[\s\S]*segunda[\s\S]*motivo nuevo/iu);
    expect(prompt).toMatch(/adaptada al trato y (?:al )?motivo real[\s\S]*no repitas esa frase como plantilla/iu);
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

  it('keeps internal truth and authorization rules out of customer-facing copy', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/veracidad[^.]*autorizaci[oó]n[^.]*reglas internas/iu);
    expect(prompt).toMatch(/hecho comercial confirmado[^.]*paso [uú]til/iu);
    expect(prompt).toMatch(/no declares tu honestidad[^.]*(?:no|ni) menciones que evitas inventar/iu);
    expect(prompt).toMatch(/no puedo confirmarlo[^.]*dato realmente falta/iu);
  });

  it('offers a call for a commercial reason rather than for turn position alone', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/primera duda relevante[^.]*necesidad o un [aá]rea/iu);
    expect(prompt).toMatch(/no la ofrezcas (?:s[oó]lo )?por turnos ni en cada mensaje/iu);
    expect(prompt).toMatch(/objeci[oó]n persistente/iu);
  });

  it('handles price objections by building value without reframing or changing the price', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/pregunta directa[^.]*precio[^.]*responde[^.]*hechos autorizados/iu);
    expect(prompt).toMatch(/objeci[oó]n de precio[^.]*no uses[^.]*cuotas[^.]*comparaciones/iu);
    expect(prompt).toMatch(/no bajes ni cambies el precio/iu);
    expect(prompt).toMatch(/consulta de precio[^.]*no la habilita/iu);
    expect(prompt).toMatch(/resistencia persistente[^.]*request_promotion_review/iu);
    expect(prompt).toMatch(/sin prometer resultados[^.]*emprender[^.]*ampliar ingresos/iu);
    expect(prompt).not.toMatch(/curso gratis|por el mismo valor/iu);
    expect(prompt).toMatch(/limitaci[oó]n real de presupuesto[^.]*sin presionar/iu);
  });

  it('adapts to the customer register and delays intake until it executes a chosen next step', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/si habla de vos[^.]*voseo[^.]*si usa t[uú][^.]*t[uú]/iu);
    expect(prompt).toMatch(/no pidas nombre y apellido por rutina|no conviertas el inicio en un formulario/iu);
    expect(prompt).toMatch(/datos[^.]*cuando[^.]*llamada|inscripci[oó]n/iu);
  });

  it('resolves short referents and refuses to promise an exception without a real action', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/«pasame eso»|«pasame el link»/iu);
    expect(prompt).toMatch(/no prometas elevar[^.]*excepci[oó]n[^.]*acci[oó]n/iu);
  });

  it('makes Agent A the sole author across ordinary, call and post-sale moments', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/toda prosa visible[^.]*la redactas t[uú]/iu);
    expect(prompt).toMatch(/backend no redacta, completa ni reemplaza respuestas/iu);
    expect(prompt).toMatch(/llamada[^.]*postventa[^.]*protocolo[^.]*no guiones fijos/iu);
    expect(prompt).toMatch(/etapa comercial actual[^.]*intenci[oó]n del cliente/iu);
  });

  it('retains the richer commercial context Lisandro expects without storing inference', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/trabajo[^.]*habilidad[^.]*reconocimiento de terceros/iu);
    expect(prompt).toMatch(/frustraci[oó]n[^.]*persona relevante[^.]*oportunidad[^.]*visi[oó]n futura/iu);
    expect(prompt).toMatch(/no guardes inferencias/iu);
    expect(prompt).toMatch(/matiz de certeza[^.]*source_quote[^.]*inter[eé]s tentativo[^.]*no un objetivo confirmado/iu);
  });

  it('sells consultatively from the current message instead of completing a questionnaire', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/situaci[oó]n actual[\s\S]*deseo[\s\S]*motivaci[oó]n[\s\S]*freno/iu);
    expect(prompt).toMatch(/lentes[^.]*no como secuencia r[ií]gida/iu);
    expect(prompt).toMatch(/informaci[oó]n del cliente[\s\S]*hecho verificado[\s\S]*utilidad/iu);
    expect(prompt).toMatch(/objeci[oó]n[\s\S]*entiend[ea][\s\S]*personaliza[\s\S]*comprueba/iu);
    expect(prompt).toMatch(/memory_candidates[\s\S]*hechos expresados/iu);
  });

  it('reuses discovery to personalize value, objections and closing without rediagnosing the customer', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/como m[aá]ximo una pregunta principal[^.]*informaci[oó]n comercial [uú]til/iu);
    expect(prompt).toMatch(/objetivo[^.]*motivaci[oó]n[^.]*freno[^.]*recomendaci[oó]n[^.]*valor[^.]*objeci[oó]n[^.]*cierre/iu);
    expect(prompt).toMatch(/no vuelvas a preguntar[^.]*ya (?:dijo|expres[oó]|est[aá])/iu);
    expect(prompt).toMatch(/objeci[oó]n[^.]*ambigua[^.]*a[ií]sla[^.]*una pregunta breve/iu);
    expect(prompt).toMatch(/hecho autorizado[^.]*utilidad personal[^.]*comprueba[^.]*avanza/iu);
    expect(prompt).not.toMatch(/Pregunta el objetivo s[oó]lo para recomendar/iu);
  });

  it('uses calls to complete discovery or persuasion without requiring an exact selected course', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf8');

    expect(prompt).toMatch(/curso exacto[^.]*no es (?:un )?requisito/iu);
    expect(prompt).toMatch(/llamada[^.]*descubrir[^.]*orientar[^.]*convencer/iu);
    expect(prompt).toMatch(/primera duda relevante[^.]*necesidad[^.]*[aá]rea/iu);
    expect(prompt).toMatch(/raz[oó]n concreta[^.]*no reemplaza la respuesta/iu);
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
