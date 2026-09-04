import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { runWorkflowConversationV1, runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration } from '../helpers/botpress-workflow-runtime';

// Regression from the V15 adaptive transcript. A saved plan and a price
// question must not become permission, even when contact details follow.
it('a price question after selecting a plan is not permission for its link', async () => {
  const api = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
  const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
  expect((await fetch(`${api}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
  configuration.apiBaseUrl = api;
  configuration.agentAPlannerlessV2Enabled = true;
  const identity = {
    conversationId: `wfp-consent-${randomUUID()}`, userId: `wfu-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
  const conversation = await runWorkflowConversationV1({
    ...identity,
    customerTurns: [
      'Hola, me interesa Redes Informáticas',
      'Prefiero no hablar por teléfono, sigamos por acá',
      '¿Y cuánto sale?',
      '¿Y cuánto sale?',
      'Me quedo con las seis cuotas',
      '¿Y cuánto sale?',
      'Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143',
    ],
  });
  const before = await readWorkflowDbEvidenceV1({
    databaseUrl, externalConversationId: identity.conversationId,
    adapterCaptures: conversation.turns.flatMap((turn) => turn.evidence.adapterCaptures),
  });
  writeWorkflowReportV1('workflow-consent-price-before-request', {
    ...conversation, db: before, scenario_role: 'adjustment', evaluated_route: 'plannerless-v2',
  });
  expect.soft(countWorkflowAvailabilityFailuresV1({ turns: conversation.turns, db: before })).toBe(0);
  expect.soft(before.recordedLinks, 'no URL may be recorded before explicit permission').toHaveLength(0);
  expect.soft(before.deliveredLinks).toHaveLength(0);
  expect.soft(before.state?.awaitingReply, 'a price question cannot create pending intake consent').not.toBe('contact_details');
  expect.soft(before.decisions.some((decision) => decision.businessActionType === 'send_payment_link')).toBe(false);

  const customer = 'Sí, ahora mandame el link de las seis cuotas';
  const evidence = await runWorkflowTurnV1({ ...identity, text: customer });
  const turns = [...conversation.turns, { customer, evidence }];
  const after = await readWorkflowDbEvidenceV1({
    databaseUrl, externalConversationId: identity.conversationId,
    adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
  });
  writeWorkflowReportV1('workflow-consent-price-after-request', {
    ...identity, turns, db: after, scenario_role: 'adjustment', evaluated_route: 'plannerless-v2',
    transcript: [...conversation.transcript, { role: 'user', text: customer },
      ...evidence.authorizedMessages.map((text) => ({ role: 'assistant', text }))],
  });
  expect(countWorkflowAvailabilityFailuresV1({ turns, db: after })).toBe(0);
  expect(after.deliveredLinks).toHaveLength(1);
  expect(after.deliveredLinks[0]).toContain('6m');
}, 600_000);
