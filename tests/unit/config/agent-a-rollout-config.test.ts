import { describe, expect, it } from 'vitest';
import { loadAgentARolloutConfig } from '@/lib/config';

describe('flags de rollout del Agente A', () => {
  it('los tres apagados por defecto', () => {
    // R1: nada se enciende en el mismo commit que lo introduce.
    expect(loadAgentARolloutConfig({})).toEqual({
      contextScoping: false,
      repairEnabled: false,
      singleRoute: false,
    });
  });

  it('sólo "true" enciende', () => {
    for (const value of ['false', 'TRUE ', '1', 'yes', '']) {
      const config = loadAgentARolloutConfig({
        AGENT_A_CONTEXT_SCOPING: value,
        AGENT_A_REPAIR_ENABLED: value,
        AGENT_A_SINGLE_ROUTE: value,
      });
      const expected = value.trim().toLowerCase() === 'true';
      expect(config.contextScoping).toBe(expected);
      expect(config.repairEnabled).toBe(expected);
      expect(config.singleRoute).toBe(expected);
    }
  });

  it('los flags son independientes', () => {
    // El recorte puede medirse sin encender la reparación, que es exactamente
    // el orden de las fases 1 y 2.
    expect(loadAgentARolloutConfig({ AGENT_A_CONTEXT_SCOPING: 'true' })).toEqual({
      contextScoping: true,
      repairEnabled: false,
      singleRoute: false,
    });
  });

  it('la ruta única se desactiva por flag, y el código de rollback sigue ahí', () => {
    // R6: el rollback se conserva hasta que el held-out y el canary estén
    // verdes. El flag apaga la ruta duplicada; no la borra.
    expect(loadAgentARolloutConfig({ AGENT_A_SINGLE_ROUTE: 'true' }).singleRoute).toBe(true);
  });
});
