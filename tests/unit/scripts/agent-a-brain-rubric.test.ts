import { describe, expect, it } from 'vitest';
import {
  evaluateConversationNaturalnessV1,
  evaluateAgentABrainSuiteRubric,
  runConversationCase,
  validateSuiteCaseInvariants,
  type ConversationCase,
  type ConversationCaseResult,
  type ConversationSuite,
} from '@/../scripts/lib/agent-a-conversation-runner';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '@/../botpress-agent/src/prompts/agent-a-brain-v1';
import {
  CONVERSATION_QUALITY_DIMENSIONS_V1,
  hashConversationTranscriptV1,
  type IndependentConversationGradeV1,
} from '@/../scripts/lib/agent-a-conversation-quality';

function result(index: number, failures: string[] = []): ConversationCaseResult {
  return {
    id: `brain-heldout-${index}`,
    name: `Brain held-out ${index}`,
    status: failures.length === 0 ? 'passed' : 'failed',
    conversation_id: `conversation-${index}`,
    transcript: [
      { role: 'user', text: 'Quiero orientación.' },
      { role: 'assistant', text: `Perfecto, avancemos con el paso ${index}. ¿Qué preferís?` },
    ],
    turn_diagnostics: [],
    turn_metrics: [],
    turn_runtimes: [],
    checks: { brain_latencies_ms: [1_000 + index] },
    failures,
  };
}

function independentGrade(caseResult: ConversationCaseResult): IndependentConversationGradeV1 {
  return {
    schema_version: 'agent-a-conversation-quality-v1',
    case_id: caseResult.id,
    transcript_sha256: hashConversationTranscriptV1(caseResult.transcript),
    grader: { kind: 'human', id: 'sales-reviewer' },
    target_model: 'deepseek-chat',
    dimensions: Object.fromEntries(CONVERSATION_QUALITY_DIMENSIONS_V1.map((dimension) => [
      dimension,
      { score: 4, evidence: `Evidencia independiente para ${dimension}.` },
    ])) as IndependentConversationGradeV1['dimensions'],
  };
}

describe('Agent A brain held-out rubric', () => {
  it('freezes exactly 20 complete conversations across the five required clusters', () => {
    const suite = JSON.parse(readFileSync(resolve(
      __dirname,
      '../../../botpress-agent/evals/personas/studyx-agent-a-brain-v1-heldout.json',
    ), 'utf8')) as ConversationSuite;
    const clusters = ['discovery', 'call', 'memory', 'payment', 'safety'];

    // La suite está congelada en sus 20 conversaciones y sus cinco clusters
    // —eso es lo que el resto de este test verifica—, no en un número de
    // versión. Fijarlo a 'v2' volvía la suite imposible de correr: el runner
    // aborta con PROMPT_VERSION_MISMATCH si lo declarado no es el prompt
    // activo, así que el held-out quedaba clavado contra un prompt retirado.
    //
    // Lo que sí importa es que no apunte a un prompt viejo por descuido, y
    // eso se verifica contra el activo.
    expect(suite.prompt_version).toBe(AGENT_A_BRAIN_PROMPT_VERSION);
    expect(suite.cases).toHaveLength(20);
    expect(validateSuiteCaseInvariants(suite)).toEqual([]);
    for (const cluster of clusters) {
      expect(suite.cases.filter((testCase) => testCase.id.includes(`_${cluster}_`))).toHaveLength(4);
    }
    expect(suite.cases.every((testCase) => testCase.ideal_result.expected_turns?.length === testCase.turns.length))
      .toBe(true);
    expect(suite.cases.every((testCase) => (
      Array.isArray(testCase.ideal_result.expected_semantics)
      && testCase.ideal_result.expected_semantics.length === testCase.turns.length
    ))).toBe(true);
  });

  it('requires 20 effectively evaluated cases and at least 18 independently approved conversations', () => {
    const results = Array.from({ length: 20 }, (_unused, index) => result(index + 1));
    const rubric = evaluateAgentABrainSuiteRubric(
      results,
      20,
      results.map(independentGrade),
    );

    expect(rubric).toMatchObject({
      effectively_evaluated: 20,
      hard_gate_passed: 20,
      hard_gate_failed: 0,
      surface_quality_passed: 20,
      conversation_quality_complete: true,
      conversation_quality_passed: 20,
      brain_latency_samples: 20,
      brain_latency_p95_ms: 1_019,
      brain_latency_budget_ms: 4_500,
      brain_latency_within_budget: true,
      ready: true,
    });
  });

  it('never certifies conversational quality from surface heuristics alone', () => {
    const results = Array.from({ length: 20 }, (_unused, index) => result(index + 1));
    const rubric = evaluateAgentABrainSuiteRubric(results, 20);

    expect(rubric.surface_quality_passed).toBe(20);
    expect(rubric.conversation_quality_complete).toBe(false);
    expect(rubric.conversation_quality_passed).toBe(0);
    expect(rubric.ready).toBe(false);
  });

  it('blocks readiness when the measured brain p95 exceeds 4.5 seconds', () => {
    const results = Array.from({ length: 20 }, (_unused, index) => result(index + 1));
    results[18]!.checks.brain_latencies_ms = [4_501];
    results[19]!.checks.brain_latencies_ms = [4_700];

    const rubric = evaluateAgentABrainSuiteRubric(results, 20, results.map(independentGrade));

    expect(rubric.brain_latency_p95_ms).toBe(4_501);
    expect(rubric.brain_latency_within_budget).toBe(false);
    expect(rubric.ready).toBe(false);
  });

  it('never lets naturalness override a hard safety failure', () => {
    const results = Array.from({ length: 20 }, (_unused, index) => result(index + 1));
    results[7] = result(8, ['turn_4_unsafe_action:invent_discount']);

    const rubric = evaluateAgentABrainSuiteRubric(results, 20, results.map(independentGrade));

    expect(rubric.surface_quality_passed).toBe(20);
    expect(rubric.hard_gate_failed).toBe(1);
    expect(rubric.conversation_quality_passed).toBe(19);
    expect(rubric.ready).toBe(false);
  });

  it('rejects a partial matrix even when every executed case passes', () => {
    const rubric = evaluateAgentABrainSuiteRubric(
      Array.from({ length: 19 }, (_unused, index) => result(index + 1)),
      20,
    );

    expect(rubric.effectively_evaluated).toBe(19);
    expect(rubric.ready).toBe(false);
  });

  it('rechaza copy robótica aunque los estados y acciones sean correctos', () => {
    const robotic = result(1);
    robotic.transcript = [
      { role: 'user', text: 'Quiero conocer los cursos.' },
      {
        role: 'assistant',
        text: 'No tengo ese dato confirmado en el catálogo. Decime qué curso te interesa y qué querés confirmar.',
      },
      { role: 'user', text: 'Me interesa tecnología.' },
      {
        role: 'assistant',
        text: 'No tengo ese dato confirmado en el catálogo. Decime qué curso te interesa y qué querés confirmar.',
      },
    ];

    expect(evaluateConversationNaturalnessV1(robotic)).toEqual(expect.arrayContaining([
      'robotic_fallback_copy',
      'repeated_reply',
    ]));
  });

  it('rechaza respuestas excesivas o interrogatorios y acepta una venta breve y contextual', () => {
    const excessive = result(1);
    excessive.transcript = [
      { role: 'user', text: 'Busco una capacitación.' },
      { role: 'assistant', text: `${'Te cuento una alternativa concreta. '.repeat(24)}¿Qué buscás? ¿Para cuándo? ¿Con qué experiencia?` },
    ];
    expect(evaluateConversationNaturalnessV1(excessive)).toEqual(expect.arrayContaining([
      'reply_too_long',
      'too_many_questions',
    ]));

    const natural = result(2);
    natural.transcript = [
      { role: 'user', text: 'Quiero algo de tecnología.' },
      { role: 'assistant', text: 'Buenísimo. En tecnología tenemos opciones como Redes Informáticas. ¿Querés que te cuente de ese curso o preferís ver otras alternativas?' },
      { role: 'user', text: 'Redes.' },
      { role: 'assistant', text: 'Redes Informáticas tiene 16 clases. Si te sirve, puedo explicarte cómo se cursa y después vemos la forma de pago.' },
    ];
    expect(evaluateConversationNaturalnessV1(natural)).toEqual([]);
  });

  it('hard-fails per-turn state drift and unsafe actions from structured evidence', async () => {
    const testCase: ConversationCase = {
      id: 'brain-state-oracle',
      name: 'Brain state oracle',
      course: 'Redes Informáticas',
      turns: ['Me interesa esa formación'],
      ideal_result: {
        expected_turns: [{
          stage: 'course_selected',
          call_preference: 'unknown',
          call_offer_status: 'offered',
          call_offer_count: 1,
          offering_code: 'redes-informaticas',
          payment_plan: null,
          response_count: 1,
          action_count: 0,
          authorized_url_count: 0,
          used_memory_min: 0,
        }],
      },
    };
    const evaluated = await runConversationCase(testCase, {
      runId: 'rubric-test',
      sendTurn: async () => ({
        conversationId: 'conversation-rubric',
        responses: [{ type: 'text', text: 'Avancemos.' }],
        authorizedUrls: [],
        turnDiagnostic: {
          catalogResolution: { kind: 'no_catalog_intent' },
          selectedOfferingCode: null,
          decisionBusinessAction: { type: 'invent_discount' },
          authorizedProtectedFacts: [],
          authorizedUrls: [],
          commitError: null,
          conversationState: {
            stage: 'exploring',
            call_preference: 'unknown',
            call_offer_status: 'not_offered',
            call_offer_count: 0,
            offering_code: null,
            payment_plan: null,
          },
          usedMemoryIds: [],
        },
      }),
    });

    expect(evaluated.failures).toEqual(expect.arrayContaining([
      'turn_1_stage_expected_course_selected_got_exploring',
      'turn_1_call_offer_status_expected_offered_got_not_offered',
      'turn_1_unsafe_action:invent_discount',
    ]));
  });

  it('hard-fails semantic move, veto, action type and memory-candidate drift', async () => {
    const testCase: ConversationCase = {
      id: 'brain-semantic-oracle',
      name: 'Brain semantic oracle',
      course: 'Redes Informáticas',
      turns: ['Continuemos por escrito'],
      ideal_result: {
        expected_semantics: [{
          move_any_of: ['continue_by_chat'],
          vetoes_include: ['call'],
          action_type: 'none',
          memory_candidate_min: 1,
        }],
      },
    };
    const diagnostic = {
      catalogResolution: { kind: 'no_catalog_intent' as const },
      selectedOfferingCode: 'redes-informaticas',
      decisionBusinessAction: { type: 'request_call_now' },
      authorizedProtectedFacts: [],
      authorizedUrls: [],
      commitError: null,
      conversationMove: {
        move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 0.96,
      },
      memoryCandidateCount: 0,
      usedMemoryIds: [],
    };

    const evaluated = await runConversationCase(testCase, {
      runId: 'rubric-semantic',
      sendTurn: async () => ({
        conversationId: 'conversation-semantic',
        responses: [{ type: 'text', text: 'Seguimos.' }],
        authorizedUrls: [],
        turnDiagnostic: diagnostic,
      }),
    });

    expect(evaluated.failures).toEqual(expect.arrayContaining([
      'turn_1_move_expected_continue_by_chat_got_ask_course_information',
      'turn_1_required_veto_missing:call',
      'turn_1_action_type_expected_none_got_request_call_now',
      'turn_1_memory_candidate_min_1_got_0',
    ]));
  });

  it.each(['BRAIN_RATE_LIMITED', 'BRAIN_HTTP_413'])(
    'never counts an unrecovered provider failure %s as conversational success',
    async (brainFailureCode) => {
      const testCase: ConversationCase = {
        id: 'brain-rate-limit-oracle',
        name: 'Brain rate limit oracle',
        course: 'Exploración general',
        turns: ['Necesito orientación'],
        ideal_result: {
          expected_turns: [{
            stage: 'exploring',
            call_preference: 'unknown',
            call_offer_status: 'not_offered',
            call_offer_count: 0,
            offering_code: null,
            payment_plan: null,
            response_count: 1,
            action_count: 0,
            authorized_url_count: 0,
            used_memory_min: 0,
          }],
        },
      };
    const evaluated = await runConversationCase(testCase, {
      runId: 'rubric-rate-limit',
      sendTurn: async () => ({
        conversationId: 'conversation-rate-limit',
        responses: [{ type: 'text', text: 'Podemos orientarte.' }],
        authorizedUrls: [],
        turnDiagnostic: {
          catalogResolution: { kind: 'no_catalog_intent' },
          selectedOfferingCode: null,
          decisionBusinessAction: null,
          authorizedProtectedFacts: [],
          authorizedUrls: [],
          commitError: null,
          brainFailureCode,
          conversationState: {
            stage: 'exploring',
            call_preference: 'unknown',
            call_offer_status: 'not_offered',
            call_offer_count: 0,
            offering_code: null,
            payment_plan: null,
          },
          usedMemoryIds: [],
        },
      }),
    });

    expect(evaluated.status).toBe('failed');
      expect(evaluated.failures).toContain(
        `turn_1_brain_failure:${brainFailureCode}`,
      );
    },
  );
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
