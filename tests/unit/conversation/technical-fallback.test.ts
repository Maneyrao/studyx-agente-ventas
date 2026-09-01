import { describe, expect, it } from 'vitest';
import {
  HUMAN_REVIEW_NOTICE_TEXT_V1,
  TECHNICAL_FALLBACK_TEXT_V1,
  resolveTechnicalFallbackV1,
} from '@/features/conversation/domain/technical-fallback';
import { unsupportedOperationalAssertionsV1 } from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';

const resolve = (count: number, already = false) => resolveTechnicalFallbackV1({
  consecutive_technical_fallbacks: count,
  human_review_already_requested: already,
});

describe('N3 y la derivación', () => {
  it('usa el texto técnico aprobado, palabra por palabra', () => {
    expect(TECHNICAL_FALLBACK_TEXT_V1).toBe(
      'Recibí tu mensaje, pero tuve una demora para procesarlo. '
      + 'Probá nuevamente en unos segundos.',
    );
  });

  it('usa el aviso de derivación aprobado, palabra por palabra', () => {
    // Texto alternativo: no existe bandeja monitoreada, y «marcada para
    // revisión del equipo» insinúa que hay alguien mirando.
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).toBe(
      'Sigo teniendo un inconveniente para procesar tu consulta. '
      + 'Dejé registrada la conversación para revisión.',
    );
  });

  it('no nombra un equipo ni sugiere que alguien esté mirando', () => {
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).not.toMatch(/\bequipo|\bpersona|\basesor|\balguien/iu);
  });

  it('el primer fallo entrega N3 y no deriva', () => {
    expect(resolve(0)).toEqual({
      text: TECHNICAL_FALLBACK_TEXT_V1,
      requests_human_review: false,
      next_consecutive_count: 1,
    });
  });

  it('el segundo fallo consecutivo deriva en vez de repetir N3', () => {
    expect(resolve(1)).toEqual({
      text: HUMAN_REVIEW_NOTICE_TEXT_V1,
      requests_human_review: true,
      next_consecutive_count: 2,
    });
  });

  it('no hay un tercer fallback: con la derivación activa, no vuelve a derivar', () => {
    // Máximo una derivación activa por conversación. El cliente sigue viendo
    // un turno visible, pero el equipo no recibe una segunda marca.
    const third = resolve(2, true);
    expect(third.requests_human_review).toBe(false);
    expect(third.text).toBe(HUMAN_REVIEW_NOTICE_TEXT_V1);
    expect(third.next_consecutive_count).toBe(2);
  });

  // Q2: N3 es exclusivamente técnico.
  it('ninguno de los dos textos vende, interpreta ni pide datos', () => {
    for (const text of [TECHNICAL_FALLBACK_TEXT_V1, HUMAN_REVIEW_NOTICE_TEXT_V1]) {
      expect(text).not.toMatch(/\b(?:curso|precio|USD|plan|pago|llamada)\b/iu);
      expect(text).not.toMatch(/\?/u);
      expect(text).not.toMatch(/contame|decime|cont[áa]/iu);
    }
  });

  it('el aviso no promete atención inmediata ni transferencia en vivo', () => {
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).not.toMatch(
      /\b(?:ahora|enseguida|de\s+inmediato|te\s+contact|te\s+llam|te\s+comunic|transfier|a\s+la\s+brevedad)/iu,
    );
  });

  // A9 · V5: el propio piso del backend tiene que sobrevivir a su guard.
  it('ambos textos pasan V5 con el estado más pobre posible', () => {
    const nada = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const text of [TECHNICAL_FALLBACK_TEXT_V1, HUMAN_REVIEW_NOTICE_TEXT_V1]) {
      expect(unsupportedOperationalAssertionsV1(text, nada)).toEqual([]);
    }
  });

  it('el contador nunca supera el tope que acepta la base', () => {
    // La columna tiene CHECK (BETWEEN 0 AND 2). Un valor mayor sería un
    // error de escritura, no una conversación con muchos fallos.
    for (const count of [0, 1, 2, 5, 99]) {
      expect(resolve(count, true).next_consecutive_count).toBeLessThanOrEqual(2);
    }
  });
});
