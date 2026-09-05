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
  readonly cluster: 'photography_family' | 'english_levels' | 'misspelling'
    | 'absent_recovery' | 'course_change' | 'reference_continuity';
  readonly steps: readonly HeldoutStep[];
  readonly finalCallOfferCount: 0 | 1;
}

const heldoutCases: readonly HeldoutCase[] = [
  {
    id: 'semantic_v2_photo_register_choice',
    cluster: 'photography_family',
    steps: [
      {
        customer: 'Che, ¿hay algo para aprender a sacar fotos con el celu o con una cámara posta? Estoy medio perdido.',
        selectedOfferingCode: null,
      },
      {
        customer: 'La de cámara posta, la profesional.',
        selectedOfferingCode: 'fotografia_profesional',
      },
    ],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v2_english_starting_point',
    cluster: 'english_levels',
    steps: [{
      customer: 'Estoy con ganas de estudiar inglés, pero eso de 1, 2 y 3 me marea: ¿por dónde arranco?',
      selectedOfferingCode: null,
    }],
    finalCallOfferCount: 0,
  },
  {
    id: 'semantic_v2_makeup_typo',
    cluster: 'misspelling',
    steps: [{
      customer: 'Buenas, ¿me pasás info del curso de maquiaje profecional?',
      selectedOfferingCode: 'maquillaje_profesional',
    }],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v2_absent_drones_recovery',
    cluster: 'absent_recovery',
    steps: [{
      customer: '¿Dan algo para arreglar drones? Si no, ¿qué opciones técnicas tienen para aprender a reparar equipos?',
      selectedOfferingCode: null,
    }],
    finalCallOfferCount: 0,
  },
  {
    id: 'semantic_v2_explicit_course_change',
    cluster: 'course_change',
    steps: [
      {
        customer: 'Quiero conocer Paisajismo y Jardinería.',
        selectedOfferingCode: 'paisajismo_jardineria',
      },
      {
        customer: 'Cambié de idea: prefiero Energía Solar Fotovoltaica; contame de esa.',
        selectedOfferingCode: 'energia_solar_fotovoltaica',
      },
    ],
    finalCallOfferCount: 1,
  },
  {
    id: 'semantic_v2_pronoun_reference',
    cluster: 'reference_continuity',
    steps: [
      {
        customer: 'Me interesa Excel Integral; ¿sirve para alguien que recién empieza?',
        selectedOfferingCode: 'excel_integral',
      },
      {
        customer: '¿Y cuánto dura ese?',
        selectedOfferingCode: 'excel_integral',
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

function authorizedContext(evidence: WorkflowTurnEvidenceV1): {
  readonly catalog?: {
    readonly available_offerings?: readonly CatalogIdentity[];
    readonly selected_offering?: { readonly code?: string; readonly display_name?: string } | null;
  };
} {
  const request = evidence.httpExchanges.find((exchange) => exchange.boundary === 'deepseek')?.requestBody;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('SEMANTIC_HELDOUT_MODEL_REQUEST_MISSING');
  }
  const instructions = (request as Record<string, unknown>).instructions;
  if (typeof instructions !== 'string') throw new Error('SEMANTIC_HELDOUT_INSTRUCTIONS_MISSING');
  const serialized = instructions.match(
    /<authorized_context>\s*([\s\S]*?)\s*<\/authorized_context>/u,
  )?.[1];
  if (!serialized) throw new Error('SEMANTIC_HELDOUT_CONTEXT_MISSING');
  return JSON.parse(serialized) as ReturnType<typeof authorizedContext>;
}

beforeAll(async () => {
  expect(heldoutCases).toHaveLength(6);
  expect(new Set(heldoutCases.map((item) => item.cluster)).size).toBe(6);
  expect(AGENT_A_BRAIN_PROMPT_VERSION).toBe('studyx-agent-a-brain-v22');
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
  writeWorkflowReportV1('workflow-semantic-heldout-v2-campaign', {
    scenario_role: 'semantic_catalog_heldout_v2',
    provider: 'deepseek-direct',
    model: 'deepseek-v4-flash',
    prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
    declared_case_count: heldoutCases.length,
    completed_case_count: completedCases.length,
    cases: completedCases,
  });
});

describe('six frozen semantic heldout v2 conversations through processInboundTurn', () => {
  it.each(heldoutCases)('$id', async (testCase) => {
    const identity = {
      conversationId: `semantic-heldout-v2-${testCase.id}-${randomUUID()}`,
      userId: `semantic-heldout-v2-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-10)}`,
      providerMode: 'live' as const,
    };
    const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
    const checkpoints: WorkflowDbEvidenceV1[] = [];
    let visibleCatalog: readonly CatalogIdentity[] = [];

    for (const [index, step] of testCase.steps.entries()) {
      const evidence = await runWorkflowTurnV1({ ...identity, text: step.customer });
      turns.push({ customer: step.customer, evidence });
      const db = await readWorkflowDbEvidenceV1({
        databaseUrl,
        externalConversationId: identity.conversationId,
        adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
      });
      checkpoints.push(db);
      const context = authorizedContext(evidence);
      if (visibleCatalog.length === 0) {
        visibleCatalog = context.catalog?.available_offerings ?? [];
      }

      expect(evidence.errorCode).toBeNull();
      expect(evidence.commitSucceeded).toBe(true);
      expect(evidence.legacyPlanRequests).toBe(0);
      expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
      expect(evidence.adapterCaptures).toHaveLength(1);
      expect(evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek').length)
        .toBeGreaterThanOrEqual(1);
      expect(evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek').length)
        .toBeLessThanOrEqual(2);
      expect(db.state?.selectedOfferingCode).toBe(step.selectedOfferingCode);
      expect(db.decisions).toHaveLength(index + 1);
      expect(db.outboundCount).toBe(index + 1);
      expect(evidence.authorizedMessages.join('\n')).not.toMatch(/https?:\/\//u);
      expect(evidence.authorizedMessages.join('\n')).toMatch(/[?¿]|\bllamad[ao]\b/iu);
      const outbound = db.outbound.find((item) => item.id === evidence.outboundId);
      expect(outbound).toBeDefined();
      expect(evidence.adapterCaptures[0]).toMatchObject({
        outboundId: outbound?.id,
        turnId: outbound?.turnId,
        traceId: outbound?.traceId,
        conversationId: identity.conversationId,
        content: outbound?.content,
      });
    }

    expect(visibleCatalog).toHaveLength(40);
    const transcript = turns.flatMap((turn) => [
      { role: 'user' as const, text: turn.customer },
      ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant' as const, text })),
    ]);
    const assistantText = transcript
      .filter((item) => item.role === 'assistant')
      .map((item) => item.text)
      .join('\n');
    const normalizedAssistant = normalize(assistantText);
    for (const turn of turns) {
      for (const message of turn.evidence.authorizedMessages) {
        const normalizedMessage = normalize(message);
        const namedOfferings = visibleCatalog.filter((offering) => (
          normalizedMessage.includes(normalize(offering.display_name))
        ));
        expect(namedOfferings.length, 'the agent must never dump the complete catalog').toBeLessThanOrEqual(3);
      }
    }

    if (testCase.cluster === 'photography_family') {
      expect(normalizedAssistant).toContain('fotografia profesional');
      expect(normalizedAssistant).toContain('fotografia con celulares para tiendas online');
      expect(normalizedAssistant).not.toMatch(/no (?:tenemos|ofrecemos|figura).{0,30}fotograf/iu);
    }
    if (testCase.cluster === 'english_levels') {
      expect(normalizedAssistant).toContain('ingles 1');
      expect(normalizedAssistant).toContain('ingles 2');
      expect(normalizedAssistant).toContain('ingles 3');
      expect(normalizedAssistant).not.toMatch(/no (?:tenemos|ofrecemos|figura).{0,30}ingles/iu);
    }
    if (testCase.cluster === 'misspelling') {
      expect(normalizedAssistant).toContain('maquillaje profesional');
    }
    if (testCase.cluster === 'absent_recovery') {
      const mentioned = visibleCatalog.filter((offering) => (
        normalizedAssistant.includes(normalize(offering.display_name))
      ));
      expect(normalizedAssistant).toMatch(/drones?/iu);
      expect(normalizedAssistant).toMatch(/no (?:tenemos|ofrecemos|figura|esta)/iu);
      expect(mentioned.length).toBeGreaterThanOrEqual(1);
      expect(mentioned.length).toBeLessThanOrEqual(3);
    }
    if (testCase.cluster === 'course_change') {
      expect(normalize(turns[1]!.evidence.authorizedMessages.join('\n'))).toContain('energia solar fotovoltaica');
      expect(turns[1]!.evidence.authorizedMessages.join('\n')).not.toMatch(/Paisajismo y Jardiner[ií]a/iu);
    }
    if (testCase.cluster === 'reference_continuity') {
      expect(normalize(turns[1]!.evidence.authorizedMessages.join('\n'))).toContain('excel integral');
      expect(turns[1]!.evidence.authorizedMessages.join('\n')).toMatch(/\b\d+\s+clases\b/iu);
    }
    expect(checkpoints.at(-1)?.state?.callOfferCount).toBe(testCase.finalCallOfferCount);

    completedCases.push({
      case_id: testCase.id,
      cluster: testCase.cluster,
      turns,
      db_checkpoints: checkpoints,
      transcript,
    });
    writeWorkflowReportV1('workflow-semantic-heldout-v2-case', {
      scenario_role: 'semantic_catalog_heldout_v2',
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
  }, 120_000);
});
