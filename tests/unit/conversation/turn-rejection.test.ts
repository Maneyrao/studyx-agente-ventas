import { describe, expect, it } from 'vitest';
import {
  TURN_REJECTION_CODES_V1,
  buildTurnRejectionV1,
  isPrunableRejectionV1,
  isStructuredRejectionSubjectV1,
} from '@/features/conversation/domain/turn-rejection';

const alternatives = {
  fact_ids: ['offering:redes-informaticas:name:v1'],
  actions: [] as string[],
  missing_information: ['course_selection'],
};

describe('TurnRejectionV1', () => {
  it('expone los ocho códigos de la especificación', () => {
    expect([...TURN_REJECTION_CODES_V1].sort()).toEqual([
      'ACTION_NOT_AUTHORIZED',
      'CALL_BUDGET_EXHAUSTED',
      'COURSE_NOT_RESOLVED',
      'FACT_NOT_AUTHORIZED',
      'FACT_VALUE_MISMATCH',
      'MISSING_INTAKE',
      'PLAN_NOT_SELECTED',
      'UNSUPPORTED_OPERATIONAL_CLAIM',
    ]);
  });

  it('attempt es siempre 1: no hay segundo reintento', () => {
    expect(buildTurnRejectionV1({
      rejection_id: 'r1',
      rejections: [{ code: 'COURSE_NOT_RESOLVED', subject: 'course_selection' }],
      authorized_alternatives: alternatives,
    }).attempt).toBe(1);
  });

  // A4: el backend devuelve códigos, no instrucciones de redacción.
  it('rechaza un sujeto en prosa', () => {
    expect(() => buildTurnRejectionV1({
      rejection_id: 'r1',
      rejections: [{
        code: 'COURSE_NOT_RESOLVED',
        subject: 'pedile que elija un curso primero',
      }],
      authorized_alternatives: alternatives,
    })).toThrow(/TURN_REJECTION_SUBJECT_NOT_STRUCTURED/u);
  });

  it('acepta identificadores canónicos', () => {
    for (const subject of [
      'payment:barista:monthly_6:price:v1',
      'offering:redes-informaticas:name:v1',
      'state:intake_recorded:v1',
      'course_selection',
    ]) {
      expect(isStructuredRejectionSubjectV1(subject)).toBe(true);
    }
  });

  it('ningún sujeto con espacios pasa: la prosa lleva espacios', () => {
    expect(isStructuredRejectionSubjectV1('el precio está mal')).toBe(false);
    expect(isStructuredRejectionSubjectV1('')).toBe(false);
  });

  it('una acción inválida nunca se resuelve con poda parcial', () => {
    // No hay oración parcial que vuelva válida una acción no autorizada.
    for (const code of [
      'ACTION_NOT_AUTHORIZED',
      'CALL_BUDGET_EXHAUSTED',
      'MISSING_INTAKE',
    ] as const) {
      expect(isPrunableRejectionV1(buildTurnRejectionV1({
        rejection_id: 'r1',
        rejections: [{ code, subject: 'send_payment_link' }],
        authorized_alternatives: alternatives,
      }))).toBe(false);
    }
  });

  it('un rechazo de hecho sí es podable', () => {
    // Quitar la oración que cita el hecho inválido puede dejar un turno que
    // sigue contestando.
    expect(isPrunableRejectionV1(buildTurnRejectionV1({
      rejection_id: 'r1',
      rejections: [{ code: 'FACT_NOT_AUTHORIZED', subject: 'payment:x:monthly_6:price:v1' }],
      authorized_alternatives: alternatives,
    }))).toBe(true);
  });

  it('las alternativas autorizadas viajan como listas, no como texto', () => {
    const rejection = buildTurnRejectionV1({
      rejection_id: 'r1',
      rejections: [{ code: 'COURSE_NOT_RESOLVED', subject: 'course_selection' }],
      authorized_alternatives: alternatives,
    });
    expect(Array.isArray(rejection.authorized_alternatives.fact_ids)).toBe(true);
    expect(Array.isArray(rejection.authorized_alternatives.actions)).toBe(true);
    expect(Array.isArray(rejection.authorized_alternatives.missing_information)).toBe(true);
  });
});
