import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLegacyConversationPipelineEligibleV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-routing';

const workflowSource = readFileSync(
  fileURLToPath(new URL('../../../botpress-agent/src/workflows/processInboundTurn.ts', import.meta.url)),
  'utf8',
);

/**
 * Fase 3 · R6 — la ruta duplicada se desactiva, no se borra.
 *
 * El rollback se conserva hasta que el held-out y el canary estén verdes. Hoy
 * ninguno de los dos pudo ejecutarse: no hay `DEEPSEEK_API_KEY` en el entorno
 * local y el conjunto held-out lo escribe un agente independiente fuera de
 * este worktree. Borrar el código ahora dejaría al sistema sin vuelta atrás
 * antes de tener la evidencia que justificaría no necesitarla.
 */
describe('la ruta duplicada sigue disponible como rollback', () => {
  it('`modelUnavailableFallback` sigue existiendo', () => {
    // Cuando este test se invierta a `toBe(0)`, será porque R6 se cumplió.
    expect(workflowSource.match(/modelUnavailableFallback\(/gu)).toHaveLength(1);
  });

  it('sigue confinado a un único call site', () => {
    // El contrato de `brain-unavailable.test.ts`: el motor léxico no puede
    // reaparecer en una ruta que el modelo posee.
    const callSites = workflowSource.match(/modelUnavailableFallback\(/gu) ?? [];
    expect(callSites).toHaveLength(1);
  });

  it('ninguna ruta de fallo del brain lo invoca', () => {
    const assignments = workflowSource.match(/pipelineFailureDecision = .+/gu) ?? [];
    expect(assignments).not.toHaveLength(0);
    for (const assignment of assignments) {
      expect(assignment).not.toContain('modelUnavailableFallback');
    }
  });

  it('el flag de ruta única desactiva la ejecución legacy sin borrar el rollback', () => {
    expect(isLegacyConversationPipelineEligibleV1({
      conversationalBaseEligible: true,
      conversationPipelineEnabled: true,
      singleRoute: true,
    })).toBe(false);
    expect(isLegacyConversationPipelineEligibleV1({
      conversationalBaseEligible: true,
      conversationPipelineEnabled: true,
      singleRoute: false,
    })).toBe(true);
    expect(workflowSource.match(/modelUnavailableFallback\(/gu)).toHaveLength(1);
  });
});
