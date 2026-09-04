/**
 * Cliente simulado que contesta lo que el agente realmente pregunta.
 *
 * Un guion fijo mide al agente contra una conversación que no existe: la
 * persona dice su siguiente línea aunque el agente haya preguntado otra cosa,
 * y así una pregunta ignorada nunca se nota. Este responde al último mensaje
 * del agente.
 *
 * Es determinístico y por reglas a propósito. Usar un segundo modelo para
 * hacer de cliente costaría tanto como el agente, agregaría su propia varianza
 * y volvería irreproducible cada corrida. Acá el costo extra es cero: los
 * únicos tokens que se pagan son los del agente.
 *
 * Sabe poco y se le nota: responde intención, canal, plan, datos y pago. Si no
 * reconoce la pregunta, insiste con lo que quería, que es lo que hace una
 * persona real cuando no le contestaron.
 */
export interface AdaptiveCustomerProfileV1 {
  readonly course: string;
  readonly fullName: string;
  readonly email: string;
  readonly declaredPhone: string;
  /** Plan que elige cuando le ofrecen opciones, escrito en letras. */
  readonly planPhrase: string;
  readonly acceptsCall: boolean;
}

export interface AdaptiveTurnV1 {
  readonly text: string;
  /** Qué se creyó que el agente estaba pidiendo. Sirve para auditar. */
  readonly answering: string;
}

const ASKS_PRIOR_KNOWLEDGE = /conocimientos previos|desde cero|ya ten[ií]as pensado|empezando a averiguar/iu;
const ASKS_CALL_OR_CHAT = /llamada|llamarte|te llamo|prefer[ií]s.{0,24}chat/iu;
const ASKS_PLAN = /cu[aá]l de las tres|opciones de pago|qu[eé] opci[oó]n|te resulta m[aá]s c[oó]moda|cu[aá]l preferís/iu;
const ASKS_CONTACT_DETAILS = /nombre.{0,40}(?:apellido|correo)|correo electr[oó]nico|tel[eé]fono|dejarlo registrado/iu;
const ASKS_WHICH_COURSE = /qu[eé] (?:curso|formaci[oó]n|te interesa)|cu[aá]l te interesa|[aá]rea/iu;
const SENT_LINK = /https?:\/\//u;

export function nextAdaptiveCustomerTurnV1(input: {
  readonly profile: AdaptiveCustomerProfileV1;
  readonly lastAgentMessage: string | null;
  readonly turnIndex: number;
  readonly alreadyGaveDetails: boolean;
}): AdaptiveTurnV1 {
  const { profile } = input;
  const agent = input.lastAgentMessage ?? '';

  if (input.turnIndex === 0) {
    return { text: `Hola, me interesa ${profile.course}`, answering: 'apertura' };
  }
  if (SENT_LINK.test(agent)) {
    return { text: 'Listo, ya hice el pago', answering: 'link_recibido' };
  }
  if (ASKS_CONTACT_DETAILS.test(agent) && !input.alreadyGaveDetails) {
    return {
      text: `Soy ${profile.fullName}, ${profile.email}, mi teléfono es ${profile.declaredPhone}`,
      answering: 'datos_de_contacto',
    };
  }
  if (ASKS_PLAN.test(agent)) {
    return { text: `Me quedo con ${profile.planPhrase}`, answering: 'eleccion_de_plan' };
  }
  if (ASKS_CALL_OR_CHAT.test(agent)) {
    return profile.acceptsCall
      ? { text: 'Dale, llamame', answering: 'acepta_llamada' }
      : { text: 'Prefiero no hablar por teléfono, sigamos por acá', answering: 'rechaza_llamada' };
  }
  if (ASKS_PRIOR_KNOWLEDGE.test(agent)) {
    return { text: 'Recién estoy averiguando, no sé nada del tema', answering: 'nivel_previo' };
  }
  if (ASKS_WHICH_COURSE.test(agent)) {
    return { text: `Me interesa ${profile.course}`, answering: 'eleccion_de_curso' };
  }
  // El agente no preguntó nada accionable: la persona avanza sola, como haría
  // cualquiera que ya sabe qué quiere.
  if (input.alreadyGaveDetails) {
    return { text: 'Perfecto, mandame el link entonces', answering: 'pide_link' };
  }
  return { text: '¿Y cuánto sale?', answering: 'pregunta_precio' };
}
