import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';

it.skipIf(process.env.STUDYX_INTEGRITY_LIVE !== '1')('preserves advice, public plans, selection and customer identity with the real model', async () => {
  expect(process.env.STUDYX_INTEGRITY_BUDGET_FILE).toBeTruthy();
  const identity = { conversationId: `integrity-live-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'live' as const };
  const turns: Array<{ customer: string; evidence: WorkflowTurnEvidenceV1 }> = [];
  async function send(customer: string) {
    const evidence = await runWorkflowTurnV1({ ...identity, text: customer });
    turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({ databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap(turn => turn.evidence.adapterCaptures) });
    writeWorkflowReportV1('orchestrator-integrity-live', { identity, turns, db });
    expect(evidence.errorCode, JSON.stringify(evidence.httpExchanges.filter(x => (x.status ?? 0) >= 400))).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
    expect(evidence.legacyPlanRequests).toBe(0);
    expect(db.recordedLinks).toEqual([]);
    return db;
  }
  let db = await send('Hola, quiero estudiar inglés. ¿Qué cursos tienen?');
  expect(db.state?.selectedOfferingCode).toBeNull();
  db = await send('¿Qué planes de pago tienen? Todavía no elegí un curso.');
  expect(db.state?.selectedOfferingCode).toBeNull();
  db = await send('Me interesa Inglés 2. Prefiero seguir por chat.');
  expect(db.state?.selectedOfferingCode).toBe('ingles_2');
  db = await send('Mi nombre es Ana; mi apellido es Costa.');
  expect(db.contact?.name).toBe('Ana Costa');
  db = await send('Mi correo es ana.costa@example.test. Quiero saber cuánto es cada pago del plan de seis cuotas, pero todavía no me envíes ningún enlace.');
  expect(db.contact?.email).toBe('ana.costa@example.test');
  db = await send('¿Las clases quedan grabadas? No quiero una llamada.');
  expect(db.contact?.name).toBe('Ana Costa');
  expect(db.state?.selectedOfferingCode).toBe('ingles_2');
}, 180_000);

it.skipIf(!process.env.STUDYX_INTEGRITY_RESUME_FILE)('completes the same live conversation through explicit payment confirmation', async () => {
  const { readFileSync } = await import('node:fs');
  const report = JSON.parse(readFileSync(process.env.STUDYX_INTEGRITY_RESUME_FILE!, 'utf8')) as {
    identity: { conversationId: string; userId: string; phoneE164: string; providerMode: 'live' };
    turns: Array<{ customer: string; evidence: WorkflowTurnEvidenceV1 }>;
  };
  async function send(customer: string) {
    const evidence = await runWorkflowTurnV1({ ...report.identity, text: customer });
    report.turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({ databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: report.identity.conversationId,
      adapterCaptures: report.turns.flatMap(turn => turn.evidence.adapterCaptures) });
    writeWorkflowReportV1('orchestrator-integrity-live-payment', { ...report, db });
    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
    return db;
  }
  let db = await send('Mi teléfono es +1 555 555 0168.');
  expect(db.recordedLinks).toEqual([]);
  db = await send('Quiero inscribirme en Inglés 2 con seis cuotas. Envíame el enlace de pago.');
  expect(db.recordedLinks).toEqual([]);
  expect(db.state?.awaitingReply).toBe('payment_confirmation');
  db = await send('Sí, mis datos y el curso están correctos. Confirmo las seis cuotas de 60 dólares; enviame el enlace.');
  expect(db.recordedLinks).toHaveLength(1);
  expect(db.deliveredLinks).toEqual(db.recordedLinks);
  expect(db.decisions.filter(decision => decision.businessActionType === 'send_payment_link')).toHaveLength(1);
}, 120_000);
