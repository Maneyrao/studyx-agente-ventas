import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowConversationV1 } from '../helpers/agent-a-workflow-driver';
import { configuration } from '../helpers/botpress-workflow-runtime';

/**
 * Conversaciones completas por el workflow de producción.
 *
 * Cubren los ocho movimientos que el negocio necesita: consulta general,
 * cambio de curso, objeción de precio, rechazo de llamada, elección de plan,
 * postergación, solicitud de link y aviso de pago. Las frases son paráfrasis
 * nuevas — no las de la suite `studyx-agent-a-conversational-baseline`, que ya
 * se usó para ajustar — así que esto no mide memoria del ajuste.
 *
 * Cada conversación tiene identidad propia: correr las cuatro sobre una misma
 * conversación arrastraría memoria entre casos y mediría otra cosa.
 *
 * Lo funcional se afirma acá. La naturalidad NO: sale del transcript que esta
 * suite deja escrito, y se califica aparte con la rúbrica V2. Mezclarlas haría
 * que un turno feo pero correcto pase, o que uno correcto pero feo falle.
 */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const outputDir = path.resolve(process.cwd(), 'botpress-agent/evals/results');
let backendUp = false;

beforeAll(async () => {
  try {
    backendUp = (await fetch(`${apiBaseUrl}/api/ready`, {
      signal: AbortSignal.timeout(3_000),
    })).ok;
  } catch {
    backendUp = false;
  }
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
});

function identity() {
  const suffix = String(Date.now() + Math.floor(Math.random() * 1000)).slice(-10);
  return {
    conversationId: `wfc-${randomUUID()}`,
    userId: `wfu-${randomUUID()}`,
    phoneE164: `+999${suffix}`,
  };
}

const CONVERSACIONES = [
  {
    id: 'wf_01_consulta_y_cambio_de_curso',
    // Consulta general → curso → cambio de curso → pregunta vaga.
    customerTurns: [
      'Hola, quería saber qué formaciones tienen en tecnología',
      'Me tienta la de Redes Informáticas',
      'Pensándolo mejor, prefiero Excel Integral',
      '¿?',
    ],
  },
  {
    id: 'wf_02_objecion_precio_y_rechazo_llamada',
    // Objeción de precio → rechazo explícito de llamada → continuidad.
    customerTurns: [
      'Buenas, me interesa Maquillaje Profesional',
      'Uf, me parece bastante plata la verdad',
      'No me llames por favor, sigamos escribiendo',
      '¿Y la cuota más baja de cuánto sería?',
    ],
  },
  {
    id: 'wf_03_plan_postergacion_link',
    // Elección de plan → postergación → solicitud explícita de link con datos.
    customerTurns: [
      'Quiero anotarme en Redes Informáticas',
      'Me quedo con las seis cuotas',
      'Igual esta semana no puedo, lo dejo para el lunes',
      'Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199',
    ],
  },
  {
    id: 'wf_04_aviso_de_pago',
    // Aviso de pago sin link previo: no se promete acceso ni inscripción.
    customerTurns: [
      'Me anoto en Excel Integral',
      'Ya hice la transferencia recién',
      '¿Entonces ya quedé inscripta?',
    ],
  },
] as const;

describe('conversaciones completas por processInboundTurn', () => {
  it('los cuatro recorridos comerciales avanzan sin planner ni silencios', async () => {
    if (!backendUp) {
      console.warn(`WORKFLOW_CONVERSATIONS_SKIPPED: sin backend en ${apiBaseUrl}`);
      return;
    }

    const resultados = [];
    for (const caso of CONVERSACIONES) {
      const evidencia = await runWorkflowConversationV1({
        ...identity(),
        customerTurns: caso.customerTurns,
      });
      resultados.push({ case_id: caso.id, ...evidencia });

      // Ningún turno puede quedar mudo: el cliente escribió y espera respuesta.
      expect(evidencia.silentTurns, `${caso.id}: turnos sin respuesta`).toBe(0);
      // La ruta plannerless no pide planes. Se cuenta la invocación real.
      expect(evidencia.totalPlanRequests, `${caso.id}: planes pedidos`).toBe(0);
      // Cada turno llegó al commit; nada quedó a mitad de camino.
      for (const turno of evidencia.turns) {
        expect(turno.evidence.commitSucceeded, `${caso.id}: commit de "${turno.customer}"`)
          .toBe(true);
        expect(turno.evidence.errorCode, `${caso.id}: error en "${turno.customer}"`).toBeNull();
      }
    }

    // El transcript queda en disco para calificar naturalidad por separado.
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      path.join(outputDir, 'workflow-conversations-latest.json'),
      `${JSON.stringify({
        execution_harness: 'processInboundTurn',
        evaluated_route: 'plannerless-v2',
        generated_at: new Date().toISOString(),
        conversations: resultados.map((r) => ({
          case_id: r.case_id,
          transcript: r.transcript,
          delivered_turns: r.deliveredTurns,
          silent_turns: r.silentTurns,
          plan_requests: r.totalPlanRequests,
        })),
      }, null, 2)}\n`,
      'utf8',
    );
  }, 600_000);

  it('un rechazo explícito de llamada no vuelve a ofrecerla', async () => {
    if (!backendUp) return;

    const evidencia = await runWorkflowConversationV1({
      ...identity(),
      customerTurns: [
        'Hola, me interesa Redes Informáticas',
        'Prefiero no hablar por teléfono, seguimos por chat',
        'Contame más del contenido',
        '¿Y cuánto sale?',
      ],
    });

    const ofrecimientos = evidencia.transcript
      .filter((t) => t.role === 'assistant')
      .slice(2)
      .filter((t) => /llamada|llamarte|te llamo|telefónica/iu.test(t.text));

    expect(ofrecimientos, `ofreció llamada tras el rechazo: ${JSON.stringify(ofrecimientos)}`)
      .toHaveLength(0);
    expect(evidencia.silentTurns).toBe(0);
  }, 600_000);
});
