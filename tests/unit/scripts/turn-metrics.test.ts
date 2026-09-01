import { describe, expect, it } from 'vitest';
import {
  summarizeRunMetricsV1,
  type TurnMetricsV1,
} from '../../../scripts/lib/agent-a-conversation-runner';

function turn(overrides: Partial<TurnMetricsV1> = {}): TurnMetricsV1 {
  return {
    case_id: 'base_01',
    turn_index: 0,
    visible_message_count: 1,
    silent: false,
    opted_out: false,
    technical_fallback: false,
    technical_fallback_reason: null,
    human_review_requested: false,
    repair_attempted: false,
    repaired: false,
    latency_ms: 1_000,
    false_operational_promises: [],
    visible_call_offers: 0,
    ledger_entries: 0,
    ...overrides,
  };
}

describe('métricas por turno', () => {
  // Un caso que falla por un turno dejaba de contar los otros cuatro. La
  // varianza 18/15/16 sobre el MISMO commit venía en parte de eso.
  it('cuenta cada turno, no cada caso', () => {
    const metrics = summarizeRunMetricsV1([
      turn({ turn_index: 0 }),
      turn({ turn_index: 1, visible_message_count: 0, silent: true }),
    ]);
    expect(metrics.turns).toHaveLength(2);
  });

  // D1: la condición central. Que el cliente reciba algo no es que el agente
  // haya contestado. Si N3 contara como éxito, este trabajo se "mediría" como
  // una mejora de 4 casos por el solo hecho de romper el silencio.
  it('un turno con N3 no cuenta como silencio, pero tampoco como éxito', () => {
    const metrics = summarizeRunMetricsV1([
      turn({ technical_fallback: true, technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn(),
    ]);
    expect(metrics.turns.filter((entry) => entry.silent)).toHaveLength(0);
    expect(metrics.technical_fallback_count).toBe(1);
    expect(metrics.conversational_success_rate).toBe(0.5);
  });

  it('agrupa los fallbacks por motivo', () => {
    const metrics = summarizeRunMetricsV1([
      turn({ technical_fallback: true, technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn({ technical_fallback: true, technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn({
        technical_fallback: true,
        technical_fallback_reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED',
      }),
    ]);
    expect(metrics.technical_fallback_by_reason.BRAIN_UNAVAILABLE).toBe(2);
    expect(metrics.technical_fallback_by_reason.EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED)
      .toBe(1);
  });

  it('cuenta las derivaciones a revisión', () => {
    const metrics = summarizeRunMetricsV1([
      turn({ technical_fallback: true, human_review_requested: false }),
      turn({ technical_fallback: true, human_review_requested: true }),
    ]);
    expect(metrics.human_review_count).toBe(1);
  });

  it('la reparación exitosa se calcula sobre los turnos que llegaron a N2', () => {
    // Denominador `repair_attempted`, no turnos totales: un turno que nunca
    // necesitó reparación no dice nada sobre si la reparación funciona.
    const metrics = summarizeRunMetricsV1([
      turn({ repair_attempted: true, repaired: true }),
      turn({ repair_attempted: true, repaired: false }),
      turn({ repair_attempted: false }),
    ]);
    expect(metrics.repair_rate).toBeCloseTo(2 / 3);
    expect(metrics.repair_success_rate).toBe(0.5);
  });

  it('un silencio por opt-out no cuenta como silencio accidental', () => {
    // "Cero silencios" significa cero silencios ACCIDENTALES en turnos
    // elegibles. Callar ante quien pidió no ser contactado es correcto.
    const metrics = summarizeRunMetricsV1([
      turn({ visible_message_count: 0, silent: true, opted_out: true }),
      turn({ visible_message_count: 0, silent: true, opted_out: false }),
    ]);
    expect(metrics.accidental_silence_count).toBe(1);
  });

  it('el turno de opt-out sale del denominador de éxito', () => {
    // Turno elegible: excluye opt-out y bloqueados. Contarlos como fracaso
    // castigaría al sistema por hacer lo correcto.
    const metrics = summarizeRunMetricsV1([
      turn({ visible_message_count: 0, silent: true, opted_out: true }),
      turn(),
    ]);
    expect(metrics.eligible_turns).toBe(1);
    expect(metrics.conversational_success_rate).toBe(1);
  });

  it('p50 y p95 se calculan sobre turnos visibles', () => {
    const metrics = summarizeRunMetricsV1(
      [100, 200, 300, 400, 500].map((latency_ms, turn_index) => turn({ latency_ms, turn_index })),
    );
    expect(metrics.p50_ms).toBe(300);
    expect(metrics.p95_ms).toBe(500);
  });

  it('reporta las promesas operativas falsas que llegaron a entregarse', () => {
    const metrics = summarizeRunMetricsV1([
      turn({ false_operational_promises: ['Tu inscripción quedó confirmada.'] }),
      turn(),
    ]);
    expect(metrics.false_promise_count).toBe(1);
  });

  it('una corrida sin turnos no divide por cero', () => {
    const metrics = summarizeRunMetricsV1([]);
    expect(metrics.conversational_success_rate).toBe(0);
    expect(metrics.repair_success_rate).toBe(0);
    expect(metrics.p95_ms).toBeNull();
  });
});
