/**
 * `TurnRejectionV1` — el backend rechaza sin redactar (A4).
 *
 * Cuando la validación rechaza una propuesta, el turno no termina: se le
 * devuelve al modelo un motivo estructurado y una única oportunidad de
 * reescribir. Lo que viaja son identificadores, códigos y listas.
 *
 * La regla que hace que esto no viole A3: el backend no dice «pedile que elija
 * un curso». Dice `COURSE_NOT_RESOLVED` y entrega los `fact_id` disponibles.
 * Cómo se dice sigue siendo de DeepSeek. Una sola frase en prosa acá
 * convertiría al modelo en un compositor de texto ajeno, que es exactamente la
 * arquitectura que este trabajo abandona.
 */

export const TURN_REJECTION_CODES_V1 = [
  /** Citó un hecho que el turno no materializó. */
  'FACT_NOT_AUTHORIZED',
  /** Afirmó un valor distinto al canónico. */
  'FACT_VALUE_MISMATCH',
  /** Pidió una acción sin su precondición. */
  'ACTION_NOT_AUTHORIZED',
  /** Faltan datos del intake de cuatro campos. */
  'MISSING_INTAKE',
  /** Tercera oferta de llamada. */
  'CALL_BUDGET_EXHAUSTED',
  /** Afirmó alta, acceso, inscripción o pago verificado sin respaldo. */
  'UNSUPPORTED_OPERATIONAL_CLAIM',
  'PLAN_NOT_SELECTED',
  'COURSE_NOT_RESOLVED',
] as const;

export type TurnRejectionCodeV1 = typeof TURN_REJECTION_CODES_V1[number];

export interface TurnRejectionReasonV1 {
  readonly code: TurnRejectionCodeV1;
  /**
   * Identificador o código. NUNCA una frase para el cliente.
   * `payment:barista:monthly_6:price:v1`, no «el precio que dijiste está mal».
   */
  readonly subject: string;
}

export interface TurnRejectionV1 {
  readonly schema_version: 1;
  readonly rejection_id: string;
  /** Siempre 1. No hay segundo reintento (A5). */
  readonly attempt: 1;
  readonly rejections: readonly TurnRejectionReasonV1[];
  readonly authorized_alternatives: {
    /** Lo que SÍ puede citar ahora. */
    readonly fact_ids: readonly string[];
    /** Lo que SÍ puede pedir ahora. */
    readonly actions: readonly string[];
    readonly missing_information: readonly string[];
  };
}

/** Un sujeto válido es un identificador, no prosa. */
const IDENTIFIER = /^[a-z0-9_:.\-]+$/iu;

export function isStructuredRejectionSubjectV1(subject: string): boolean {
  return IDENTIFIER.test(subject) && subject.trim().length > 0;
}

export function buildTurnRejectionV1(input: {
  readonly rejection_id: string;
  readonly rejections: readonly TurnRejectionReasonV1[];
  readonly authorized_alternatives: TurnRejectionV1['authorized_alternatives'];
}): TurnRejectionV1 {
  for (const reason of input.rejections) {
    if (!isStructuredRejectionSubjectV1(reason.subject)) {
      // Un sujeto en prosa sería el backend redactando por la ventana de
      // atrás. Es un error de programación, no una entrada del modelo.
      throw new Error(`TURN_REJECTION_SUBJECT_NOT_STRUCTURED:${reason.code}`);
    }
  }
  return {
    schema_version: 1,
    rejection_id: input.rejection_id,
    attempt: 1,
    rejections: input.rejections,
    authorized_alternatives: input.authorized_alternatives,
  };
}

/**
 * Un rechazo de acción nunca es podable: no hay oración que quitar que vuelva
 * válida una acción no autorizada. Va directo a N2 (§ 07).
 */
export function isPrunableRejectionV1(rejection: TurnRejectionV1): boolean {
  return !rejection.rejections.some((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED'
    || reason.code === 'CALL_BUDGET_EXHAUSTED'
    || reason.code === 'MISSING_INTAKE'
  ));
}
