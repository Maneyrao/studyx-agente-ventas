import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

// Independent validation authored after two held-out variants failed.
// Keep these customer messages reserved until the next source freeze.
// This never replaces or relabels either failed held-out transcript.
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

it('preserves a new personal-data form and a twelve-payment choice until explicit permission', async () => {
  const identity = {
    conversationId: `heldout-intake-v3-${randomUUID()}`,
    userId: `heldout-intake-v3-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
  const turns: { customer: string; customerAuthorizedLink: boolean; evidence: WorkflowTurnEvidenceV1 }[] = [];
  const expectedLink = 'https://example.invalid/eval/12m';

  async function send(customer: string, customerAuthorizedLink = false) {
    const evidence = await runWorkflowTurnV1({ ...identity, text: customer, providerMode: 'live' });
    turns.push({ customer, customerAuthorizedLink, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap(turn => turn.evidence.adapterCaptures),
    });
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-intake-heldout-v3-checkpoint', {
      ...identity,
      case_id: 'heldout_intake_v3_structured_identity',
      scenario_role: 'heldout_validation_v3',
      validation_generation: 3,
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

  let result = await send('Me interesa Excel Integral para organizar mejor los números de mi emprendimiento.');
  expect(result.db.state?.selectedOfferingCode).toBe('excel_integral');

  result = await send('Para pagarlo, elijo la alternativa de doce cuotas.');
  expect(result.db.state?.selectedPaymentPlan).toBe('monthly_12');

  result = await send('Mis datos personales:\nMariana O’Connor;\ncorreo electrónico: mariana.oconnor@example.test\nteléfono: +1 407 555 0152');
  expect(result.db.contact?.name, 'both supplied name components must be durable').toBe('Mariana O’Connor');
  expect(result.db.contact?.email).toBe('mariana.oconnor@example.test');
  expect(result.db.contact?.declaredPhone).toBe('+14075550152');
  expect(result.db.contact?.phone).toBe(identity.phoneE164);
  expect(result.db.contact?.phoneIsSynthetic).toBe(true);
  expect(observedIntake(result.evidence)).toEqual({ status: 'known', missing: [] });

  result = await send('Ya podés pasarme el enlace para pagar en doce cuotas.', true);
  expect(result.db.state?.selectedPaymentPlan).toBe('monthly_12');
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
