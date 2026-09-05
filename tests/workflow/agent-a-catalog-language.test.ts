import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';

const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
const previousKey = secrets.DEEPSEEK_API_KEY;

const cases = [
  {
    id: 'foto',
    customer: 'Quiero un curso de foto.',
    expectedCodes: ['fotografia_profesional', 'fotografia_celulares_tiendas_online'],
  },
  {
    id: 'ingles',
    customer: '¿Tienen cursos de inglés?',
    expectedCodes: ['ingles_1', 'ingles_2', 'ingles_3'],
  },
  {
    id: 'fotografia',
    customer: 'Quiero estudiar fotografía.',
    expectedCodes: ['fotografia_profesional', 'fotografia_celulares_tiendas_online'],
  },
  {
    id: 'fotgrafia',
    customer: '¿Tienen fotgrafia?',
    expectedCodes: ['fotografia_profesional', 'fotografia_celulares_tiendas_online'],
  },
  {
    id: 'curso_inexistente',
    customer: '¿Tienen Medicina? Si no, recomendame algo con salida laboral.',
    expectedCodes: ['especialista_ventas', 'excel_integral', 'marketing_digital'],
  },
] as const;

type CatalogIdentity = {
  readonly code: string;
  readonly fact_id: string;
  readonly display_name: string;
  readonly area_code: string | null;
};

let activeCase: (typeof cases)[number] | null = null;
let observedCatalog: readonly CatalogIdentity[] = [];

function proposalFor(
  item: (typeof cases)[number],
  catalog: readonly CatalogIdentity[],
  repairOf: AgentATurnProposalV1['repair_of'],
): AgentATurnProposalV1 {
  const offerings = item.expectedCodes.map((code) => {
    const offering = catalog.find((candidate) => candidate.code === code);
    if (!offering) throw new Error(`EXPECTED_OFFERING_NOT_VISIBLE:${code}`);
    return offering;
  });
  const names = offerings.map((offering) => offering.display_name);
  const message = item.id === 'curso_inexistente'
    ? `Medicina no figura entre los cursos disponibles. Por tu objetivo laboral, te recomiendo ${names.join(', ')}. ¿Cuál querés conocer mejor?`
    : `Tenemos ${names.join(' y ')}. ¿Cuál de estas opciones se acerca más a lo que buscás?`;
  return {
    schema_version: 1,
    move: {
      schema_version: 1,
      move: 'browse_catalog',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.99,
    },
    response: { messages: [message], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: offerings.map((offering) => offering.fact_id),
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: repairOf,
  };
}

function authorizedContext(evidence: WorkflowTurnEvidenceV1): {
  readonly catalog?: { readonly available_offerings?: readonly CatalogIdentity[] };
} {
  const request = evidence.httpExchanges.find((exchange) => exchange.boundary === 'deepseek')?.requestBody;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('CATALOG_LANGUAGE_MODEL_REQUEST_MISSING');
  }
  const instructions = (request as Record<string, unknown>).instructions;
  if (typeof instructions !== 'string') throw new Error('CATALOG_LANGUAGE_INSTRUCTIONS_MISSING');
  const serialized = instructions.match(
    /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
  )?.[1];
  if (!serialized) throw new Error('CATALOG_LANGUAGE_CONTEXT_MISSING');
  return JSON.parse(serialized) as {
    readonly catalog?: { readonly available_offerings?: readonly CatalogIdentity[] };
  };
}

beforeAll(async () => {
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.protocol).toBe('http:');
  expect(backend.port).toMatch(/^32\d\d$/u);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  const fetchLocal = globalThis.fetch;
  const readiness = await fetchLocal(`${apiBaseUrl}/api/ready`, {
    signal: AbortSignal.timeout(4_000),
  });
  expect(readiness.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
  secrets.DEEPSEEK_API_KEY = 'workflow-fixture-no-credentials';
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === backend.origin) return fetchLocal(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') {
      throw new Error('UNEXPECTED_EXTERNAL_WORKFLOW_REQUEST');
    }
    if (!activeCase) throw new Error('CATALOG_LANGUAGE_CASE_NOT_SELECTED');
    const payload = JSON.parse(String(init?.body)) as { instructions?: string };
    const serialized = payload.instructions?.match(
      /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
    )?.[1];
    if (!serialized) throw new Error('CATALOG_LANGUAGE_CONTEXT_MISSING');
    const context = JSON.parse(serialized) as {
      readonly catalog?: { readonly available_offerings?: readonly CatalogIdentity[] };
      readonly turn_rejection?: { readonly rejection_id?: string };
    };
    observedCatalog = context.catalog?.available_offerings ?? [];
    const repairOf = context.turn_rejection?.rejection_id
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 as const }
      : null;
    const proposal = proposalFor(activeCase, observedCatalog, repairOf);
    return new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
      }],
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

describe('lenguaje informal de catálogo por el workflow real', () => {
  it.each(cases)('$id usa sólo identidades canónicas y deja un siguiente paso', async (item) => {
    activeCase = item;
    observedCatalog = [];
    const suffix = String(Date.now() + Math.floor(Math.random() * 1000)).slice(-10);
    const identity = {
      conversationId: `catalog-language-${item.id}-${randomUUID()}`,
      userId: `catalog-language-user-${randomUUID()}`,
      phoneE164: `+999${suffix}`,
      providerMode: 'fixture' as const,
    };

    const evidence = await runWorkflowTurnV1({ ...identity, text: item.customer });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl,
      externalConversationId: identity.conversationId,
      adapterCaptures: evidence.adapterCaptures,
    });
    const context = authorizedContext(evidence);
    const available = context.catalog?.available_offerings ?? [];

    expect(available).toHaveLength(40);
    expect(observedCatalog).toEqual(available);
    expect(item.expectedCodes.every((code) => available.some((offering) => offering.code === code)))
      .toBe(true);
    expect(evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek'))
      .toHaveLength(1);
    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.authorizedMessages).toHaveLength(1);
    expect(evidence.adapterCaptures).toHaveLength(1);
    expect(evidence.authorizedMessages[0]).toMatch(/[?¿]/u);
    for (const code of item.expectedCodes) {
      const name = available.find((offering) => offering.code === code)?.display_name;
      expect(name).toBeTruthy();
      expect(evidence.authorizedMessages.join('\n')).toContain(name!);
    }
    expect(db.state?.selectedOfferingCode).toBeNull();
    expect(db.state?.callOfferCount).toBe(0);
    expect(db.outboundCount).toBe(1);
    expect(db.decisions).toHaveLength(1);
  });
});
