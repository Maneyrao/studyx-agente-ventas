import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

// Supervised-deploy regression, not a held-out naturalness certification.
// Every checkpoint is preserved before assertions, including a failed run.
beforeAll(() => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
});

it('offers a call first, continues by chat, retains the plan and delivers the authorized link', async () => {
  const identity = {
    conversationId: `call-first-${randomUUID()}`,
    userId: `call-first-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
  const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
  let paymentAuthorized = false;
  async function send(customer: string) {
    const evidence = await runWorkflowTurnV1({ ...identity, text: customer, providerMode: 'live' });
    turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap(turn => turn.evidence.adapterCaptures),
    });
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-call-first-sale', {
      ...identity, case_id: 'call_first_supervised_deploy', scenario_role: 'adjustment',
      turns, db, availability_failures: availabilityFailures,
      transcript: turns.flatMap(turn => [
        { role: 'user', text: turn.customer },
        ...turn.evidence.authorizedMessages.map(text => ({ role: 'assistant', text })),
      ]),
    });
    expect(availabilityFailures).toBe(0);
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.errorCode).toBeNull();
    expect(evidence.legacyPlanRequests).toBe(0);
    if (!paymentAuthorized) {
      expect(db.recordedLinks, 'selection and questions do not authorize payment').toEqual([]);
      expect(db.deliveredLinks).toEqual([]);
      expect(db.decisions.some(d => d.businessActionType === 'send_payment_link')).toBe(false);
    }
    return { evidence, db, text: evidence.authorizedMessages.join('\n') };
  }

  let result = await send('Hola, soy Camila. Me interesa el curso de Redes Informáticas.');
  expect(result.db.state?.selectedOfferingCode).toBe('redes_informaticas');
  expect(result.db.state?.callOfferCount, 'a real initial offer is mandatory').toBe(1);
  expect(result.db.state?.awaitingReply).toBe('call_or_chat');
  expect(result.text).toMatch(/llamad|llamar|tel[eé]fono|telef[oó]nic/iu);

  result = await send('No quiero una llamada, prefiero que sigamos por chat.');
  expect(result.db.state?.callOfferCount, 'no se repite en el turno del rechazo').toBe(1);
  expect(result.text).not.toMatch(/te llamo|llamarte|una llamada|llamada telef/iu);

  result = await send('Quiero aprender para trabajar con redes en mi negocio; todavía estoy averiguando. ¿Cómo se cursa?');
  expect(result.db.state?.callOfferCount, 'una duda posterior activa el último recordatorio').toBe(2);
  expect(result.text).toMatch(/llamad|llamar|tel[eé]fono|telef[oó]nic/iu);
  await send('¿Cuál es el precio y qué opciones de pago tienen?');
  result = await send('Elijo el plan de seis cuotas.');
  expect(result.db.state?.selectedPaymentPlan).toBe('monthly_6');

  result = await send('¿De cuánto es cada una de las cuotas que elegí?');
  expect(result.db.state?.selectedPaymentPlan).toBe('monthly_6');
  expect.soft(result.text, 'the chosen installment is 60; the total 360 is not an answer').toMatch(/\b60\b/u);
  expect.soft(result.text, 'answer the selected amount without reopening the menu').not.toMatch(/12\s+(?:pagos|cuotas)|pago\s+[uú]nico|cu[aá]l.{0,40}(?:c[oó]mod|opci[oó]n|pref)/iu);

  paymentAuthorized = true;
  result = await send('Sí, quiero avanzar: mandame el enlace para pagar en seis cuotas.');
  expect(result.db.deliveredLinks, 'missing personal details still block the link').toEqual([]);
  result = await send('Mis datos: nombre Camila; apellido Duarte; correo camila.duarte@example.test; teléfono +1 305 555 0168.');
  expect(result.db.contact?.name).toBe('Camila Duarte');
  expect(result.db.contact?.email).toBe('camila.duarte@example.test');
  expect(result.db.contact?.declaredPhone).toBe('+13055550168');
  expect(result.db.contact?.phone).toBe(identity.phoneE164);
  expect(result.db.state?.stage).toBe('plan_selected');
  expect(result.db.deliveredLinks).toEqual([]);
  expect(result.text).toMatch(/Camila Duarte/iu);
  expect(result.text).toMatch(/correct|confirm/iu);

  result = await send('Sí, están correctos. Envíame el link.');
  expect(result.db.state?.stage).toBe('payment_link_sent');
  expect(result.db.deliveredLinks).toEqual(['https://example.invalid/eval/6m']);
  expect(result.db.decisions.filter(d => d.businessActionType === 'send_payment_link')).toHaveLength(1);
}, 240_000);
