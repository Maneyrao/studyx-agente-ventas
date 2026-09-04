import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { nextAdaptiveCustomerTurnV1 } from '../helpers/agent-a-adaptive-customer';
import { configuration } from '../helpers/botpress-workflow-runtime';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';

/**
 * Una venta completa donde el cliente contesta lo que el agente pregunta.
 *
 * Los recorridos con guion fijo miden al agente contra una conversación que no
 * existe: la persona dice su línea siguiente aunque le hayan preguntado otra
 * cosa, y una pregunta ignorada nunca se nota. Acá cada turno del cliente sale
 * del último mensaje del agente.
 *
 * El cliente es determinístico y por reglas: un segundo modelo costaría lo
 * mismo que el agente y volvería irreproducible la corrida. Costo extra de
 * este caso: cero tokens más allá de los turnos del propio agente.
 */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
let readiness = { ok: false, detail: 'sin verificar' };

beforeAll(async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
    readiness = response.ok
      ? { ok: true, detail: 'listo' }
      : { ok: false, detail: `/api/ready respondió ${response.status}` };
  } catch (error) {
    readiness = {
      ok: false,
      detail: `sin backend: ${error instanceof Error ? error.message : 'desconocido'}`,
    };
  }
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
});

describe('venta completa con cliente adaptativo', () => {
  it('avanza hasta el link contestando lo que el agente pregunta', async () => {
    expect(readiness.ok, `LABORATORIO_NO_DISPONIBLE: ${readiness.detail}`).toBe(true);

    const perfil = {
      course: 'Redes Informáticas',
      fullName: 'Camila Ortiz',
      email: 'camila.ortiz@example.test',
      declaredPhone: '+1 305 555 0143',
      planPhrase: 'las seis cuotas',
      acceptsCall: false,
    } as const;

    const conversationId = `wfa-${randomUUID()}`;
    const userId = `wfa-user-${randomUUID()}`;
    const phoneE164 = `+999${String(Date.now()).slice(-10)}`;

    const transcript: { role: 'user' | 'assistant'; text: string; answering?: string }[] = [];
    const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
    let lastAgentMessage: string | null = null;
    let alreadyGaveDetails = false;
    let silencios = 0;
    let planRequests = 0;

    for (let turnIndex = 0; turnIndex < 7; turnIndex += 1) {
      const siguiente = nextAdaptiveCustomerTurnV1({
        profile: perfil, lastAgentMessage, turnIndex, alreadyGaveDetails,
      });
      if (siguiente.answering === 'datos_de_contacto') alreadyGaveDetails = true;

      const evidencia = await runWorkflowTurnV1({
        text: siguiente.text, conversationId, userId, phoneE164,
      });
      turns.push({ customer: siguiente.text, evidence: evidencia });
      transcript.push({ role: 'user', text: siguiente.text, answering: siguiente.answering });
      for (const message of evidencia.authorizedMessages) {
        transcript.push({ role: 'assistant', text: message });
      }
      if (evidencia.authorizedMessages.length === 0) silencios += 1;
      planRequests += evidencia.legacyPlanRequests;
      lastAgentMessage = evidencia.authorizedMessages.join(' ') || null;
      if (siguiente.answering === 'link_recibido') break;
    }

    const db = await readWorkflowDbEvidenceV1({
      databaseUrl, externalConversationId: conversationId,
      adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
    });

    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-adaptive-sale', {
        evaluated_route: 'plannerless-v2',
        customer: 'adaptive-rule-based-v1',
        scenario_role: 'adjustment', transcript, turns, db, availability_failures: availabilityFailures,
    });

    expect(silencios, 'ningún turno puede quedar sin respuesta').toBe(0);
    expect(availabilityFailures, 'un link posterior no compensa una degradación técnica previa').toBe(0);
    expect(planRequests).toBe(0);
    expect(turns.every((turn) => turn.evidence.commitSucceeded && turn.evidence.errorCode === null)).toBe(true);
    // La venta llegó a donde tenía que llegar, con el plan que la persona dijo.
    expect(db.state?.selectedOfferingCode).toBe('redes_informaticas');
    expect(db.state?.selectedPaymentPlan).toBe('monthly_6');
    expect(db.contact?.declaredPhone).toBe('+13055550143');
    expect(db.deliveredLinks.length, 'un link, del plan elegido').toBe(1);
    expect(db.deliveredLinks[0]).toContain('6m');
    // Rechazó la llamada: no puede haber más de una oferta previa al rechazo.
    expect(db.state?.callOfferCount).toBeLessThanOrEqual(2);
  }, 900_000);
});
