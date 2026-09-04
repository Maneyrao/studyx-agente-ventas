import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

// Fresh validation inputs, separate from the transcripts used to fix v14.
// Live only: invoke explicitly through run-agent-a-workflow-lab.mjs --paid.
beforeAll(() => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
});

function conversation(caseId: string) {
  const id = { conversationId: `heldout-${randomUUID()}`, userId: `heldout-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}` };
  const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
  return async (customer: string) => {
    const evidence = await runWorkflowTurnV1({ ...id, text: customer, providerMode: 'live' });
    turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!, externalConversationId: id.conversationId,
      adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
    });
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-heldout-checkpoint', {
      ...id, case_id: caseId, scenario_role: 'heldout_validation', turns, db,
      availability_failures: availabilityFailures,
      transcript: turns.flatMap((turn) => [
        { role: 'user', text: turn.customer },
        ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant', text })),
      ]),
    });
    expect.soft(availabilityFailures, 'availability across every turn').toBe(0);
    expect.soft(evidence.legacyPlanRequests).toBe(0);
    return { db, evidence };
  };
}

describe('new heldout conversations through processInboundTurn', () => {
  it('defers a selected plan and supplied data until a new explicit link request', async () => {
    const send = conversation('heldout_v14_consent_after_deferral');
    let result = await send('Estoy mirando la formación Excel Integral. Me gustaría manejar mejor las planillas.');
    expect.soft(result.db.state?.selectedOfferingCode).toBe('excel_integral');
    result = await send('La alternativa de seis pagos me encaja; por ahora sólo estoy averiguando.');
    expect.soft(result.db.state?.selectedPaymentPlan).toBe('monthly_6');
    expect.soft(result.db.deliveredLinks).toEqual([]);
    result = await send('Esta quincena paso, lo retomo otro día.');
    expect.soft(result.db.deliveredLinks).toEqual([]);
    result = await send('Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.');
    expect.soft(result.db.contact?.declaredPhone).toBe('+13055550188');
    expect.soft(result.db.deliveredLinks).toEqual([]);
    result = await send('Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.');
    expect.soft(result.db.deliveredLinks).toEqual(['https://example.invalid/eval/6m']);
    result = await send('Lo aboné recién, ¿queda registrado el aviso?');
    expect.soft(result.db.state?.paymentReportedAt).not.toBeNull();
  }, 180_000);

  it('keeps chat preference through a course change and persists a later opt-out', async () => {
    const send = conversation('heldout_v14_course_change_and_optout');
    await send('Quisiera conocer Redes Informáticas para mejorar en mi trabajo.');
    let result = await send('Me resulta más cómodo escribir; no quiero que me llamen.');
    expect.soft(result.db.state?.callOfferStatus).toBe('declined');
    result = await send('Cambié de idea sobre el curso: prefiero Excel Integral.');
    expect.soft(result.db.state?.selectedOfferingCode).toBe('excel_integral');
    expect.soft(result.db.state?.selectedPaymentPlan).toBeNull();
    expect.soft(result.db.state?.callOfferStatus).toBe('declined');
    result = await send('Dame de baja, no me escriban más.');
    expect.soft(result.db.permission?.consentStatus).toBe('revoked');
    expect.soft(result.db.permission?.revokedTurnId).toBe(result.evidence.turnId);
    const outboundCount = result.db.outboundCount;
    result = await send('Que quede claro que sigo de baja.');
    expect.soft(result.db.outboundCount).toBe(outboundCount);
    expect.soft(result.evidence.adapterCaptures).toEqual([]);
  }, 180_000);
});
