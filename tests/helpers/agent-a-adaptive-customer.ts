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
const ASKS_CONTACT_DETAILS = /nombre.{0,40}(?:apellido|correo)|correo electr[oó]nico|tel[eé]fono/iu;
const ASKS_LINK_PERMISSION = /(?:quer[eé]s|dese[aá]s|te gustar[ií]a|te (?:mando|env[ií]o|paso|comparto|preparo)).{0,80}(?:link|enlace)/iu;
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
  if (ASKS_LINK_PERMISSION.test(agent)) {
    return { text: 'Sí, mandame el link de pago', answering: 'autoriza_link' };
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

/** V2 is versioned separately so historical V1 transcripts keep their provenance. */
export function nextAdaptiveCustomerTurnV2(input: {
  readonly profile: AdaptiveCustomerProfileV1;
  readonly lastAgentMessage: string | null;
  readonly turnIndex: number;
  readonly alreadyGaveDetails: boolean;
  readonly alreadySelectedPlan: boolean;
}): AdaptiveTurnV1 {
  const agent = input.lastAgentMessage ?? '';
  if (input.turnIndex === 0 || SENT_LINK.test(agent) || ASKS_LINK_PERMISSION.test(agent)) {
    return nextAdaptiveCustomerTurnV1(input);
  }
  const asksToProceed = /(?:quer[eé]s|dese[aá]s|te gustar[ií]a).{0,80}(?:avan[cz]|continu|inscri|anot|dejarlo\s+(?:listo|registrado))|¿(?:avanzamos|seguimos)\b/iu;
  if (input.alreadySelectedPlan && asksToProceed.test(agent)) {
    return { text: 'Sí, mandame el link de pago para avanzar', answering: 'autoriza_link' };
  }
  const presentedPlans = [
    /\b(?:12|doce)\s+(?:pagos|cuotas)\b/iu,
    /\b(?:6|seis)\s+(?:pagos|cuotas)\b/iu,
    /\bpago\s+[uú]nico\b/iu,
  ].filter(pattern => pattern.test(agent)).length;
  if (presentedPlans >= 2 && /\bUSD\s*\d/iu.test(agent)) {
    return { text: `Me quedo con ${input.profile.planPhrase}`, answering: 'eleccion_de_plan' };
  }
  return nextAdaptiveCustomerTurnV1(input);
}

export interface AdaptivePaymentAuthorizationFailureV2 {
  readonly turnId: string | null;
  readonly reason: 'PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION' | 'PAYMENT_RECORD_WITHOUT_CORRELATED_TURN';
}

/** Customer answering labels are evidence independent of the agent's inferred move/state. */
export function adaptivePaymentAuthorizationFailuresV2(input: {
  readonly turns: readonly {
    readonly answering?: string;
    readonly evidence: { readonly turnId: string | null; readonly authorizedMessages: readonly string[] };
  }[];
  readonly db: {
    readonly outbound: readonly { readonly turnId: string; readonly content: string }[];
    readonly decisions: readonly { readonly turnId: string; readonly businessActionType: string | null }[];
    readonly recordedLinks: readonly string[];
  };
}): AdaptivePaymentAuthorizationFailureV2[] {
  const permissionByTurn = new Map<string | null, boolean>();
  const paymentTurns = new Set<string | null>();
  let permission = false;
  for (const turn of input.turns) {
    if (turn.answering === 'autoriza_link' || turn.answering === 'pide_link') permission = true;
    permissionByTurn.set(turn.evidence.turnId, permission);
    if (turn.evidence.authorizedMessages.some(message => SENT_LINK.test(message))) paymentTurns.add(turn.evidence.turnId);
  }
  for (const outbound of input.db.outbound) {
    if (SENT_LINK.test(outbound.content)) paymentTurns.add(outbound.turnId);
  }
  for (const decision of input.db.decisions) {
    if (decision.businessActionType === 'send_payment_link') paymentTurns.add(decision.turnId);
  }
  const failures: AdaptivePaymentAuthorizationFailureV2[] = [...paymentTurns]
    .filter(turnId => turnId === null || permissionByTurn.get(turnId) !== true)
    .map(turnId => ({ turnId, reason: turnId === null || !permissionByTurn.has(turnId)
      ? 'PAYMENT_RECORD_WITHOUT_CORRELATED_TURN' : 'PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION' }));
  if (input.db.recordedLinks.some(link => !input.db.outbound.some(outbound => outbound.content.includes(link)))) {
    failures.push({ turnId: null, reason: 'PAYMENT_RECORD_WITHOUT_CORRELATED_TURN' });
  }
  return failures;
}
