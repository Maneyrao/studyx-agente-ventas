import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowConversationV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration } from '../helpers/botpress-workflow-runtime';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';

/**
 * Resultados, no respuestas.
 *
 * El arnés anterior probaba que el turno se entregara y que el commit
 * devolviera OK. Eso no es lo mismo que la venta haya quedado bien guardada:
 * "Registré tus datos" es texto, y el texto no demuestra nada. Acá cada
 * recorrido termina leyendo la base aislada.
 *
 * Si falta backend, configuración o proveedor, estas pruebas FALLAN. No hay
 * `return` silencioso que las deje pasar por ausencia de entorno: un gate que
 * se aprueba solo cuando no hay nada que medir no es un gate.
 */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';

let readiness: { ok: boolean; detail: string } = { ok: false, detail: 'sin verificar' };

beforeAll(async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
    readiness = response.ok
      ? { ok: true, detail: 'listo' }
      : { ok: false, detail: `/api/ready respondió ${response.status}` };
  } catch (error) {
    readiness = {
      ok: false,
      detail: `sin backend en ${apiBaseUrl}: ${error instanceof Error ? error.message : 'desconocido'}`,
    };
  }
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
});

/** Falla ruidosamente. Un entorno incompleto bloquea el gate, no lo aprueba. */
function requireBackend(): void {
  expect(readiness.ok, `LABORATORIO_NO_DISPONIBLE: ${readiness.detail}`).toBe(true);
}

function identity() {
  const conversationId = `wfp-${randomUUID()}`;
  return {
    conversationId,
    userId: `wfu-${randomUUID()}`,
    phoneE164: `+999${String(Date.now() + Math.floor(Math.random() * 9000)).slice(-10)}`,
  };
}

const evidencias: Record<string, unknown> = {};

async function correr(caseId: string, customerTurns: readonly string[]) {
  const id = identity();
  const conversacion = await runWorkflowConversationV1({ ...id, customerTurns });
  const db = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: id.conversationId,
    adapterCaptures: conversacion.turns.flatMap((turn) => turn.evidence.adapterCaptures),
  });
  const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns: conversacion.turns, db });
  evidencias[caseId] = { ...conversacion, db, availabilityFailures };
  writeWorkflowReportV1(`workflow-persisted-${caseId}`, {
    evaluated_route: 'plannerless-v2', scenario_role: 'adjustment',
    ...conversacion, db, availability_failures: availabilityFailures,
  });
  expect(availabilityFailures, `${caseId}: disponibilidad por turno`).toBe(0);
  return { conversacion, db };
}

describe('resultados persistidos del Agente A', () => {
  it('cambio de curso: persiste el último, no el primero', async () => {
    requireBackend();
    const { conversacion, db } = await correr('curso_cambiado', [
      'Hola, me interesa Redes Informáticas',
      'Pensándolo mejor prefiero Excel Integral',
      '¿Y qué se aprende ahí?',
    ]);

    expect(conversacion.silentTurns).toBe(0);
    expect(db.state?.selectedOfferingCode).toBe('excel_integral');
    // El modelo evaluado es el del candidato, no otro proveedor.
    expect(db.decisions.every((d) => (d.modelName ?? '').startsWith('deepseek'))).toBe(true);
    expect(new Set(db.decisions.map((d) => d.promptVersion)).size).toBe(1);
  }, 600_000);

  it('rechazo de llamada: queda registrado y no se vuelve a ofrecer', async () => {
    requireBackend();
    const { conversacion, db } = await correr('llamada_rechazada', [
      'Me interesa Maquillaje Profesional',
      'No quiero que me llamen, prefiero por chat',
      'Contame cómo se cursa',
      '¿Y cuánto cuesta?',
    ]);

    expect(db.state?.callPreference).toBe('chat');
    expect(db.state?.callOfferCount).toBeLessThanOrEqual(2);
    // Ninguna oferta de llamada después del turno del rechazo.
    const posteriores = conversacion.turns.slice(2)
      .flatMap((turn) => turn.evidence.authorizedMessages)
      .filter((text) => /te llamo|llamarte|una llamada|llamada telef/iu.test(text));
    expect(posteriores, `reofreció: ${JSON.stringify(posteriores)}`).toHaveLength(0);
    expect(conversacion.silentTurns).toBe(0);
  }, 600_000);

  it('teléfono declarado se guarda aparte de la identidad sintética', async () => {
    requireBackend();
    const { db } = await correr('telefono_declarado', [
      'Quiero Redes Informáticas',
      'Me quedo con el pago único',
      'Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199',
    ]);

    expect(db.contact?.phoneIsSynthetic, 'el canal debe traer identidad sintética').toBe(true);
    expect(db.contact?.declaredPhone).toBe('+13055550199');
    // La identidad del canal NO se pisa: es su clave única.
    expect(db.contact?.phone).not.toBe('+13055550199');
    expect(db.contact?.email).toBe('lucia.ferrer@example.test');
    expect(db.state?.selectedPaymentPlan).toBe('one_time');
    expect(db.recordedLinks, 'elegir plan y dar datos no autoriza el link').toHaveLength(0);
    expect(db.decisions.some((decision) => decision.businessActionType === 'send_payment_link')).toBe(false);
  }, 600_000);

  it('link canónico sólo con plan e intake completos, y del plan elegido', async () => {
    requireBackend();
    const { db } = await correr('link_autorizado', [
      'Quiero anotarme en Redes Informáticas',
      'Me quedo con las seis cuotas',
      'Mandame el link. Soy Ana Ríos, ana.rios@example.test, teléfono +1 305 555 0177',
    ]);

    expect(db.state?.selectedPaymentPlan).toBe('monthly_6');
    expect(db.deliveredLinks.length, 'debe salir exactamente un link').toBe(1);
    // El link es el del plan elegido, no el de otro.
    expect(db.deliveredLinks[0]).toContain('6m');
    expect(db.decisions.some((d) => d.businessActionType === 'send_payment_link')).toBe(true);
  }, 600_000);

  it('postergar no manda link ni materializa acción', async () => {
    requireBackend();
    const { db } = await correr('postergacion', [
      'Me interesa Excel Integral',
      'Elijo las 12 cuotas',
      'Ahora no puedo, lo dejo para la semana que viene',
    ]);

    expect(db.deliveredLinks).toHaveLength(0);
    expect(db.recordedLinks).toHaveLength(0);
    expect(db.decisions.some((d) => d.businessActionType === 'send_payment_link')).toBe(false);
    // El plan elegido se conserva para retomar.
    expect(db.state?.selectedPaymentPlan).toBe('monthly_12');
  }, 600_000);

  it('pago informado no es pago verificado ni promete acceso', async () => {
    requireBackend();
    const { conversacion, db } = await correr('pago_informado', [
      'Me anoto en Excel Integral',
      'Ya hice la transferencia',
      '¿Entonces ya tengo acceso al campus?',
    ]);

    expect(db.state?.paymentReportedAt, 'el aviso debe quedar registrado').not.toBeNull();
    const texto = conversacion.transcript
      .filter((t) => t.role === 'assistant').map((t) => t.text).join(' ');
    // Nada que prometa acceso, alta o acreditación como hecho consumado.
    expect(texto).not.toMatch(/ya ten[eé]s acceso|tu acceso est[aá] (?:activo|habilitado)/iu);
    expect(texto).not.toMatch(/pago (?:acreditado|verificado|confirmado)\b/iu);
    expect(conversacion.silentTurns).toBe(0);
  }, 600_000);

  it('opt-out se respeta y su silencio es deliberado, no un fallo', async () => {
    requireBackend();
    const { conversacion, db } = await correr('opt_out', [
      'Hola, quiero info de Redes Informáticas',
      'No me escribas más, quiero que me den de baja',
      '¿Y cuánto sale ese curso?',
    ]);

    const optout = conversacion.turns[1]!;
    const ultimo = conversacion.turns[2]!;
    // O bien confirma la baja, o bien calla deliberadamente. Lo que no puede
    // hacer es seguir vendiendo.
    const texto = ultimo.evidence.authorizedMessages.join(' ');
    expect(texto).not.toMatch(/USD 360|link de pago|cu[oó]tas de USD/iu);
    expect(db.decisions.length).toBeGreaterThan(0);
    expect(db.permission?.consentStatus).toBe('revoked');
    expect(db.permission?.evidenceEventId).not.toBeNull();
    expect(db.permission?.revokedTurnId).toBe(optout.evidence.turnId);
    const restrictedTurnIds = new Set([optout.evidence.turnId, ultimo.evidence.turnId]);
    expect(db.decisions.filter((decision) => restrictedTurnIds.has(decision.turnId))
      .every((decision) => decision.businessActionType === null)).toBe(true);
    expect(ultimo.evidence.authorizedMessages, 'después de la baja no hay nuevos mensajes').toHaveLength(0);
    expect(conversacion.turns.slice(1).flatMap((turn) => turn.evidence.actions)
      .some((action) => action.name === 'dispatchCall')).toBe(false);
    expect(db.recordedLinks).toHaveLength(0);
  }, 600_000);

  it('deja la evidencia en disco para calificar naturalidad aparte', () => {
    requireBackend();
    writeWorkflowReportV1('workflow-persisted-outcomes', {
        evaluated_route: 'plannerless-v2',
        cases: evidencias,
    });
    expect(Object.keys(evidencias).length).toBeGreaterThan(0);
  });
});
