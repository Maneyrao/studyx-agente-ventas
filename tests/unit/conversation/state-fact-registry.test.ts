import { describe, expect, it } from 'vitest';
import type { ContactIntakeV1 } from '@/features/conversation/domain/conversation-planner';
import {
  STATE_FACT_IDS_V1,
  materializeStateFactsV1,
} from '@/features/conversation/domain/state-fact-registry';

const completeIntake: ContactIntakeV1 = {
  nombre: 'Ana',
  apellido: 'Pérez',
  correo: 'ana@example.com',
  telefono: '+15551234567',
};

describe('registro de hechos de estado y proceso', () => {
  it('expone exactamente los cuatro hechos decididos, ni uno más', () => {
    // Q6: cuatro hechos, ninguno más. Un quinto hecho es una ampliación del
    // contrato de autoridad, no un detalle de implementación.
    expect([...STATE_FACT_IDS_V1].sort()).toEqual([
      'process:access_after_verification:v1',
      'process:human_verification:v1',
      'state:intake_recorded:v1',
      'state:payment_reported:v1',
    ]);
  });

  it('materializa intake_recorded sólo con los cuatro campos presentes', () => {
    expect(materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: false,
    })).toContain('state:intake_recorded:v1');
  });

  it('no materializa intake_recorded si falta un campo', () => {
    for (const field of ['nombre', 'apellido', 'correo', 'telefono'] as const) {
      const partial: ContactIntakeV1 = { ...completeIntake, [field]: '   ' };
      expect(materializeStateFactsV1({
        intake: partial,
        planned_payment_reported: false,
      })).not.toContain('state:intake_recorded:v1');
    }
  });

  it('no materializa intake_recorded si un campo es nulo', () => {
    const partial: ContactIntakeV1 = { ...completeIntake, correo: null };
    expect(materializeStateFactsV1({
      intake: partial,
      planned_payment_reported: false,
    })).not.toContain('state:intake_recorded:v1');
  });

  it('no materializa intake_recorded sin intake', () => {
    expect(materializeStateFactsV1({
      intake: undefined,
      planned_payment_reported: false,
    })).not.toContain('state:intake_recorded:v1');
  });

  // O1: el hecho se materializa desde la transición que el turno VA a
  // escribir. Es lo que permite responder "Registré tus datos" en el mismo
  // turno en que el cliente los entrega, en vez de en el siguiente.
  it('materializa payment_reported desde la transición planificada', () => {
    expect(materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: true,
    })).toContain('state:payment_reported:v1');

    expect(materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: false,
    })).not.toContain('state:payment_reported:v1');
  });

  it('los hechos de proceso son canónicos y siempre están disponibles', () => {
    // Describen lo que hace el equipo humano, no lo que hizo el agente: no
    // hay estado que pueda volverlos falsos.
    const empty = materializeStateFactsV1({
      intake: undefined,
      planned_payment_reported: false,
    });
    expect(empty).toContain('process:human_verification:v1');
    expect(empty).toContain('process:access_after_verification:v1');
  });

  it('no materializa ningún hecho fuera del vocabulario', () => {
    // El conjunto devuelto es la autorización de V5. Un hecho de más acá es
    // una afirmación que el guard va a dejar pasar sin respaldo.
    const todo = materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: true,
    });
    for (const fact of todo) {
      expect(STATE_FACT_IDS_V1).toContain(fact);
    }
    expect(todo.size).toBe(4);
  });
});
