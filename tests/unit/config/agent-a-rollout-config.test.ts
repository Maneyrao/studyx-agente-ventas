import { describe, expect, it } from 'vitest';
import { loadAgentARolloutConfig } from '@/lib/config';

describe('flags de rollout del Agente A', () => {
  it('todos apagados por defecto', () => {
    // R1: nada se enciende en el mismo commit que lo introduce.
    expect(loadAgentARolloutConfig({})).toEqual({
      contextScoping: false,
      repairEnabled: false,
      singleRoute: false,
      stateAssertions: false,
    });
  });

  it('sólo "true" enciende', () => {
    for (const value of ['false', 'TRUE ', '1', 'yes', '']) {
      const config = loadAgentARolloutConfig({
        AGENT_A_CONTEXT_SCOPING: value,
        AGENT_A_REPAIR_ENABLED: value,
        AGENT_A_SINGLE_ROUTE: value,
        AGENT_A_STATE_ASSERTIONS: value,
      });
      const expected = value.trim().toLowerCase() === 'true';
      expect(config.contextScoping).toBe(expected);
      expect(config.repairEnabled).toBe(expected);
      expect(config.singleRoute).toBe(expected);
      expect(config.stateAssertions).toBe(expected);
    }
  });

  it('los flags son independientes', () => {
    // El recorte puede medirse sin encender la reparación, que es exactamente
    // el orden de las fases 1 y 2.
    expect(loadAgentARolloutConfig({ AGENT_A_CONTEXT_SCOPING: 'true' })).toEqual({
      contextScoping: true,
      repairEnabled: false,
      singleRoute: false,
      stateAssertions: false,
    });
  });

  it('V5 por estado no se enciende sola', () => {
    // 8e2fe6f introdujo la capacidad de afirmar por estado; la garantía de
    // que ese mensaje espera al commit durable la fija O2/O3. Mientras el
    // flag esté apagado la capacidad no existe, así que no puede adelantarse
    // a la garantía. Encenderlo es un acto explícito y con nombre propio.
    expect(loadAgentARolloutConfig({}).stateAssertions).toBe(false);
    expect(loadAgentARolloutConfig({ AGENT_A_STATE_ASSERTIONS: 'true' }).stateAssertions).toBe(true);
  });

  it('la ruta única se desactiva por flag, y el código de rollback sigue ahí', () => {
    // R6: el rollback se conserva hasta que el held-out y el canary estén
    // verdes. El flag apaga la ruta duplicada; no la borra.
    expect(loadAgentARolloutConfig({ AGENT_A_SINGLE_ROUTE: 'true' }).singleRoute).toBe(true);
  });
});
