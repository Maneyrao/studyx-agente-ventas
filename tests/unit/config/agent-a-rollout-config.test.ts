import { describe, expect, it } from 'vitest';
import { loadAgentARolloutConfig } from '@/lib/config';

describe('flags de rollout del Agente A', () => {
  it('ambos apagados por defecto', () => {
    // R1: nada se enciende en el mismo commit que lo introduce.
    expect(loadAgentARolloutConfig({})).toEqual({
      contextScoping: false,
      repairEnabled: false,
    });
  });

  it('sólo "true" enciende', () => {
    for (const value of ['false', 'TRUE ', '1', 'yes', '']) {
      const config = loadAgentARolloutConfig({
        AGENT_A_CONTEXT_SCOPING: value,
        AGENT_A_REPAIR_ENABLED: value,
      });
      const expected = value.trim().toLowerCase() === 'true';
      expect(config.contextScoping).toBe(expected);
      expect(config.repairEnabled).toBe(expected);
    }
  });

  it('los dos flags son independientes', () => {
    // El recorte puede medirse sin encender la reparación, que es exactamente
    // el orden de las fases 1 y 2.
    expect(loadAgentARolloutConfig({ AGENT_A_CONTEXT_SCOPING: 'true' })).toEqual({
      contextScoping: true,
      repairEnabled: false,
    });
  });
});
