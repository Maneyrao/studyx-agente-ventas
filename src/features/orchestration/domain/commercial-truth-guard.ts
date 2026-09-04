/**
 * Frontera de verdad comercial.
 *
 * Reemplaza al par `egress-guard` + `canonical-offering-egress`, que
 * autorizaba una afirmación sólo si el modelo reproducía textualmente una
 * oración renderizada por el backend. Eso no verificaba verdad: verificaba
 * redacción, y convertía cualquier parafraseo natural en un fallback técnico.
 *
 * Acá la pregunta es otra: ¿el VALOR que el modelo afirma coincide con el
 * registro canónico? Si coincide, puede decirlo como quiera. Si no coincide,
 * cae esa ORACIÓN, no el turno.
 *
 * La única excepción es la URL: sigue fallando cerrado sobre la respuesta
 * completa, porque una URL no canónica es un canal de cobro, no una frase.
 */

export interface CanonicalTruthSetV1 {
  /** Precios asertables del registro, p. ej. `['USD 360', 'USD 30']`. */
  readonly prices: readonly string[];
  /** Duraciones asertables, p. ej. `['38 clases']`. */
  readonly durations: readonly string[];
  /** Plazos de cuotas mensuales; nunca duraciones académicas. */
  readonly payment_terms?: readonly { readonly months: number; readonly price: string }[];
  /** Modalidad canónica, p. ej. `'100% online'`. `null` si no está informada. */
  readonly modality: string | null;
  /** `null` cuando el registro no informa certificación: no se puede contradecir. */
  readonly certification: boolean | null;
  /** Nombres del catálogo activo, independientes del curso elegido. */
  readonly offering_names?: readonly string[];
  readonly area_names?: readonly string[];
}

export type CommercialTruthViolationCodeV1 =
  | 'UNAUTHORIZED_URL'
  | 'PRICE_NOT_CANONICAL'
  | 'DURATION_NOT_CANONICAL'
  | 'MODALITY_CONTRADICTS_CANONICAL'
  | 'CERTIFICATION_CONTRADICTS_CANONICAL'
  | 'OFFERING_NOT_CANONICAL'
  | 'FORBIDDEN_PROMISE';

export interface CommercialTruthViolationV1 {
  readonly code: CommercialTruthViolationCodeV1;
  readonly value: string;
}

export interface CommercialTruthVerdictV1 {
  /** Texto entregable. `null` sólo si no sobrevivió ninguna oración. */
  readonly content: string | null;
  /** Oraciones removidas, para telemetría. Nunca se le muestran al cliente. */
  readonly removed: readonly string[];
  readonly violations: readonly CommercialTruthViolationV1[];
}

export interface CanonicalOfferingSourceV1 {
  readonly code: string;
  readonly display_name?: string;
  readonly price_type: 'fixed' | 'quote' | 'free';
  readonly price_amount: string | null;
  readonly currency: string | null;
  readonly delivery: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CanonicalPaymentOptionSourceV1 {
  readonly total: { readonly currency: string; readonly amount: string };
  readonly installment_amount?: string | null;
  readonly installments?: number;
  readonly label?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/giu;

const MONEY_PATTERNS = [
  /\b(usd|ars|eur)\s*\$?\s*(\d[\d.,]*)/giu,
  /(\d[\d.,]*)\s*(usd|ars|eur)\b/giu,
] as const;

const DURATION_PATTERN =
  /\b(\d+(?:[.,]\d+)?)\s*(minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|clases?|m[oó]dulos?)\b/giu;

const ONLINE_MODALITY = /\b(?:online|virtual(?:es)?|remot[oa]s?|a distancia|en linea|asincronic[oa]s?)\b/u;
const PRESENTIAL_MODALITY = /\b(?:presencial(?:es)?|en sede|en el campus)\b/u;

const CERTIFICATION_NOUN = /\b(?:certificad[oa]s?|certificacion(?:es)?|diplomas?|titulos?)\b/u;
const NEGATION = /\b(?:no|sin|tampoco)\b/u;

const FORBIDDEN_PROMISE =
  /(?:\bte\s+aseguramos\s+(?:empleo|trabajo)\b|\b(?:empleo|trabajo|salida\s+laboral|resultados?|exito)\s+(?:esta\s+)?(?:garantizad[oa]s?|asegurad[oa]s?)\b|\bsalida\s+laboral\s+garantizada\b|\b100\s*%\s+de\s+empleabilidad\b|\bte\s+devolvemos\s+(?:la\s+)?(?:plata|dinero)\b|\bvas\s+a\s+conseguir\s+trabajo\s+seguro\b)/u;

const COMMERCIAL_BENEFIT = /\b(?:becas?|descuentos?)\b/u;
const DENIED_BENEFIT = /\b(?:no|nunca|tampoco)\s+(?:ofrecemos|ofrece|tenemos|damos|aplicamos|hay|incluye|tenes|tienes|podemos\s+ofrecer)\b[^.;]{0,40}\b(?:becas?|descuentos?)\b|\bsin\s+(?:becas?|descuentos?)\b/u;
const OFFERING_CLAIM = /\b(?:(?:studyx\s+)?(?:ofrece(?:mos)?|tenemos|brinda(?:mos)?|dicta(?:mos)?|contamos\s+con|disponemos\s+de)|studyx\s+tiene|pod[eé]s\s+estudiar|te\s+recomiendo)\s+([^.!?\n]+)/giu;
const GENERIC_CATALOG = /^(?:(?:varias|distintas|muchas|algunas|las|estas|tres)\s+)?(?:opciones|alternativas|areas|formas|planes)\b|^(?:cursos|diplomados)\s*(?:$|disponibles\b)/u;
const OFFERING_DESCRIPTION = /^(?:que|para|con|sin|ideal|donde|porque|si|una\s+opcion|un\s+curso|es|tiene|incluye)\b/u;
const NON_COURSE_OBJECT = /^(?:(?:el|la|un|una|nuestro|nuestra)\s+)?(?:\d+\s+)?(?:pagos?|cuotas?|planes?|chat|soporte|llamadas?|asesoria|acompanamiento|ayuda|informacion|acceso|profesores|clases|certificados?|descuentos?|becas?)\b/u;
const EXPLICIT_COURSE = /^(?:(?:el|un|nuestro)\s+)?(?:curso|diplomado|diplomatura|carrera)\s+(?:de\s+|en\s+)?/u;
const AREA_MEMBERSHIP = /^(?:que\s+)?(?:dentro\s+de|(?:como\s+)?parte\s+de|(?:forma|es)\s+parte\s+de|(?:pertenece|perteneciente)\s+a)\s+(?:(?:la|el|nuestra|nuestro)\s+)?/u;
const OFFERING_LIST_SEPARATOR = /^(?:[,;:]\s*(?:(?:y|e|o)\s+)?|(?:y|e|o)\s+)/u;

function offersUnauthorizedBenefit(sentence: string): boolean {
  // Una negación alcanza su cláusula, nunca una oferta afirmativa posterior.
  return sentence.split(/[,;]|\b(?:pero|aunque|sin embargo)\b|\by\s+(?=(?:te\s+)?(?:damos|ofrecemos|tenemos|aplicamos|hay)\b)/u)
    .some((clause) => COMMERCIAL_BENEFIT.test(clause)
      && !DENIED_BENEFIT.test(clause)
      && !/^\s*ni\b/u.test(clause));
}

/** Compara el nombre ofrecido, dejando libre la descripción que lo acompaña. */
function containsUnknownOffering(sentence: string, names: readonly string[], areas: readonly string[]): boolean {
  const normalized = normalize(sentence);
  const canonicalNames = names.map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  const canonicalAreas = areas.map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const claim of sentence.matchAll(OFFERING_CLAIM)) {
    if (/\b(?:no|nunca|tampoco)\s*$/u.test(normalized.slice(0, claim.index))) continue;
    const namedObject = claim[1]!.trim();
    let remainder = normalize(namedObject);
    if (GENERIC_CATALOG.test(remainder)) continue;
    if (NON_COURSE_OBJECT.test(remainder)) continue;
    const areaClaim = remainder.replace(/^(?:cursos|diplomados)\s+(?:de|en)\s+/u, '');
    if (areaClaim !== remainder && areas.some((area) => normalize(area) === areaClaim)) continue;
    // "Te recomiendo seguir por chat" no identifica un curso. Sin un tipo
    // explícito, el alcance léxico son nombres propios y nombres canónicos.
    // Las acciones y course_reference se validan aparte contra sus códigos.
    if (!EXPLICIT_COURSE.test(remainder)
      && !/^\p{Lu}/u.test(namedObject)
      && !canonicalNames.some((name) => remainder.startsWith(name))
      && areaClaim === remainder) continue;
    if (!canonicalNames.some((name) => remainder.startsWith(name))) {
      remainder = remainder.replace(EXPLICIT_COURSE, '');
    }
    while (remainder.length > 0) {
      const name = canonicalNames.find((candidate) => remainder.startsWith(candidate)
        && !/\p{L}/u.test(remainder.slice(candidate.length, candidate.length + 1)));
      if (!name) return true;
      remainder = remainder.slice(name.length).trim();
      const descriptor = remainder.replace(OFFERING_LIST_SEPARATOR, '');
      const membership = descriptor.match(AREA_MEMBERSHIP);
      if (membership) {
        // El área describe el curso anterior. Consumir sólo ese nombre permite
        // seguir verificando otros cursos que aparezcan después del descriptor.
        const areaObject = descriptor.slice(membership[0].length);
        const area = canonicalAreas.find((candidate) => areaObject.startsWith(candidate)
          && !/\p{L}/u.test(areaObject.slice(candidate.length, candidate.length + 1)));
        if (!area) return true;
        remainder = areaObject.slice(area.length).trim();
        if (remainder.length === 0 || OFFERING_DESCRIPTION.test(remainder)) break;
        const following = remainder.replace(OFFERING_LIST_SEPARATOR, '');
        if (following === remainder) return true;
        remainder = following;
        if (OFFERING_DESCRIPTION.test(remainder)) break;
        continue;
      }
      if (remainder.length === 0 || OFFERING_DESCRIPTION.test(remainder)) break;
      const next = remainder.replace(OFFERING_LIST_SEPARATOR, '');
      if (next === remainder) break;
      remainder = next;
      if (OFFERING_DESCRIPTION.test(remainder)) break;
    }
  }
  return false;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * `USD 360.00` y `USD 360` son el mismo precio. El primer recorte saca la
 * puntuación de cierre de oración, que el patrón de monto se lleva puesta:
 * sin eso `«...cuotas de USD 30.»` se leía como el monto `30.` y un precio
 * perfectamente canónico quedaba vetado.
 */
function canonicalAmount(value: string): string {
  return value
    .replace(/[.,]+$/u, '')
    .replace(/,/gu, '.')
    .replace(/\.0+$/u, '');
}

function extractMoney(text: string): string[] {
  const normalized = normalize(text);
  const found: string[] = [];
  for (const pattern of MONEY_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const [currency, amount] = /^\d/u.test(match[1]!)
        ? [match[2]!, match[1]!]
        : [match[1]!, match[2]!];
      found.push(`${currency} ${canonicalAmount(amount)}`);
    }
  }
  return found;
}

function extractDurations(text: string): string[] {
  return [...normalize(text).matchAll(DURATION_PATTERN)]
    .map((match) => `${canonicalAmount(match[1]!)} ${match[2]!}`);
}

function isCanonicalPaymentDuration(
  sentence: string,
  match: RegExpMatchArray,
  terms: CanonicalTruthSetV1['payment_terms'],
): boolean {
  if (!/^mes(?:es)?$/u.test(match[2]!)) return false;
  const prefix = sentence.slice(0, match.index).split(/;|\b(?:y|pero)\b/u).at(-1) ?? '';
  const subject = [...prefix.matchAll(/\b(?:cuotas?|plan|pagas|paga|pagar|pagos?)\b/gu)].at(-1);
  if (!subject) return false;
  const paymentClause = prefix.slice(subject.index);
  // Un monto cercano no convierte «el curso dura ...» en plazo de cuotas.
  if (/\b(?:curso|programa|formacion|clases|dura|duracion|estudio)\b/u.test(paymentClause)) return false;
  const amounts = extractMoney(paymentClause);
  return (terms ?? []).some((term) => String(term.months) === canonicalAmount(match[1]!)
    && amounts.includes(normalize(term.price)));
}

interface Segment {
  readonly text: string;
  /** Espacio en blanco que seguía a la oración en el original. */
  readonly separator: string;
}

/**
 * Divide en oraciones sin partir un decimal: el delimitador sólo cuenta cuando
 * lo sigue un espacio, así `USD 360.00` queda entero.
 *
 * Cada oración se queda con el separador que la seguía. `processInboundTurn`
 * une `response.messages` con `\n\n`; rearmar todo con un espacio fusionaba
 * dos mensajes distintos en un bloque.
 */
function splitSentences(content: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(?<=[.!?])(\s+)/gu;
  let start = 0;
  for (const match of content.matchAll(pattern)) {
    const text = content.slice(start, match.index);
    if (text.trim().length > 0) segments.push({ text, separator: match[1]! });
    start = match.index + match[0].length;
  }
  const tail = content.slice(start);
  if (tail.trim().length > 0) segments.push({ text: tail, separator: '' });
  return segments;
}

/** Rearma conservando el separador original y sin dejar uno colgando al final. */
function joinSegments(segments: readonly Segment[]): string {
  return segments
    .map((segment, index) => (
      index === segments.length - 1 ? segment.text : segment.text + segment.separator
    ))
    .join('');
}

function modalityGroup(text: string): 'online' | 'presential' | null {
  const normalized = normalize(text);
  if (PRESENTIAL_MODALITY.test(normalized)) return 'presential';
  if (ONLINE_MODALITY.test(normalized)) return 'online';
  return null;
}

function sentenceViolations(
  sentence: string,
  canonical: CanonicalTruthSetV1,
  authorizedPrices: ReadonlySet<string>,
  authorizedDurations: ReadonlySet<string>,
): CommercialTruthViolationV1[] {
  const violations: CommercialTruthViolationV1[] = [];
  const normalized = normalize(sentence);

  for (const price of extractMoney(sentence)) {
    if (!authorizedPrices.has(price)) {
      violations.push({ code: 'PRICE_NOT_CANONICAL', value: price });
    }
  }

  for (const match of normalized.matchAll(DURATION_PATTERN)) {
    const duration = `${canonicalAmount(match[1]!)} ${match[2]!}`;
    if (!authorizedDurations.has(duration)
      && !isCanonicalPaymentDuration(normalized, match, canonical.payment_terms)) {
      violations.push({ code: 'DURATION_NOT_CANONICAL', value: duration });
    }
  }

  const canonicalModality = canonical.modality ? modalityGroup(canonical.modality) : null;
  const claimedModality = modalityGroup(sentence);
  if (canonicalModality && claimedModality && claimedModality !== canonicalModality) {
    violations.push({ code: 'MODALITY_CONTRADICTS_CANONICAL', value: claimedModality });
  }

  // Sólo se puede contradecir un dato que el registro afirma. Con `null` el
  // modelo puede decir que no lo tiene confirmado, que es la verdad.
  if (
    canonical.certification === false
    && CERTIFICATION_NOUN.test(normalized)
    && !NEGATION.test(normalized)
  ) {
    violations.push({ code: 'CERTIFICATION_CONTRADICTS_CANONICAL', value: 'certification' });
  }

  if (FORBIDDEN_PROMISE.test(normalized) || offersUnauthorizedBenefit(normalized)) {
    violations.push({ code: 'FORBIDDEN_PROMISE', value: 'promise' });
  }

  if (containsUnknownOffering(sentence, canonical.offering_names ?? [], canonical.area_names ?? [])) {
    violations.push({ code: 'OFFERING_NOT_CANONICAL', value: 'offering' });
  }

  return violations;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Un único valor compartido por todo el alcance, o `null` si difieren. */
function unanimous<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const [first] = values;
  return values.every((value) => value === first) ? first! : null;
}

/**
 * Con una oferta seleccionada el alcance es esa oferta y nada más: es el turno
 * en el que el precio decide una compra. Sin selección —un turno de
 * exploración— el alcance es el catálogo activo: alcanza con que el valor
 * exista de verdad en alguna oferta publicada.
 */
export function canonicalTruthSetFromOfferingsV1(input: {
  readonly offerings: readonly CanonicalOfferingSourceV1[];
  readonly selected_offering_code: string | null;
  readonly payment_options?: readonly CanonicalPaymentOptionSourceV1[];
}): CanonicalTruthSetV1 {
  const selected = input.selected_offering_code === null
    ? null
    : input.offerings.filter((offering) => offering.code === input.selected_offering_code);
  const scope = selected ?? input.offerings;

  const prices: string[] = [];
  const durations: string[] = [];
  const paymentTerms: { months: number; price: string }[] = [];
  for (const offering of scope) {
    const currency = offering.currency?.trim() ?? '';
    if (offering.price_type === 'fixed' && offering.price_amount && currency.length > 0) {
      prices.push(`${currency} ${canonicalAmount(offering.price_amount)}`);
    }
    const classes = positiveInteger(offering.delivery.classes);
    if (classes !== null) durations.push(`${classes} ${classes === 1 ? 'clase' : 'clases'}`);
    const modules = positiveInteger(offering.delivery.modules);
    if (modules !== null) durations.push(`${modules} ${modules === 1 ? 'módulo' : 'módulos'}`);
    const hours = positiveInteger(offering.delivery.hours_per_month);
    if (hours !== null) durations.push(`${hours} horas por mes`);
  }

  for (const option of input.payment_options ?? []) {
    const currency = option.total.currency.trim();
    if (currency.length === 0) continue;
    prices.push(`${currency} ${canonicalAmount(option.total.amount)}`);
    if (option.installment_amount) {
      prices.push(`${currency} ${canonicalAmount(option.installment_amount)}`);
      const months = positiveInteger(option.installments);
      if (months !== null && months > 1 && /\bmensuales?\b/iu.test(option.label ?? '')) {
        paymentTerms.push({ months, price: `${currency} ${canonicalAmount(option.installment_amount)}` });
      }
    }
  }

  const modalities = scope
    .map((offering) => offering.delivery.modality)
    .filter((modality): modality is string => typeof modality === 'string' && modality.trim() !== '')
    .map((modality) => modality.trim());
  const certifications = scope
    .map((offering) => offering.delivery.certification)
    .filter((certification): certification is boolean => typeof certification === 'boolean');

  return {
    offering_names: input.offerings.flatMap((offering) => offering.display_name ? [offering.display_name] : []),
    area_names: [...new Set(input.offerings.flatMap((offering) => (
      typeof offering.metadata?.academy === 'string' ? [offering.metadata.academy] : []
    )))],
    prices: [...new Set(prices)],
    durations: [...new Set(durations)],
    payment_terms: paymentTerms,
    // Con modalidades distintas en el alcance no hay una sola verdad que
    // contradecir: el guard no puede vetar sin saber de qué curso se habla.
    modality: modalities.length === scope.length ? unanimous(modalities) : null,
    certification: certifications.length === scope.length ? unanimous(certifications) : null,
  };
}

export function enforceCommercialTruthV1(input: {
  readonly content: string;
  readonly authorized_urls: readonly string[];
  readonly canonical: CanonicalTruthSetV1;
}): CommercialTruthVerdictV1 {
  // La URL es la única frontera que sigue siendo del turno completo: entregar
  // el resto de un mensaje que además incluía un cobro falso sería peor que
  // callarse.
  const authorizedUrls = new Set(input.authorized_urls);
  const unauthorizedUrls = [...input.content.matchAll(URL_PATTERN)]
    .map((match) => match[0].replace(/[.,!?;:]+$/u, ''))
    .filter((url) => !authorizedUrls.has(url));
  if (unauthorizedUrls.length > 0) {
    return {
      content: null,
      removed: [input.content],
      violations: unauthorizedUrls.map((url) => ({ code: 'UNAUTHORIZED_URL' as const, value: url })),
    };
  }

  const authorizedPrices = new Set(input.canonical.prices.flatMap(extractMoney));
  const authorizedDurations = new Set(input.canonical.durations.flatMap(extractDurations));

  const kept: Segment[] = [];
  const removed: string[] = [];
  const violations: CommercialTruthViolationV1[] = [];

  for (const segment of splitSentences(input.content)) {
    const sentenceFailures = sentenceViolations(
      segment.text,
      input.canonical,
      authorizedPrices,
      authorizedDurations,
    );
    if (sentenceFailures.length === 0) {
      kept.push(segment);
      continue;
    }
    removed.push(segment.text);
    violations.push(...sentenceFailures);
  }

  return {
    content: kept.length > 0 ? joinSegments(kept) : null,
    removed,
    violations,
  };
}
