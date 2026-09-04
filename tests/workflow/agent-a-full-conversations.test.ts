import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowConversationV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
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
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';

/**
 * Códigos con los que la ruta plannerless calla A PROPÓSITO.
 *
 * El workflow prefiere no responder antes que sustituir al modelo con copy
 * enlatado cuando la generación no sobrevive las validaciones; está escrito así
 * en `processInboundTurn`. Ese silencio es una decisión comprometida en la
 * base, con su motivo, y no puede contarse igual que un turno que se perdió.
 *
 * Un silencio accidental —sin decisión, o con el workflow en error— sí es un
 * fallo, y es lo que estas pruebas exigen que sea cero.
 */
const SILENCIOS_DELIBERADOS_V1 = new Set([
  'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK',
  'OPT_OUT_ACK',
  'CONTACT_BLOCKED',
]);
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
    // Sin laboratorio el gate queda BLOQUEADO, no aprobado. Un `return` acá
    // convertía la ausencia de entorno en un verde.
    expect(backendUp, `LABORATORIO_NO_DISPONIBLE: sin backend en ${apiBaseUrl}`).toBe(true);

    const resultados = [];
    for (const caso of CONVERSACIONES) {
      const evidencia = await runWorkflowConversationV1({
        ...identity(),
        customerTurns: caso.customerTurns,
      });
      resultados.push({ case_id: caso.id, ...evidencia });

      // Un turno mudo sólo se acepta cuando el backend registró POR QUÉ calló.
      // Sin decisión comprometida, el turno se perdió y eso es un fallo.
      if (evidencia.silentTurns > 0) {
        const db = await readWorkflowDbEvidenceV1({
          databaseUrl, externalConversationId: evidencia.conversationId,
        });
        const deliberados = db.decisions.filter((d) => (
          !d.hasResponse && SILENCIOS_DELIBERADOS_V1.has(d.reasonCode ?? '')
        )).length;
        expect(
          evidencia.silentTurns - deliberados,
          `${caso.id}: silencios accidentales (motivos: ${db.decisions.filter((d) => !d.hasResponse).map((d) => d.reasonCode).join(', ')})`,
        ).toBe(0);
      }
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
    expect(backendUp, 'LABORATORIO_NO_DISPONIBLE').toBe(true);

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
