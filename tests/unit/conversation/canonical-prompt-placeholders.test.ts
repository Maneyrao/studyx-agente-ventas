import { describe, expect, it } from 'vitest';
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '@/../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';

/**
 * `base_17_report_without_link` le respondió al cliente "Todavía no, {nombre}."
 * — un hueco de plantilla sin completar, visible en el chat. El caso pasó el
 * gate funcional: ninguna aserción mira la forma del texto.
 *
 * El origen es el prompt: las frases de ejemplo llevaban `{{nombre}}` y el
 * modelo las copia tal cual. Un slot de nombre no se puede completar en
 * runtime —el backend no lo interpola— así que la única salida correcta es que
 * no exista. El agente ya llama a la persona por el nombre que ella le dio.
 *
 * Los slots en MAYÚSCULAS son otra cosa: describen datos de configuración del
 * bloque de producto y viven en tablas y ejemplos, no en frases que el modelo
 * copie a una respuesta.
 */
describe('prompt canónico del Agente A', () => {
  it('no ofrece ningún hueco de nombre que el modelo pueda copiar sin completar', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).not.toMatch(/\{\{\s*nombre\s*\}\}/u);
  });
});
