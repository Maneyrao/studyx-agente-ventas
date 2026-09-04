import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

// Independent validation authored after the first held-out run failed.
// Keep these customer messages reserved until the next source freeze.
// This never replaces or relabels the failed first held-out transcript.
beforeAll(() => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
});

function observedIntake(evidence: WorkflowTurnEvidenceV1) {
  const request = evidence.httpExchanges.find(exchange => exchange.boundary === 'deepseek')?.requestBody;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('HELDOUT_MODEL_REQUEST_MISSING');
  }
  const instructions = (request as Record<string, unknown>).instructions;
  if (typeof instructions !== 'string') throw new Error('HELDOUT_MODEL_CONTEXT_MISSING');
  const contextText = instructions.match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
  if (!contextText) throw new Error('HELDOUT_AUTHORIZED_CONTEXT_MISSING');
  const context = JSON.parse(contextText) as {
    capabilities?: { intake_status?: unknown; intake_missing?: unknown };
  };
  return {
    status: context.capabilities?.intake_status,
    missing: context.capabilities?.intake_missing,
  };
}

it('persists a fresh structured identity before permission and delivers only after the later request', async () => {
  const identity = {
    conversationId: `heldout-intake-v2-${randomUUID()}`,
    userId: `heldout-intake-v2-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
  const turns: { customer: string; customerAuthorizedLink: boolean; evidence: WorkflowTurnEvidenceV1 }[] = [];
  const expectedLink = 'https://example.invalid/eval/contado';

  async function send(customer: string, customerAuthorizedLink = false) {
    const evidence = await runWorkflowTurnV1({ ...identity, text: customer, providerMode: 'live' });
    turns.push({ customer, customerAuthorizedLink, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap(turn => turn.evidence.adapterCaptures),
    });
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-intake-heldout-v2-checkpoint', {
      ...identity,
      case_id: 'heldout_intake_v2_structured_identity',
      scenario_role: 'heldout_validation',
      validation_generation: 2,
      turns,
      db,
      availability_failures: availabilityFailures,
      transcript: turns.flatMap(turn => [
        { role: 'user', text: turn.customer },
        ...turn.evidence.authorizedMessages.map(text => ({ role: 'assistant', text })),
      ]),
    });
    // Stop at the first failed checkpoint; do not spend another HTTP to hide it.
    expect(availabilityFailures, 'availability across every observed turn').toBe(0);
    expect(evidence.legacyPlanRequests).toBe(0);
    if (!customerAuthorizedLink) {
      expect(db.recordedLinks, 'data and plan choice do not authorize a payment link').toEqual([]);
      expect(db.deliveredLinks).toEqual([]);
      expect(db.decisions.some(decision => decision.businessActionType === 'send_payment_link')).toBe(false);
      expect(evidence.authorizedMessages.join('\n')).not.toMatch(/https?:\/\//u);
    }
    return { evidence, db };
  }

  let result = await send('Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.');
  expect(result.db.state?.selectedOfferingCode).toBe('maquillaje_profesional');

  result = await send('Prefiero hacer un pago único.');
  expect(result.db.state?.selectedPaymentPlan).toBe('one_time');

  result = await send('Nombre y apellido: Valentina Costa\nEmail: valentina.costa@example.test\nCelular: +1 (786) 555-0164');
  expect(result.db.contact?.name, 'both supplied name components must be durable').toBe('Valentina Costa');
  expect(result.db.contact?.email).toBe('valentina.costa@example.test');
  expect(result.db.contact?.declaredPhone).toBe('+17865550164');
  expect(result.db.contact?.phone).toBe(identity.phoneE164);
  expect(result.db.contact?.phoneIsSynthetic).toBe(true);
  expect(observedIntake(result.evidence)).toEqual({ status: 'known', missing: [] });

  result = await send('Sí, enviame ahora el enlace para abonar todo junto.', true);
  expect(result.db.state?.selectedPaymentPlan).toBe('one_time');
  expect(result.db.state?.stage).toBe('payment_link_sent');
  expect(result.db.state?.awaitingReply).toBe('none');
  expect(observedIntake(result.evidence)).toEqual({ status: 'known', missing: [] });
  expect(result.db.recordedLinks).toEqual([expectedLink]);
  expect(result.db.deliveredLinks, 'exact canonical URL requires correlated durable delivery').toEqual([expectedLink]);
  const paymentDecisions = result.db.decisions.filter(decision => decision.businessActionType === 'send_payment_link');
  expect(paymentDecisions).toHaveLength(1);
  expect(paymentDecisions[0]?.turnId).toBe(result.evidence.turnId);
  const outbound = result.db.outbound.find(item => item.turnId === result.evidence.turnId && item.content.includes(expectedLink));
  expect(outbound).toBeDefined();
  expect(result.evidence.adapterCaptures.some(capture => outbound
    && outbound.authorizedOutboundId === outbound.id
    && capture.outboundId === outbound.id
    && capture.turnId === outbound.turnId
    && capture.traceId === outbound.traceId
    && capture.conversationId === outbound.externalConversationId
    && capture.providerMessageId === outbound.providerMessageId
    && capture.content === outbound.content)).toBe(true);
}, 180_000);
