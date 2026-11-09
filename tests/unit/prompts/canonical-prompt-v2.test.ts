import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';

const source = readFileSync(
  fileURLToPath(new URL('../../../docs/prompts/studyx-agent-a-canonical.md', import.meta.url)),
  'utf8',
);

// Conversational quality is exercised through the vertical/live workflow.
// Exact-prose assertions from v41 would preserve the overloaded prompt.
describe('canonical prompt deployment parity', () => {
  it('loads the same source used to generate the deployed behavior', () => {
    // Authority: prompt lines 91-129 replace the previous commercial ladder.
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v120');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  it('keeps diagnosis, value-based objection handling and calls while fencing promotions', () => {
    expect(source).toContain('Descubre sólo lo que te sirve para vender');
    expect(source).toContain('La llamada es una herramienta de cierre complementaria');
    expect(source).toContain('Motivo del mensaje actual');
    expect(source).toContain('en el mismo turno, presenta el curso en tu respuesta');
    expect(source).toContain('`accept_promotion` lleva la identidad completa del contexto');
    expect(source).toContain('schedule_price_objection_checkin');
    expect(source).toContain('El precio total no se baja ni se modifica');
  });

  it('ships the complete sales system requested by Lisandro instead of a compressed summary', () => {
    expect(source).toContain('## Mentalidad de venta');
    expect(source).toContain('## Descubrir lo justo');
    expect(source).toContain('## Construir valor');
    expect(source).toContain('## Cierres de prueba y cierre');
    expect(source).toContain('### Escalera de negociación');
    expect(source).toContain('### Mapa de afinidades');
    expect(source).toContain('1. **Valor:**');
    expect(source).toContain('2. **Cuotas:**');
    expect(source).toContain('5. **Bonificación:**');
    expect(source).toContain('Una objeción no es un no: es información');
  });
});
