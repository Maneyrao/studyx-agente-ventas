import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-brain-v1';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import {
  readWorkflowDbEvidenceV1,
  type WorkflowDbEvidenceV1,
} from '../helpers/agent-a-workflow-db-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';

const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';

interface CatalogIdentity {
  readonly code: string;
  readonly fact_id: string;
  readonly display_name: string;
  readonly area_code: string | null;
}

interface HeldoutStep {
  readonly customer: string;
  readonly selectedOfferingCode: string | null;
}

interface HeldoutCase {
  readonly id: string;
  readonly cluster: 'photo_choice' | 'english_options' | 'misspelled_photography'
    | 'absent_recovery' | 'course_change' | 'ordinal_reference';
  readonly steps: readonly HeldoutStep[];
  readonly finalCallOfferCount: 0 | 1;
}

const heldoutCases: readonly HeldoutCase[] = [
  {
    id: 'semantic_v3_photo_store_choice',
    cluster: 'photo_choice',
    steps: [
      {
        customer: 'Para mostrar productos de mi negocio, ¿tienen algo de foto con celular y también fotografía con cámara? No sé cuál elegir.',
        selectedOfferingCode: null,
      },
      {
        customer: 'Me quedo con la del celular para la tienda. ¿Cómo es?',
        selectedOfferingCode: 'fotografia_celulares_tiendas_online',
      },
    ],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v3_english_options_before_choice',
    cluster: 'english_options',
    steps: [{
      customer: 'Necesito saber qué cursos de inglés ofrecen y cuál sería el punto de partida; todavía no elegí nivel.',
      selectedOfferingCode: null,
    }],
    finalCallOfferCount: 0,
  },
  {
    id: 'semantic_v3_misspelled_professional_photography',
    cluster: 'misspelled_photography',
    steps: [{
      customer: 'Busco el curso de fotgrafia profecional. ¿Se puede cursar online?',
      selectedOfferingCode: 'fotografia_profesional',
    }],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v3_absent_console_repair',
    cluster: 'absent_recovery',
    steps: [{
      customer: '¿Tienen un curso para reparar consolas de videojuegos? Si no existe, recomendame una o dos opciones para arreglar tecnología.',
      selectedOfferingCode: null,
    }],
    finalCallOfferCount: 0,
  },
  {
    id: 'semantic_v3_explicit_change_to_community',
    cluster: 'course_change',
    steps: [
      {
        customer: 'Quiero arrancar con Marketing Digital. Contame de ese curso.',
        selectedOfferingCode: 'marketing_digital',
      },
      {
        customer: 'Pensándolo mejor, cambialo por Community Manager. ¿De qué se trata?',
        selectedOfferingCode: 'community_manager',
      },
    ],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v3_ordinal_course_reference',
    cluster: 'ordinal_reference',
    steps: [
      {
        customer: 'Estoy entre Instalación de Aires Acondicionados y Energía Solar Fotovoltaica. ¿Me ubicás con esas dos opciones?',
        selectedOfferingCode: null,
      },
      {
        customer: 'La segunda me interesa más. ¿Cuántas clases tiene?',
        selectedOfferingCode: 'energia_solar_fotovoltaica',
      },
    ],
    finalCallOfferCount: 1,
  },
] as const;

const completedCases: Array<{
  readonly case_id: string;
  readonly cluster: HeldoutCase['cluster'];
  readonly turns: readonly { readonly customer: string; readonly evidence: WorkflowTurnEvidenceV1 }[];
  readonly db_checkpoints: readonly WorkflowDbEvidenceV1[];
  readonly transcript: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
}> = [];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function authorizedContext(evidence: WorkflowTurnEvidenceV1): {
  readonly catalog?: { readonly available_offerings?: readonly CatalogIdentity[] };
} | null {
  const request = evidence.httpExchanges.find((exchange) => exchange.boundary === 'deepseek')?.requestBody;
  const instructions = record(request)?.instructions;
  if (typeof instructions !== 'string') return null;
  const serialized = instructions.match(
    /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
  )?.[1];
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as ReturnType<typeof authorizedContext>;
  } catch {
    return null;
  }
}

function technicalFallbackEffects(evidence: WorkflowTurnEvidenceV1): readonly string[] {
  return evidence.httpExchanges.flatMap((exchange) => {
    if (exchange.boundary !== 'backend' || !exchange.url.endsWith('/decision')) return [];
    const reason = record(record(exchange.responseBody)?.conversation_effects)?.technical_fallback_reason;
    return typeof reason === 'string' ? [reason] : [];
  });
}

beforeAll(async () => {
  expect(heldoutCases).toHaveLength(6);
  expect(new Set(heldoutCases.map((item) => item.cluster)).size).toBe(6);
  expect(AGENT_A_BRAIN_PROMPT_VERSION).toBe('studyx-agent-a-brain-v23');
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
  const backend = new URL(apiBaseUrl);
  expect(backend.hostname).toBe('127.0.0.1');
  expect(backend.protocol).toBe('http:');
  expect(backend.port).toMatch(/^32\d\d$/u);
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  const readiness = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
  expect(readiness.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
});

afterAll(() => {
  writeWorkflowReportV1('workflow-semantic-heldout-v3-campaign', {
    scenario_role: 'semantic_catalog_heldout_v3',
    provider: 'deepseek-direct',
    model: 'deepseek-v4-flash',
    prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
    declared_case_count: heldoutCases.length,
    completed_case_count: completedCases.length,
    cases: completedCases,
  });
});

describe('six frozen semantic heldout v3 conversations through processInboundTurn', () => {
  it.each(heldoutCases)('$id', async (testCase) => {
    const identity = {
      conversationId: `semantic-heldout-v3-${testCase.id}-${randomUUID()}`,
      userId: `semantic-heldout-v3-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-10)}`,
      providerMode: 'live' as const,
    };
    const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
    const checkpoints: WorkflowDbEvidenceV1[] = [];
    let visibleCatalog: readonly CatalogIdentity[] = [];

    for (const step of testCase.steps) {
      const evidence = await runWorkflowTurnV1({ ...identity, text: step.customer });
      turns.push({ customer: step.customer, evidence });
      const db = await readWorkflowDbEvidenceV1({
        databaseUrl,
        externalConversationId: identity.conversationId,
        adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
      });
      checkpoints.push(db);
      if (visibleCatalog.length === 0) {
        visibleCatalog = authorizedContext(evidence)?.catalog?.available_offerings ?? [];
      }
    }

    const transcript = turns.flatMap((turn) => [
      { role: 'user' as const, text: turn.customer },
      ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant' as const, text })),
    ]);
    completedCases.push({
      case_id: testCase.id,
      cluster: testCase.cluster,
      turns,
      db_checkpoints: checkpoints,
      transcript,
    });
    writeWorkflowReportV1('workflow-semantic-heldout-v3-case', {
      scenario_role: 'semantic_catalog_heldout_v3',
      provider: 'deepseek-direct',
      model: 'deepseek-v4-flash',
      prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
      case_id: testCase.id,
      cluster: testCase.cluster,
      ...identity,
      turns,
      db_checkpoints: checkpoints,
      transcript,
    });

    expect.soft(visibleCatalog).toHaveLength(40);
    for (const [index, step] of testCase.steps.entries()) {
      const evidence = turns[index]!.evidence;
      const db = checkpoints[index]!;
      const calls = evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek');
      const decision = db.decisions.find((item) => item.turnId === evidence.turnId);
      const outbound = db.outbound.find((item) => item.id === evidence.outboundId);
      const capture = evidence.adapterCaptures[0];
      expect.soft(evidence.errorCode).toBeNull();
      expect.soft(evidence.commitSucceeded).toBe(true);
      expect.soft(evidence.legacyPlanRequests).toBe(0);
      expect.soft(calls.length).toBeGreaterThanOrEqual(1);
      expect.soft(calls.length).toBeLessThanOrEqual(2);
      expect.soft(evidence.authorizedMessages.length, 'silence is never a passing turn').toBeGreaterThan(0);
      expect.soft(evidence.adapterCaptures).toHaveLength(1);
      expect.soft(technicalFallbackEffects(evidence)).toEqual([]);
      expect.soft(decision?.responseType).not.toBe('technical_fallback');
      expect.soft(db.state?.selectedOfferingCode).toBe(step.selectedOfferingCode);
      expect.soft(db.decisions).toHaveLength(index + 1);
      expect.soft(db.outboundCount).toBe(index + 1);
      expect.soft(evidence.authorizedMessages.join('\n')).not.toMatch(/https?:\/\//u);
      expect.soft(evidence.authorizedMessages.join('\n')).toMatch(/[?¿]|\bllamad[ao]\b/iu);
      expect.soft(outbound).toBeDefined();
      if (capture && outbound) {
        expect.soft(capture).toMatchObject({
          outboundId: outbound.id,
          turnId: outbound.turnId,
          traceId: outbound.traceId,
          conversationId: identity.conversationId,
          content: outbound.content,
        });
      }
      for (const message of evidence.authorizedMessages) {
        const normalizedMessage = normalize(message);
        const namedOfferings = visibleCatalog.filter((offering) => (
          normalizedMessage.includes(normalize(offering.display_name))
        ));
        expect.soft(namedOfferings.length, 'the agent must never dump the catalog').toBeLessThanOrEqual(3);
      }
    }

    const assistantText = transcript
      .filter((item) => item.role === 'assistant')
      .map((item) => item.text)
      .join('\n');
    const normalizedAssistant = normalize(assistantText);
    expect.soft(normalizedAssistant).not.toMatch(/recibi tu mensaje.{0,80}demora|proba nuevamente/iu);
    expect.soft(checkpoints.at(-1)?.state?.callOfferCount).toBe(testCase.finalCallOfferCount);

    if (testCase.cluster === 'photo_choice') {
      expect.soft(normalizedAssistant).toContain('fotografia profesional');
      expect.soft(normalizedAssistant).toContain('fotografia con celulares para tiendas online');
      expect.soft(normalizedAssistant).not.toMatch(/no (?:tenemos|ofrecemos|figura).{0,30}fotograf/iu);
    }
    if (testCase.cluster === 'english_options') {
      expect.soft(normalizedAssistant).toContain('ingles 1');
      expect.soft(normalizedAssistant).toContain('ingles 2');
      expect.soft(normalizedAssistant).toContain('ingles 3');
      expect.soft(normalizedAssistant).not.toMatch(/no (?:tenemos|ofrecemos|figura).{0,30}ingles/iu);
    }
    if (testCase.cluster === 'misspelled_photography') {
      expect.soft(normalizedAssistant).toContain('fotografia profesional');
      expect.soft(normalizedAssistant).toMatch(/100% online|curs.{0,20}online/iu);
    }
    if (testCase.cluster === 'absent_recovery') {
      const mentioned = visibleCatalog.filter((offering) => (
        normalizedAssistant.includes(normalize(offering.display_name))
      ));
      expect.soft(normalizedAssistant).toContain('consola');
      expect.soft(normalizedAssistant).toMatch(/no (?:tenemos|ofrecemos|figura|esta)/iu);
      expect.soft(mentioned.length).toBeGreaterThanOrEqual(1);
      expect.soft(mentioned.length).toBeLessThanOrEqual(2);
    }
    if (testCase.cluster === 'course_change') {
      expect.soft(normalize(turns[1]!.evidence.authorizedMessages.join('\n')))
        .toContain('community manager');
    }
    if (testCase.cluster === 'ordinal_reference') {
      const answer = normalize(turns[1]!.evidence.authorizedMessages.join('\n'));
      expect.soft(answer).toContain('energia solar fotovoltaica');
      expect.soft(answer).toMatch(/\b8\s+clases\b/u);
    }
  }, 120_000);
});
