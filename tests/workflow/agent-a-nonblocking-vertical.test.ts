import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import {
  runWorkflowBurstV1,
  runWorkflowTurnV1,
  type WorkflowTurnEvidenceV1,
} from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

/**
 * Vertical certification for the boundaries introduced by the nonblocking
 * orchestrator change. The production workflow, actions, signed HTTP,
 * backend service and PostgreSQL are real; only the paid DeepSeek edge is a
 * deterministic HTTP fixture.
 */
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
const previousKey = secrets.DEEPSEEK_API_KEY;
const db = openLocalTestDatabase();

type FixtureMode =
  | 'conversation'
  | 'mixed_call'
  | 'multi_course_repair'
  | 'missing_call_data'
  | 'missing_plan'
  | 'timeout';
let fixtureMode: FixtureMode = 'conversation';
let deepSeekRequests = 0;

function proposal(input: {
  readonly move: AgentATurnProposalV1['move']['move'];
  readonly messages: readonly [string, ...string[]];
  readonly courseReference?: string;
  readonly secondaryMoves?: AgentATurnProposalV1['move']['secondary_moves'];
  readonly action?: AgentATurnProposalV1['proposed_action'];
  readonly factIds?: readonly string[];
}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1,
      move: input.move,
      secondary_moves: input.secondaryMoves ?? [],
      vetoes: [],
      confidence: 0.99,
      ...(input.courseReference ? { course_reference: input.courseReference } : {}),
    },
    response: { messages: [...input.messages] },
    proposed_action: input.action ?? { type: 'none' },
    used_fact_ids: [...(input.factIds ?? [])],
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: null,
  };
}

function fixtureProposal(rejectionId?: string): AgentATurnProposalV1 {
  switch (fixtureMode) {
    case 'mixed_call':
      return rejectionId
        ? {
            ...proposal({
              move: 'request_call',
              secondaryMoves: ['provide_contact_details'],
              messages: [
                'Para hablar de Marketing Digital y Community Manager, pásame un número con código de país y coordinamos la llamada.',
              ],
              factIds: [
                'offering:marketing_digital:name:v1',
                'offering:community_manager:name:v1',
              ],
            }),
            repair_of: { rejection_id: rejectionId, attempt: 1 },
          }
        : proposal({
            move: 'browse_catalog',
            secondaryMoves: ['request_call'],
            messages: [
              'Puedo orientarte con Marketing Digital y Community Manager.',
              'Pásame un número con código de país y coordinamos la llamada.',
            ],
            action: { type: 'request_call_now', reason: 'direct_request' },
            factIds: [
              'offering:marketing_digital:name:v1',
              'offering:community_manager:name:v1',
            ],
          });
    case 'multi_course_repair': {
      const selected = rejectionId
        ? proposal({
            move: 'browse_catalog',
            messages: [
              'Sí, puedes anotarte en más de un curso.',
              'Quieres que comparemos Community Manager y Marketing Digital?',
            ],
            factIds: [
              'offering:community_manager:name:v1',
              'offering:marketing_digital:name:v1',
            ],
          })
        : proposal({
            move: 'browse_catalog',
            messages: [
              'Sí, puedes anotarte en más de un curso.',
              'Community Manager es ideal para empezar desde cero y conseguir clientes.',
            ],
            factIds: [
              'offering:community_manager:name:v1',
              'offering:marketing_digital:name:v1',
            ],
          });
      return {
        ...selected,
        repair_of: rejectionId ? { rejection_id: rejectionId, attempt: 1 } : null,
      };
    }
    case 'missing_call_data':
      return proposal({
        move: 'request_call',
        secondaryMoves: ['provide_contact_details'],
        messages: [
          'Dale. Antes de llamarte necesito tu nombre, apellido y un número con código de país.',
        ],
        action: { type: 'request_call_now', reason: 'direct_request' },
      });
    case 'missing_plan':
      return proposal({
        move: 'ask_payment_options',
        courseReference: 'Inglés 1',
        messages: [
          'Te preparo el enlace de Inglés 1.',
          '¿Preferís 12 pagos, 6 pagos o pago único?',
        ],
        factIds: ['offering:ingles_1:name:v1'],
      });
    case 'conversation':
      return proposal({
        move: 'unknown',
        messages: ['Te sigo. Contame qué querés resolver y avanzamos desde ahí.'],
      });
    case 'timeout':
      throw new Error('TIMEOUT_FIXTURE_HAS_NO_PROPOSAL');
  }
}

function identity(prefix: string) {
  return {
    conversationId: `${prefix}-${randomUUID()}`,
    userId: `${prefix}-user-${randomUUID()}`,
    phoneE164: `+999${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-10)}`,
    providerMode: 'fixture' as const,
  };
}

async function decisionReasonCodes(evidence: WorkflowTurnEvidenceV1, conversationId: string) {
  const db = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: conversationId,
    adapterCaptures: evidence.adapterCaptures,
  });
  return db.decisions.map((decision) => decision.reasonCode);
}

async function latestDecisionDiagnostics(
  evidence: WorkflowTurnEvidenceV1,
  conversationId: string,
) {
  const persisted = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: conversationId,
    adapterCaptures: evidence.adapterCaptures,
  });
  const turnId = persisted.decisions.at(-1)?.turnId;
  if (!turnId) return null;
  const rows = await db<Array<{ diagnostics: unknown }>>`
    SELECT diagnostics
    FROM agent_decisions
    WHERE turn_id = ${turnId}::uuid
  `;
  return rows[0]?.diagnostics ?? null;
}

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.protocol).toBe('http:');
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.port).toMatch(/^32\d\d$/u);
  const fetchLocal = globalThis.fetch;
  const ready = await fetchLocal(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
  expect(ready.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'workflow-fixture-no-credentials';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return fetchLocal(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') {
      throw new Error('UNEXPECTED_EXTERNAL_WORKFLOW_REQUEST');
    }
    deepSeekRequests += 1;
    if (fixtureMode === 'timeout') {
      return new Response('{"error":"fixture_timeout"}', { status: 503 });
    }
    const body = JSON.parse(String(init?.body)) as { instructions?: string };
    const serialized = body.instructions?.match(
      /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
    )?.[1];
    if (!serialized) throw new Error('AUTHORIZED_CONTEXT_MISSING');
    const context = JSON.parse(serialized) as {
      readonly turn_rejection?: { readonly rejection_id: string };
    };
    const selected = fixtureProposal(context.turn_rejection?.rejection_id);
    const effective = {
      ...selected,
      repair_of: context.turn_rejection
        ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 as const }
        : null,
    };
    return new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(effective) }],
      }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      fixture: true,
    }), { headers: { 'content-type': 'application/json' } });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = previousKey;
  await db.end();
});

describe('Agent A nonblocking vertical production path', () => {
  it('treats consecutive fragments as one logical turn and does not manufacture MODEL_UNAVAILABLE', async () => {
    fixtureMode = 'conversation';
    deepSeekRequests = 0;
    const id = identity('nonblocking-burst');
    const evidence = await runWorkflowBurstV1({
      ...id,
      messages: [
        { text: 'entonces', delayMs: 0 },
        { text: 'decime q onda', delayMs: 80 },
      ],
    });

    expect(evidence.burst.claimed_message_count).toBe(2);
    expect(evidence.authorizedMessages).toHaveLength(1);
    expect(evidence.errorCode).toBeNull();
    expect(await decisionReasonCodes(evidence, id.conversationId)).not.toContain('MODEL_UNAVAILABLE');
  }, 120_000);

  it('keeps useful model prose when unsupported detail and call action are rejected together', async () => {
    fixtureMode = 'mixed_call';
    deepSeekRequests = 0;
    const id = identity('nonblocking-mixed-call');
    const evidence = await runWorkflowTurnV1({
      ...id,
      text: 'Estoy entre Marketing Digital y Community Manager. Quiero que me llamen.',
    });

    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.join('\n'))
      .toMatch(/(?:n[uú]mero|tel[eé]fono)[\s\S]*c[oó]digo de pa[ií]s/iu);
    expect(evidence.actions.some((action) => action.name === 'dispatchCall')).toBe(false);
    expect(await decisionReasonCodes(evidence, id.conversationId)).not.toContain('MODEL_UNAVAILABLE');
  }, 120_000);

  it('returns a rejected multi-course draft to Agent A and commits its own repair', async () => {
    fixtureMode = 'multi_course_repair';
    deepSeekRequests = 0;
    const id = identity('nonblocking-multi-course');
    const evidence = await runWorkflowTurnV1({
      ...id,
      text: 'Estoy entre Community Manager y Marketing Digital. Me puedo anotar en los dos?',
    });

    expect(deepSeekRequests).toBe(2);
    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.join('\n')).toContain('puedes anotarte en más de un curso');
    expect(evidence.authorizedMessages.join('\n')).not.toContain('conseguir clientes');
    expect(await decisionReasonCodes(evidence, id.conversationId)).not.toContain('MODEL_UNAVAILABLE');
  }, 120_000);

  it.each([
    {
      mode: 'missing_call_data' as const,
      text: 'Llamame ahora',
      expected: /nombre[\s\S]*apellido[\s\S]*(?:n[uú]mero|tel[eé]fono)/iu,
    },
    {
      mode: 'missing_plan' as const,
      text: 'Mandame el link para Inglés 1',
      expected: /12 pagos[\s\S]*6 pagos[\s\S]*pago [uú]nico/iu,
    },
  ])('asks for the recoverable missing data in $mode without blocking the conversation', async (item) => {
    fixtureMode = item.mode;
    deepSeekRequests = 0;
    const id = identity(`nonblocking-${item.mode}`);
    const evidence = await runWorkflowTurnV1({ ...id, text: item.text });

    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages.join('\n')).toMatch(item.expected);
    expect(await decisionReasonCodes(evidence, id.conversationId)).not.toContain('MODEL_UNAVAILABLE');
  }, 120_000);

  it('makes exactly two DeepSeek attempts and then emits one bounded technical notice', async () => {
    fixtureMode = 'timeout';
    deepSeekRequests = 0;
    const id = identity('nonblocking-timeout');
    const evidence = await runWorkflowTurnV1({
      ...id,
      text: 'Necesito información de un curso',
    });

    expect(deepSeekRequests).toBe(2);
    expect(evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek'))
      .toHaveLength(2);
    expect(evidence.authorizedMessages).toHaveLength(1);
    expect(evidence.actions.map((action) => action.name)).not.toContain('planConversation');
    expect(await latestDecisionDiagnostics(evidence, id.conversationId)).toMatchObject({
      schema_version: 1,
      generation_attempts: 2,
      failure_stage: 'provider_generation',
      failure_codes: ['BRAIN_DEEPSEEK_HTTP_503'],
      action_status: 'none',
    });
  }, 120_000);
});
