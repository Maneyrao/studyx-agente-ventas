import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';

/** Workflow, backend y PostgreSQL reales. Sólo DeepSeek es una frontera fixture.
 * Esto certifica contratos y persistencia, nunca comprensión ni naturalidad. */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
let fixture: AgentATurnProposalV1 | 'unavailable';
const previousKey = secrets.DEEPSEEK_API_KEY;

beforeAll(async () => {
  const url = new URL(apiBaseUrl);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.protocol).toBe('http:');
  expect(url.port).toMatch(/^32\d\d$/u);
  const fetchLocal = globalThis.fetch;
  const readiness = await fetchLocal(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
  expect(readiness.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'workflow-fixture-no-credentials';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === url.origin) return fetchLocal(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_WORKFLOW_REQUEST');
    if (fixture === 'unavailable') return new Response('{"error":"fixture_unavailable"}', { status: 503 });
    if (!fixture) throw new Error('WORKFLOW_FIXTURE_NOT_SELECTED');
    const instructions = JSON.parse(String(init?.body)).instructions as string;
    const context = JSON.parse(instructions.split('<authorized_context>')[1]!.split('</authorized_context>')[0]!);
    const proposal = { ...fixture, repair_of: context.turn_rejection
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
});

function proposal(
  move: AgentATurnProposalV1['move']['move'], message: string,
  fields: Partial<AgentATurnProposalV1['move']> = {},
  action: AgentATurnProposalV1['proposed_action'] = { type: 'none' },
): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move, secondary_moves: [], vetoes: [], confidence: 0.99, ...fields },
    response: { messages: [message] }, proposed_action: action,
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
  };
}

function identity() {
  return { conversationId: `wfd-${randomUUID()}`, userId: `wfd-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
}

describe('contratos por workflow real con proveedor determinístico sin costo', () => {
  it('persiste curso/plan/teléfono, requiere autorización, respeta postergación, entrega una vez, registra pago y bloquea opt-out', async () => {
    const id = identity();
    const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
    async function send(customer: string, next: AgentATurnProposalV1) {
      fixture = next;
      const evidence = await runWorkflowTurnV1({ ...id, text: customer });
      turns.push({ customer, evidence });
      const db = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
        adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures) });
      writeWorkflowReportV1('workflow-deterministic-checkpoint', {
        provider: 'fixture', api_cost_usd: 0, scenario_role: 'contract', ...id, turns, db,
      });
      expect(evidence.errorCode, JSON.stringify(evidence)).toBeNull();
      expect(countWorkflowAvailabilityFailuresV1({ turns, db }), 'disponibilidad por turno').toBe(0);
      expect(evidence.legacyPlanRequests).toBe(0);
      return db;
    }

    let db = await send('Me interesa Redes Informáticas', proposal('select_course',
      'Hola, ¿qué te gustaría aprender en esta formación?', { course_reference: 'Redes Informáticas' }));
    expect(db.state?.selectedOfferingCode).toBe('redes_informaticas');
    db = await send('Mejor prefiero Excel Integral', proposal('select_course',
      '¿Qué uso te gustaría darle a lo que aprendas?', { course_reference: 'Excel Integral' }));
    expect(db.state?.selectedOfferingCode).toBe('excel_integral');
    db = await send('No quiero llamadas, sigamos por chat', proposal('continue_by_chat', 'Seguimos por acá. ¿Qué dudas te quedan?', { vetoes: ['call'] }));
    expect(db.state?.callPreference).toBe('chat');
    db = await send('Elijo las seis cuotas', proposal('select_payment_plan',
      '¿Querés que te prepare el enlace para avanzar?', { payment_plan: 'monthly_6' }));
    expect(db.state?.selectedPaymentPlan).toBe('monthly_6');
    expect(db.recordedLinks).toHaveLength(0);
    db = await send('Soy Celina Duarte, celina.duarte@example.test, teléfono +1 305 555 0158',
      proposal('provide_contact_details', 'Gracias por compartir tus datos. ¿Deseás avanzar con el pago?'));
    expect(db.contact?.declaredPhone).toBe('+13055550158');
    expect(db.contact?.phoneIsSynthetic).toBe(true);
    expect(db.recordedLinks, 'plan más datos sin permiso no autoriza el link').toHaveLength(0);
    expect(db.decisions.some((item) => item.businessActionType === 'send_payment_link')).toBe(false);
    db = await send('Por ahora lo dejo para la semana próxima', proposal('defer_payment',
      'Podés retomarlo cuando te resulte cómodo.', { vetoes: ['payment_link'] }));
    expect(db.state?.selectedPaymentPlan).toBe('monthly_6');
    expect(db.recordedLinks).toHaveLength(0);
    db = await send('Ahora sí, enviame el link de las seis cuotas', proposal('request_payment_link',
      'Acá tenés el enlace para avanzar con el pago.', { payment_plan: 'monthly_6' },
      { type: 'send_payment_link', offering_code: 'excel_integral', payment_plan: 'monthly_6' }));
    expect(db.deliveredLinks).toHaveLength(1);
    expect(db.deliveredLinks[0]).toContain('6m');
    const linkTurn = turns.at(-1)!;
    const replay = await runWorkflowTurnV1({ ...id, text: linkTurn.customer,
      externalMessageId: linkTurn.evidence.externalMessageId, occurredAt: linkTurn.evidence.occurredAt });
    expect(replay.turnId).toBe(linkTurn.evidence.turnId);
    expect(replay.outboundId).toBe(linkTurn.evidence.outboundId);
    expect(replay.adapterCaptures).toHaveLength(0);
    expect(replay.httpExchanges.filter((item) => item.boundary === 'deepseek')).toHaveLength(0);
    db = await send('Ya realicé el pago', proposal('report_payment',
      'Gracias por avisar. El pago todavía necesita verificarse.'));
    expect(db.state?.paymentReportedAt).not.toBeNull();
    expect(db.deliveredLinks).toHaveLength(1);
    db = await send('No me escribas más, quiero que me den de baja', proposal('unknown', 'Entendido.'));
    const optoutTurnId = turns.at(-1)!.evidence.turnId;
    expect(db.permission?.consentStatus).toBe('revoked');
    expect(db.permission?.revokedTurnId).toBe(optoutTurnId);
    db = await send('¿Y cuánto sale el curso?', proposal('ask_payment_options', '¿En qué puedo ayudarte?'));
    expect(turns.at(-1)!.evidence.adapterCaptures).toHaveLength(0);
    expect(db.decisions.filter((item) => [optoutTurnId, turns.at(-1)!.evidence.turnId].includes(item.turnId))
      .every((item) => item.businessActionType === null)).toBe(true);
    expect(turns.flatMap((turn) => turn.evidence.actions).some((action) => action.name === 'dispatchCall')).toBe(false);
    writeWorkflowReportV1('workflow-deterministic-outcomes', {
      provider: 'fixture', api_cost_usd: 0, scenario_role: 'contract', status: 'passed', ...id, turns, replay, db,
    });
  }, 240_000);

  it('una caída del modelo queda como fallo de disponibilidad aun con commit silencioso seguro', async () => {
    const id = identity();
    fixture = 'unavailable';
    const evidence = await runWorkflowTurnV1({ ...id, text: 'Me interesa Redes Informáticas' });
    const db = await readWorkflowDbEvidenceV1({ databaseUrl, externalConversationId: id.conversationId,
      adapterCaptures: evidence.adapterCaptures });
    writeWorkflowReportV1('workflow-deterministic-unavailable', { provider: 'fixture', api_cost_usd: 0,
      scenario_role: 'failure_injection', ...id, evidence, db });
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.adapterCaptures).toHaveLength(0);
    expect(db.decisions[0]?.reasonCode).toBe('BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK');
    expect(countWorkflowAvailabilityFailuresV1({ turns: [{ evidence }], db })).toBe(1);
    expect(evidence.httpExchanges.filter((item) => item.boundary === 'deepseek')).not.toHaveLength(0);
  }, 120_000);
});
