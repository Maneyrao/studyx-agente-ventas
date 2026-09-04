import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { configuration } from '../helpers/botpress-workflow-runtime';

/**
 * El workflow de producción, ejecutado de verdad.
 *
 * Todo lo que se midió hasta acá pasó por `scripts/run-agent-a-conversations.ts`,
 * que reimplementa la orquestación del turno en un script y lo declara en sus
 * reportes como `execution_harness: 'runner_reimplementation'`. Esta suite es
 * la que cierra esa brecha: invoca `processInboundTurn`, con sus acciones
 * reales contra el backend local y su PostgreSQL aislado.
 *
 * Requisitos, y por eso se saltea sola si faltan: un backend en
 * `STUDYX_EVAL_API_BASE_URL` (loopback, puerto 3200-3299) contra el cluster
 * desechable. Nunca `.env.local`, que apunta a la Supabase de producción.
 *
 * Esta suite NO entra en `npm run test:unit`: vive en `vitest.workflow.config.mts`
 * y se corre a mano.
 */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
let backendUp = false;

beforeAll(async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/ready`, {
      signal: AbortSignal.timeout(3_000),
    });
    backendUp = response.ok;
  } catch {
    backendUp = false;
  }
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
});

describe('processInboundTurn como arnés de evaluación', () => {
  it('declara el arnés y la ruta sin que nadie se lo tenga que creer', async () => {
    expect(backendUp, `LABORATORIO_NO_DISPONIBLE: sin backend en ${apiBaseUrl}`).toBe(true);

    const conversationId = `wf-${randomUUID()}`;
    const evidence = await runWorkflowTurnV1({
      text: 'Me interesa Redes Informáticas',
      conversationId,
      userId: `wf-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now()).slice(-10)}`,
    });

    expect(evidence.execution_harness).toBe('processInboundTurn');
    expect(evidence.evaluated_route).toBe('plannerless-v2');
    // La aserción que ningún flag puede fingir: en la ruta plannerless nadie
    // pide un plan. Se cuenta la invocación real de la acción, no la config.
    expect(evidence.legacyPlanRequests).toBe(0);
    // Aserciones que un turno muerto NO puede pasar. La primera versión de
    // esta prueba sólo exigía que `ingestTurn` hubiera sido INVOCADA, y pasaba
    // en verde con la ingesta fallando en 1 ms por un error del propio arnés.
    expect(evidence.errorCode).toBeNull();
    expect(evidence.actions.find((a) => a.name === 'ingestTurn')?.ok).toBe(true);
    expect(evidence.actions.map((a) => a.name)).toContain('claimBatch');
    expect(evidence.status).not.toBe('paused_error');
    // El turno llegó hasta el final: commit y entrega del texto autorizado.
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
  });

  it('el modelo gestionado de Botpress nunca corre en esta ruta', async () => {
    expect(backendUp, 'LABORATORIO_NO_DISPONIBLE').toBe(true);

    const evidence = await runWorkflowTurnV1({
      text: 'Hola',
      conversationId: `wf-${randomUUID()}`,
      userId: `wf-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now() + 1).slice(-10)}`,
    });

    // `execute` lanza en el driver. Si el turno terminó sin ese error, ningún
    // camino cayó al modelo gestionado.
    expect(evidence.errorCode).not.toBe('MANAGED_MODEL_MUST_NOT_RUN_IN_WORKFLOW_HARNESS');
  });
});
