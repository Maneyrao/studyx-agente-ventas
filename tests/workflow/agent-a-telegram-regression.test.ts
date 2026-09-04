import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import {
  readWorkflowDbEvidenceV1,
  type WorkflowDbEvidenceV1,
} from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

// Regression of the failed Telegram canary through the real workflow handler.
// The local adapter is evidence of authorized submission, not a Telegram ACK.
// This suite calls DeepSeek and must only be run under the centralized budget.
beforeAll(() => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
  expect(process.env.TEST_DATABASE_URL, 'ISOLATED_TEST_DATABASE_REQUIRED').toBeTruthy();
});

type IntakeField = 'nombre' | 'apellido' | 'correo' | 'telefono';

interface ContextObservation {
  readonly capabilities?: {
    readonly may_send_payment_link?: unknown;
    readonly intake_status?: unknown;
    readonly intake_missing?: unknown;
  };
}

interface ClaimObservation {
  readonly outcome?: unknown;
  readonly catalog_resolution?: {
    readonly kind?: unknown;
    readonly offeringCode?: unknown;
    readonly candidateCodes?: unknown;
  };
}

function authorizedContext(evidence: WorkflowTurnEvidenceV1): ContextObservation {
  const request = evidence.httpExchanges
    .find((exchange) => exchange.boundary === 'deepseek')?.requestBody;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('TELEGRAM_REGRESSION_MODEL_REQUEST_MISSING');
  }
  const instructions = (request as Record<string, unknown>).instructions;
  if (typeof instructions !== 'string') {
    throw new Error('TELEGRAM_REGRESSION_INSTRUCTIONS_MISSING');
  }
  const serialized = instructions
    .match(/<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u)?.[1];
  if (!serialized) throw new Error('TELEGRAM_REGRESSION_CONTEXT_MISSING');
  return JSON.parse(serialized) as ContextObservation;
}

function backendClaim(evidence: WorkflowTurnEvidenceV1): ClaimObservation {
  const response = evidence.httpExchanges.find((exchange) => (
    exchange.boundary === 'backend' && exchange.url.endsWith('/claim')
  ))?.responseBody;
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('TELEGRAM_REGRESSION_BACKEND_CLAIM_MISSING');
  }
  return response as ClaimObservation;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function nextSeparateIntakeReply(
  assistantText: string,
  remaining: readonly IntakeField[],
): { field: IntakeField; customer: string } {
  const normalized = normalize(assistantText);
  const values: Record<IntakeField, string> = {
    nombre: 'Inés',
    apellido: 'Valdés',
    correo: 'ines.valdes@example.test',
    telefono: '+1 305 555 0176',
  };
  const patterns: Record<IntakeField, RegExp> = {
    nombre: /\bnombre\b/u,
    apellido: /\bapellido\b/u,
    correo: /\b(?:correo|email|e mail)\b/u,
    telefono: /\b(?:telefono|celular|movil)\b/u,
  };
  const requested = remaining.find((field) => patterns[field].test(normalized));
  if (!requested) {
    throw new Error(`INTAKE_FIELD_REQUEST_NOT_OBSERVED: remaining=${remaining.join(',')}`);
  }
  return { field: requested, customer: values[requested] };
}

it('recovers the failed photography Telegram path through call-first and a delivered cash link', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const identity = {
    conversationId: `telegram-regression-${randomUUID()}`,
    userId: `telegram-regression-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
  const expectedLink = 'https://example.invalid/eval/contado';
  const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
  const dbCheckpoints: WorkflowDbEvidenceV1[] = [];
  const contextCheckpoints: ContextObservation[] = [];
  const claimCheckpoints: ClaimObservation[] = [];
  const intakeAdaptation: Array<{ requested: IntakeField; customer: string }> = [];

  async function send(customer: string, linkMayBeDelivered = false) {
    const evidence = await runWorkflowTurnV1({
      ...identity,
      text: customer,
      providerMode: 'live',
    });
    turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
    });
    const context = authorizedContext(evidence);
    const claim = backendClaim(evidence);
    dbCheckpoints.push(db);
    contextCheckpoints.push(context);
    claimCheckpoints.push(claim);
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });

    // Write first: even a failed checkpoint keeps the complete transcript,
    // provider exchanges, durable state, delivery correlation and adaptation.
    writeWorkflowReportV1('workflow-telegram-regression-checkpoint', {
      ...identity,
      case_id: 'telegram_photography_call_first_cash_link',
      scenario_role: 'failed_canary_regression',
      turns,
      db,
      db_checkpoints: dbCheckpoints,
      claim_checkpoints: claimCheckpoints,
      context_checkpoints: contextCheckpoints,
      intake_adaptation: intakeAdaptation,
      availability_failures: availabilityFailures,
      transcript: turns.flatMap((turn) => [
        { role: 'user', text: turn.customer },
        ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant', text })),
      ]),
    });

    expect(availabilityFailures, 'availability across every observed turn').toBe(0);
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.errorCode).toBeNull();
    expect(evidence.legacyPlanRequests).toBe(0);
    expect(evidence.authorizedMessages, 'a commercial turn cannot end silently').not.toHaveLength(0);
    if (!linkMayBeDelivered) {
      expect(db.recordedLinks, 'no link before consent and complete intake').toEqual([]);
      expect(db.deliveredLinks).toEqual([]);
      expect(db.decisions.some((decision) => decision.businessActionType === 'send_payment_link'))
        .toBe(false);
      expect(evidence.authorizedMessages.join('\n')).not.toMatch(/https?:\/\//u);
    }
    return { evidence, db, claim, context, text: evidence.authorizedMessages.join('\n') };
  }

  let result = await send('Hola, quisiera información del curso de fotografía.');
  expect(result.claim.catalog_resolution).toMatchObject({
    kind: 'ambiguous',
    candidateCodes: ['fotografia_celulares_tiendas_online', 'fotografia_profesional'],
  });
  expect(result.db.state?.selectedOfferingCode).toBeNull();
  expect(result.db.state?.callOfferCount).toBe(0);
  expect(result.text).toMatch(/Fotograf[ií]a Profesional/iu);
  expect(result.text).toMatch(/Fotograf[ií]a con Celulares para Tiendas Online/iu);
  expect(result.text).not.toMatch(/Energ[ií]a Solar Fotovoltaica/iu);

  result = await send('Me interesa Fotografía Profesional.');
  expect(result.claim.catalog_resolution).toMatchObject({
    kind: 'exact', offeringCode: 'fotografia_profesional',
  });
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
  expect(result.db.state?.callPreference).toBe('unknown');
  expect(result.db.state?.callOfferStatus).toBe('offered');
  expect(result.db.state?.callOfferCount, 'the initial call offer must be recorded').toBe(1);
  expect(result.db.state?.awaitingReply).toBe('call_or_chat');
  expect(result.text).toMatch(/\b(?:llamada|llamar|tel[eé]fono|telef[oó]nica)\b/iu);

  result = await send('Quizás personal.');
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
  expect(result.db.state?.callPreference, 'personal motivation is not a channel choice').toBe('unknown');
  expect(result.db.state?.callOfferStatus).toBe('offered');
  const callOfferCountBeforeDecline = result.db.state?.callOfferCount;
  expect(callOfferCountBeforeDecline).toBeGreaterThanOrEqual(1);
  expect(callOfferCountBeforeDecline).toBeLessThanOrEqual(2);

  result = await send('No quiero una llamada; prefiero que sigamos por chat.');
  const callPreferenceAfterDecline = result.db.state?.callPreference;
  expect(['chat', 'declined']).toContain(callPreferenceAfterDecline);
  expect(result.db.state?.callOfferStatus).toBe('declined');
  expect(result.db.state?.callOfferCount).toBe(callOfferCountBeforeDecline);
  expect(result.db.state?.awaitingReply).not.toBe('call_or_chat');

  result = await send('¿Cuál es el precio total y qué opciones de pago tienen?');
  expect(result.text, 'canonical total requires the complete amount, not a substring').toMatch(
    /(?:\bUSD\s*360\b|\b360\s*(?:USD|d[oó]lares?)\b)/iu,
  );
  expect(result.text).toMatch(/\b12\s+(?:pagos|cuotas)[\s\S]{0,80}\bUSD\s*30\b/iu);
  expect(result.text).toMatch(/\b6\s+(?:pagos|cuotas)[\s\S]{0,80}\bUSD\s*60\b/iu);
  expect(result.text).toMatch(/(?:pago\s+[uú]nico|contado)[\s\S]{0,80}\bUSD\s*360\b/iu);
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
  expect(result.db.state?.callOfferCount, 'declining forbids another call offer').toBe(callOfferCountBeforeDecline);

  result = await send('Elijo hacer un pago único al contado.');
  expect(result.db.state?.selectedPaymentPlan).toBe('one_time');
  expect(result.db.state?.callPreference).toBe(callPreferenceAfterDecline);

  result = await send('Sí, quiero avanzar ahora: mandame el enlace para pagar al contado.');
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
  expect(result.db.state?.selectedPaymentPlan).toBe('one_time');
  expect(result.context.capabilities?.intake_missing).toEqual([
    'nombre', 'apellido', 'correo', 'telefono',
  ]);
  expect(result.context.capabilities?.may_send_payment_link).toBe(false);

  const remaining: IntakeField[] = ['nombre', 'apellido', 'correo', 'telefono'];
  for (let index = 0; index < 4; index += 1) {
    const latestAssistantText = turns.at(-1)!.evidence.authorizedMessages.join('\n');
    const chosen = nextSeparateIntakeReply(latestAssistantText, remaining);
    intakeAdaptation.push({ requested: chosen.field, customer: chosen.customer });
    remaining.splice(remaining.indexOf(chosen.field), 1);
    result = await send(chosen.customer, remaining.length === 0);
    expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
    expect(result.db.state?.selectedPaymentPlan).toBe('one_time');
    expect(result.db.state?.callPreference).toBe(callPreferenceAfterDecline);
    expect(result.context.capabilities?.intake_missing).toEqual(remaining);
    expect(result.context.capabilities?.may_send_payment_link).toBe(remaining.length === 0);
  }

  writeWorkflowReportV1('workflow-telegram-regression', {
    ...identity,
    case_id: 'telegram_photography_call_first_cash_link',
    scenario_role: 'failed_canary_regression',
    status: 'observed_before_final_assertions',
    turns,
    db: result.db,
    db_checkpoints: dbCheckpoints,
    claim_checkpoints: claimCheckpoints,
    context_checkpoints: contextCheckpoints,
    intake_adaptation: intakeAdaptation,
    transcript: turns.flatMap((turn) => [
      { role: 'user', text: turn.customer },
      ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant', text })),
    ]),
  });

  expect(turns).toHaveLength(11);
  expect(new Set(intakeAdaptation.map((item) => item.requested)).size).toBe(4);
  expect(result.db.contact?.name).toBe('Inés Valdés');
  expect(result.db.contact?.email).toBe('ines.valdes@example.test');
  expect(result.db.contact?.declaredPhone).toBe('+13055550176');
  expect(result.db.contact?.phone).toBe(identity.phoneE164);
  expect(result.db.contact?.phoneIsSynthetic).toBe(true);
  expect(result.db.state?.stage).toBe('payment_link_sent');
  expect(result.db.state?.awaitingReply).toBe('none');
  expect(result.db.state?.callOfferCount).toBe(callOfferCountBeforeDecline);
  expect(result.db.recordedLinks).toEqual([expectedLink]);
  expect(result.db.deliveredLinks, 'canonical link needs durable correlated adapter delivery')
    .toEqual([expectedLink]);
  const paymentDecisions = result.db.decisions
    .filter((decision) => decision.businessActionType === 'send_payment_link');
  expect(paymentDecisions).toHaveLength(1);
  expect(paymentDecisions[0]?.turnId).toBe(result.evidence.turnId);
  const outbound = result.db.outbound.find((item) => (
    item.turnId === result.evidence.turnId && item.content.includes(expectedLink)
  ));
  expect(outbound).toBeDefined();
  expect(result.evidence.adapterCaptures.some((capture) => outbound
    && outbound.authorizedOutboundId === outbound.id
    && capture.outboundId === outbound.id
    && capture.turnId === outbound.turnId
    && capture.traceId === outbound.traceId
    && capture.conversationId === outbound.externalConversationId
    && capture.providerMessageId === outbound.providerMessageId
    && capture.content === outbound.content)).toBe(true);
}, 360_000);
