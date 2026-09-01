import {
  missingContactIntakeFieldsV1,
  type ContactIntakeV1,
} from './conversation-planner';

/**
 * Vocabulario de hechos de estado y de proceso (§ 05b).
 *
 * El sistema ya autoriza los hechos comerciales por cita: el modelo nombra un
 * `fact_id` y el backend verifica que ese hecho se haya materializado para el
 * turno. Esto extiende el mismo mecanismo a las afirmaciones sobre el estado
 * de la gestión — "registré tus datos", "el equipo lo revisará".
 *
 * La alternativa fácil era una lista blanca de frases aprobadas, y habría
 * sido un error: la misma oración es verdadera si los datos están registrados
 * y falsa si no. Una lista blanca no distingue esos dos casos, así que
 * autorizaría igual una promesa vacía.
 *
 * Son cuatro y ninguno más. Agregar un quinto amplía la frontera de autoridad
 * del Agente A, que es una decisión de arquitectura y no un detalle.
 */
export type StateFactIdV1 =
  | 'state:intake_recorded:v1'
  | 'state:payment_reported:v1'
  | 'process:human_verification:v1'
  | 'process:access_after_verification:v1';

export const STATE_FACT_IDS_V1: readonly StateFactIdV1[] = [
  'state:intake_recorded:v1',
  'state:payment_reported:v1',
  'process:human_verification:v1',
  'process:access_after_verification:v1',
];

/**
 * Los dos hechos de proceso describen lo que el equipo humano hace después de
 * la conversación, no lo que hizo el agente. Ningún estado los vuelve falsos,
 * así que no se materializan condicionalmente: están.
 */
const CANONICAL_PROCESS_FACTS: readonly StateFactIdV1[] = [
  'process:human_verification:v1',
  'process:access_after_verification:v1',
];

export interface StateFactSubjectV1 {
  readonly intake: ContactIntakeV1 | undefined;
  /**
   * La transición que este turno VA a escribir, no la ya persistida (O1).
   *
   * Es lo que permite que el cliente diga "ya pagué" y reciba la confirmación
   * en ese mismo turno en vez de en el siguiente. La contrapartida es O2: el
   * outbound sólo se entrega si el commit durable fue exitoso. Sin esa
   * segunda mitad, esto se convierte en una mentira respaldada por una cita,
   * que es peor que el defecto que elimina.
   */
  readonly planned_payment_reported: boolean;
}

/**
 * Qué puede afirmar este turno sobre el estado de la gestión.
 *
 * El conjunto devuelto es la autorización de V5: una oración que afirme un
 * estado y cuyo hecho no esté acá se rechaza con
 * `UNSUPPORTED_OPERATIONAL_CLAIM`.
 *
 * Es más estricto que el detector léxico que reemplaza en esa función. Hoy
 * "Registré tus datos" pasa aunque no se haya registrado nada, porque no
 * contiene ningún sustantivo operativo que el detector reconozca.
 */
export function materializeStateFactsV1(
  subject: StateFactSubjectV1,
): ReadonlySet<StateFactIdV1> {
  const facts = new Set<StateFactIdV1>(CANONICAL_PROCESS_FACTS);
  if (missingContactIntakeFieldsV1(subject.intake).length === 0) {
    facts.add('state:intake_recorded:v1');
  }
  if (subject.planned_payment_reported) {
    facts.add('state:payment_reported:v1');
  }
  return facts;
}
