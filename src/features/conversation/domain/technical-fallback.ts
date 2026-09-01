/**
 * El piso técnico: el único copy visible que el backend puede emitir (A3).
 *
 * No vende, no interpreta y no pide datos. Existe para que un fallo técnico no
 * termine en silencio, que es el defecto medido: 4 de 88 turnos de la línea
 * base desaparecían sin que el cliente recibiera nada.
 *
 * Cubre el silencio TÉCNICO. El silencio deliberado por opt-out o bloqueo se
 * conserva intacto: a quien pidió no ser contactado no se le escribe, ni
 * siquiera para disculparse.
 */

/**
 * Reemplaza a `LAST_RESORT_OPENING` —«Seguimos por acá. Contame cómo puedo
 * ayudarte.»—, que después de un «ya pagué» simulaba conversación y le pedía
 * al cliente que repitiera lo que ya había dicho. Esta no simula: nombra la
 * falla.
 */
export const TECHNICAL_FALLBACK_TEXT_V1 =
  'Recibí tu mensaje, pero tuve una demora para procesarlo. '
  + 'Probá nuevamente en unos segundos.';

/**
 * Segundo fallo consecutivo. Si la causa del rechazo es determinista,
 * reintentar produce el mismo N3 y el cliente entra en un bucle de disculpas
 * técnicas.
 *
 * Sólo puede entregarse DESPUÉS de que el commit de la derivación fue exitoso
 * (O2): afirma un hecho, y afirmarlo sin haberlo escrito sería exactamente el
 * defecto que este trabajo elimina.
 *
 * Dice «registrada» y no nombra a nadie porque no hay bandeja monitoreada. Lo
 * único que ocurre de verdad es que la conversación queda consultable.
 * Prometer atención o respuesta humana sería la misma clase de mentira que la
 * preinscripción cargada, con otra ropa.
 */
export const HUMAN_REVIEW_NOTICE_TEXT_V1 =
  'Sigo teniendo un inconveniente para procesar tu consulta. '
  + 'Dejé registrada la conversación para revisión.';

export interface TechnicalFallbackV1 {
  readonly text: string;
  /** true sólo en el segundo fallo. Exige commit antes de entregar (O2). */
  readonly requests_human_review: boolean;
  readonly next_consecutive_count: 1 | 2;
}

export function resolveTechnicalFallbackV1(input: {
  readonly consecutive_technical_fallbacks: number;
  readonly human_review_already_requested: boolean;
}): TechnicalFallbackV1 {
  if (input.consecutive_technical_fallbacks === 0) {
    return {
      text: TECHNICAL_FALLBACK_TEXT_V1,
      requests_human_review: false,
      next_consecutive_count: 1,
    };
  }
  return {
    text: HUMAN_REVIEW_NOTICE_TEXT_V1,
    // Máximo una derivación activa por conversación.
    requests_human_review: !input.human_review_already_requested,
    // El contador se satura en 2. La columna tiene CHECK (BETWEEN 0 AND 2), y
    // un valor mayor no describiría una conversación con más fallos: sería un
    // error de escritura que rompe la transacción del turno.
    next_consecutive_count: 2,
  };
}
