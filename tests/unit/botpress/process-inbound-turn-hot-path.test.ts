import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionSpies = vi.hoisted(() => ({
  ingest: vi.fn(),
  claim: vi.fn(),
  plan: vi.fn(),
  catalog: vi.fn(),
  commit: vi.fn(),
  dispatch: vi.fn(),
  delivery: vi.fn(),
  transcribe: vi.fn(),
  flush: vi.fn(),
  geminiDecision: vi.fn(),
  groqDecision: vi.fn(),
  agentABrain: vi.fn(),
  agentABrainDeepSeek: vi.fn(),
  agentABrainOpenAI: vi.fn(),
  agentABrainGemini: vi.fn(),
  conversationInterpreter: vi.fn(),
}));

vi.mock('../../../botpress-agent/src/actions/ingestTurn', () => ({
  ingestTurn: { execute: actionSpies.ingest },
}));
vi.mock('../../../botpress-agent/src/actions/claimBatch', () => ({
  claimBatch: { execute: actionSpies.claim },
}));
vi.mock('../../../botpress-agent/src/actions/planConversation', () => ({
  planConversation: { execute: actionSpies.plan },
}));
vi.mock('../../../botpress-agent/src/actions/lookupCatalog', () => ({
  lookupCatalog: { execute: actionSpies.catalog },
}));
vi.mock('../../../botpress-agent/src/actions/commitDecision', () => ({
  commitDecision: { execute: actionSpies.commit },
}));
vi.mock('../../../botpress-agent/src/actions/dispatchCall', () => ({
  dispatchCall: { execute: actionSpies.dispatch },
}));
vi.mock('../../../botpress-agent/src/actions/reportDelivery', () => ({
  reportDelivery: { execute: actionSpies.delivery },
}));
vi.mock('../../../botpress-agent/src/actions/transcribeAudio', () => ({
  transcribeAudio: { execute: actionSpies.transcribe },
}));
vi.mock('../../../botpress-agent/src/actions/flushLeadProjection', () => ({
  flushLeadProjection: { execute: actionSpies.flush },
}));
vi.mock('../../../botpress-agent/src/lib/decision/gemini-direct', () => ({
  generateGeminiDecision: actionSpies.geminiDecision,
  MAX_GEMINI_DECISION_TIMEOUT_MS: 6000,
}));
vi.mock('../../../botpress-agent/src/lib/decision/groq-direct', () => ({
  generateGroqDecision: actionSpies.groqDecision,
}));
vi.mock('../../../botpress-agent/src/lib/conversation/conversation-interpreter', () => ({
  generateGroqConversationMoveV1: actionSpies.conversationInterpreter,
}));
vi.mock('../../../botpress-agent/src/lib/conversation/agent-a-brain', () => ({
  // La validación real vive en su propio test. Acá se neutraliza para que
  // estos casos midan el ruteo de proveedores, que es lo que afirman: un
  // rechazo real convertiría cada caso en una prueba de la escalera.
  validateAgentATurnProposalV1: () => null,
  decideRepairLevelV1: () => ({ level: 'N1' as const, messages: [] as string[] }),
  generateAgentATurnProposalV1: actionSpies.agentABrain,
  generateDeepSeekAgentATurnProposalV1: actionSpies.agentABrainDeepSeek,
  generateOpenAIAgentATurnProposalV1: actionSpies.agentABrainOpenAI,
  generateGeminiAgentATurnProposalV1: actionSpies.agentABrainGemini,
  parseAgentATurnProposalV1: (raw: unknown) => raw,
  solicitsACallV1: (message: string, declaredOffer = false) => declaredOffer
    ? /llam|tel[eé]fono|voz/iu.test(message)
    : /(?:te llamo|te llamamos|una llamada|llamarte)/iu.test(message),
  DEFAULT_AGENT_A_BRAIN_MODEL: 'openai/gpt-oss-120b',
  DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL: 'deepseek-v4-flash',
  DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL: 'gpt-5.6-terra',
  DEFAULT_AGENT_A_BRAIN_OPENAI_FALLBACK_MODEL: 'gpt-5.6-luna',
  DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL: 'gemini-2.5-flash',
  buildSafeAgentABrainCompositionV1: ({ proposal, planned_fact_ids }: {
    proposal: { response: { messages: string[] } };
    planned_fact_ids: string[];
  }) => ({
    schema_version: 1,
    narrative: {
      opening: proposal.response.messages[0],
      explanation: proposal.response.messages[1] ?? null,
      next_question: proposal.response.messages[2] ?? null,
    },
    used_fact_ids: planned_fact_ids,
  }),
}));

import { adk, configuration, secrets } from '../../helpers/botpress-runtime-stub';
import { processInboundTurn } from '../../../botpress-agent/src/workflows/processInboundTurn';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../../botpress-agent/src/prompts/agent-a-brain-v1';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
  StudyxHttpError,
} from '../../../botpress-agent/src/utils/http';
import { dispatch } from '../../../botpress-agent/src/channels';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const NOW = '2026-08-21T12:00:00.000Z';

function ingestResponse() {
  return {
    status: 'accepted',
    replayed: false,
    trace_id: UUID,
    turn_id: UUID,
    conversation_id: UUID,
    batch: {
      id: UUID,
      state: 'waiting',
      joined_existing: false,
      due_at: '2020-01-01T00:00:00.000Z',
      hard_deadline_at: NOW,
      conversation_seq: 1,
      message_count: 1,
    },
    policy: { may_respond: true, allowed_response_types: ['commercial_reply'], reason: null },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
    },
    existing_result: null,
  };
}

function claimedResponse() {
  return {
    outcome: 'claimed',
    trace_id: UUID,
    batch: {
      id: UUID,
      claim_token: UUID,
      conversation_id: UUID,
      contact_id: UUID,
      lease_until: NOW,
      hard_deadline_at: NOW,
      message_count: 1,
      stolen: false,
    },
    turn_id: UUID,
    policy: { may_respond: true, allowed_response_types: ['commercial_reply'], reason: null },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: NOW,
    },
    context: {
      batch_messages: [{
        id: UUID,
        conversation_seq: 1,
        content: '¿Cuánto sale el curso?',
        created_at: NOW,
        message_type: 'text',
      }],
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: true,
      knowledge_base: [],
      knowledge_base_available: true,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'advising',
      course_of_interest: null,
      offering_code: null,
      open_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    },
    catalog_resolution: { kind: 'no_catalog_intent' as const },
    deterministic_route: null,
    diagnostics: {
      timings: {
        claim_total_ms: 7,
        core_db_ms: 2,
        shared_embedding_ms: 1,
        memory_search_ms: 1,
        knowledge_search_ms: 1,
        business_snapshot_ms: 2,
      },
      counters: {
        embedding_calls: 1,
        memory_search_calls: 1,
        knowledge_search_calls: 1,
        business_snapshot_calls: 1,
        catalog_calls: 0,
      },
    },
    business_context: null,
    business_context_available: false,
    existing_result: null,
  };
}

function paymentBusinessContext() {
  return {
    as_of: NOW,
    prices_assertable: true,
    workspace: {
      slug: 'studyx',
      display_name: 'StudyX',
      environment: 'sandbox' as const,
      default_locale: 'es-AR',
      timezone: 'America/Argentina/Buenos_Aires',
      payment_options: [{
        code: 'one_time' as const,
        label: 'Pago único',
        total: { amount: '360.00' as const, currency: 'USD' as const },
        installments: 1,
        installment_amount: '360.00' as const,
        payment_link: 'https://example.test/one-time',
      }],
    },
    offerings: [{
      code: 'redes-informaticas',
      display_name: 'Redes Informáticas',
      aliases: [],
      academy: 'Tecnología',
      offering_type: 'course' as const,
      description: null,
      value_proposition: null,
      price_type: 'fixed' as const,
      price: { amount: '360.00', currency: 'USD' },
      price_assertable: true,
      billing_interval: null,
      modality: null,
      schedules: [],
      certification: null,
      hours_per_month: null,
      classes: 16,
      modules: null,
      includes: [],
      syllabus_published: null,
      language: null,
      min_age: null,
      policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
    }],
    qualification_fields: [],
    injection_suspected_count: 0,
    offerings_truncated: 0,
  };
}

function workflowInput() {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'integration-test',
    external_message_id: 'message-test',
    external_conversation_id: 'conversation-test',
    external_user_id: 'user-test',
    trace_id: UUID,
    message: {
      type: 'text',
      text: '¿Cuánto sale el curso?',
      occurred_at: NOW,
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: null,
    botpress_conversation_id: 'bp-conversation',
    botpress_user_id: 'bp-user',
  };
}

function processingState() {
  return {
    phase: 'received',
    turnId: null,
    batchId: null,
    decisionId: null,
    outboundId: null,
    deliveryStatus: null,
    errorCode: null,
  };
}

describe('processInboundTurn hot path', () => {
  beforeEach(() => {
    configuration.automationEnabled = true;
    configuration.decisionProvider = 'botpress_managed';
    configuration.agentAPlannerlessV2Enabled = false;
    configuration.agentAAgentLoopV3KillSwitch = false;
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    delete secrets.GROQ_API_KEY;
    delete secrets.OPENAI_API_KEY;
    delete secrets.GEMINI_API_KEY;
    actionSpies.ingest.mockResolvedValue(ingestResponse());
    actionSpies.claim.mockResolvedValue(claimedResponse());
    actionSpies.catalog.mockResolvedValue({
      items: [],
      count: 0,
      as_of: NOW,
      prices_assertable: false,
    });
    actionSpies.commit.mockResolvedValue({
      status: 'rejected',
      replayed: false,
      trace_id: UUID,
      turn_id: UUID,
      decision_id: UUID,
      next_state: 'completed',
      outbound: null,
      call_request: null,
    });
    actionSpies.flush.mockResolvedValue({ status: 'unavailable', completed: 0 });
    actionSpies.delivery.mockResolvedValue({ status: 'recorded' });
    actionSpies.conversationInterpreter.mockResolvedValue({
      move: {
        schema_version: 1,
        move: 'continue_by_chat',
        secondary_moves: [],
        vetoes: [],
        confidence: 0.95,
      },
      provider: 'groq-direct',
      model: 'openai/gpt-oss-20b',
      latency_ms: 120,
    });
    actionSpies.agentABrain.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [], confidence: 0.97,
        },
        response: { messages: ['Perfecto, seguimos por chat.', '¿Qué aspecto querés revisar?'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'groq-direct', model: 'openai/gpt-oss-120b', latency_ms: 180, attempt_count: 1,
    });
    actionSpies.agentABrainDeepSeek.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [], confidence: 0.97,
        },
        response: { messages: ['Perfecto, seguimos por chat.', '¿Qué aspecto querés revisar?'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
    });
    actionSpies.plan.mockResolvedValue({
      plan: {
        schema_version: 1,
        next_stage: 'course_selected',
        response_goal: 'acknowledge_chat_preference',
        canonical_fact_requests: [],
        allowed_business_action: { type: 'none' },
        missing_information: [],
        should_offer_call: false,
        next_call_preference: 'chat',
        next_call_offer_status: 'declined',
        next_call_offer_count: 1,
        next_awaiting_reply: 'none', payment_reported: false,
        selected_offering_code: 'redes-informaticas',
        selected_payment_plan: null,
      },
      fact_refs: [],
      state_version: 2,
      plan_hash: 'a'.repeat(64),
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it.each([
    [true, 'off'],
    [false, 'authoritative'],
  ] as const)(
    'applies the bundle kill switch=%s before exposing the agent-loop rollout mode',
    async (killSwitch, expectedMode) => {
      const claimed = claimedResponse() as unknown as ClaimedTurn;
      claimed.features = {
        agent_loop_v3_mode: 'authoritative',
        conversation_pipeline_v1_enabled: false,
      };
      claimed.deterministic_route = 'greeting';
      claimed.context.batch_messages[0].content = 'Hola';
      actionSpies.claim.mockResolvedValue(claimed);
      configuration.agentAAgentLoopV3KillSwitch = killSwitch;

      const step = Object.assign(
        async (_name: string, run: () => Promise<unknown>) => run(),
        { sleep: vi.fn(async () => undefined) },
      );
      const handler = (processInboundTurn as unknown as {
        definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
      }).definition.handler;

      await handler({
        input: workflowInput(),
        state: processingState(),
        step,
        execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
        client: {},
        signal: new AbortController().signal,
        workflow: { id: 'workflow-test' },
      });

      const rolloutEvent = vi.mocked(console.info).mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .find((entry) => entry.event === 'studyx.turn.agent_loop_v3_rollout');
      expect(rolloutEvent).toMatchObject({
        claimed_mode: 'authoritative',
        effective_mode: expectedMode,
        kill_switch: killSwitch,
      });
    },
  );

  it('sends the complete Brain proposal to backend authority without invoking the planner', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Quiero aprender sobre redes';
    claimed.catalog_resolution = {
      kind: 'ambiguous',
      requestedText: 'Quiero aprender sobre redes',
      candidateCodes: ['redes-informaticas', 'excel_integral'],
      clarification: 'choose_offering',
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 2,
      offerings: [
        {
          code: 'redes-informaticas', display_name: 'Redes Informáticas',
          academy: 'Tecnología', aliases: ['redes'],
        },
        {
          code: 'excel_integral', display_name: 'Excel Integral',
          academy: 'Tecnología', aliases: [],
        },
      ],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.contact.name = 'Lucia';
    claimed.context.recent_turns = [{
      direction: 'outbound',
      content: 'Hola, soy el asistente virtual de StudyX. Cómo te llamas?',
      created_at: '2026-08-21T11:59:55.000Z',
    }];
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: {
          messages: ['Buenísimo, Redes puede ser una opción muy práctica para vos.'],
          call_offer: 'Si quieres, podemos coordinar una llamada para orientarte.',
        },
        proposed_action: { type: 'none' },
        used_fact_ids: ['offering:redes-informaticas:name:v1'],
        used_memory_ids: [], memory_candidates: [], repair_of: null,
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
    });
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    actionSpies.commit.mockResolvedValueOnce({
      status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'completed', outbound: null, call_request: null,
    });

    await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          move: { move: 'select_course', course_reference: 'redes' },
          response: {
            messages: ['Buenísimo, Redes puede ser una opción muy práctica para vos.'],
            call_offer: 'Si quieres, podemos coordinar una llamada para orientarte.',
          },
        },
      },
      model: { provider: 'deepseek-direct', prompt_version: AGENT_A_BRAIN_PROMPT_VERSION },
    });
    const callOfferLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.call_offer_policy_v1');
    expect(callOfferLog).toMatchObject({
      call_offer_count_before: 0,
      call_offer_count_after: 1,
      offered_call: true,
      reason: 'FIRST_OFFER_DUE',
      call_accepted: false,
      call_rejected: false,
      chat_preference: false,
      commit_status: 'committed',
    });
  });

  it.each([
    ['legacy', false, false, 0, 0, 1],
    ['shadow', false, true, 1, 0, 1],
    ['authoritative', true, false, 1, 1, 0],
  ] as const)(
    'routes the %s brain rollout without shadow mutation',
    async (_mode, enabled, shadow, expectedBrainCalls, expectedPlannerCalls, expectedLegacyCalls) => {
      const claimed = claimedResponse() as unknown as ClaimedTurn;
      claimed.features = {
        agent_loop_v3_mode: 'off',
        conversation_pipeline_v1_enabled: false,
        agent_a_brain_v1_enabled: enabled,
        agent_a_brain_v1_shadow: shadow,
      } as never;
      claimed.conversation_state_v1 = {
        selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
        stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
        call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
      };
      claimed.context.batch_messages[0].content = 'CANARY_MESSAGE_7c1b sigamos por escrito';
      claimed.contact.name = 'CANARY_EMAIL_test@example.com';
      claimed.catalog_index = {
        as_of: NOW, offerings_total: 1,
        offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [] }],
        injection_suspected_count: 0,
      };
      claimed.business_context = paymentBusinessContext();
      claimed.business_context_available = true;
      actionSpies.claim.mockResolvedValue(claimed);

      const step = Object.assign(
        async (_name: string, run: () => Promise<unknown>) => run(),
        { sleep: vi.fn(async () => undefined) },
      );
      const execute = vi.fn(async () => ({
        is: () => true,
        output: {
          schema_version: 4, intent: 'commercial', kind: 'reply', response: 'Seguimos.',
          response_type: 'commercial_reply', confidence: 1, reason_code: 'LEGACY_ANSWER',
          business_action: null, memory_candidates: [], missing_information: [],
          next_state: 'waiting_user', retrieval_used: null,
        },
        iterations: [],
      }));
      const handler = (processInboundTurn as unknown as {
        definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
      }).definition.handler;

      await handler({
        input: { ...workflowInput(), phone_e164: '+5491100000000' },
        state: processingState(), step, execute, client: {},
        signal: new AbortController().signal, workflow: { id: 'workflow-test' },
      });

      expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(expectedBrainCalls);
      expect(actionSpies.plan).toHaveBeenCalledTimes(expectedPlannerCalls);
      expect(execute).toHaveBeenCalledTimes(expectedLegacyCalls);
      const commitInput = actionSpies.commit.mock.calls[0]?.[0]?.input;
      if (_mode === 'authoritative') {
        expect(commitInput).toMatchObject({
          conversation_pipeline_v1: {
            move: { move: 'continue_by_chat' },
            composition: {
              narrative: {
                opening: 'Perfecto, seguimos por chat.',
                explanation: '¿Qué aspecto querés revisar?',
                next_question: null,
              },
            },
          },
          model: { prompt_version: AGENT_A_BRAIN_PROMPT_VERSION },
        });
      } else {
        expect(commitInput).toMatchObject({
          conversation_pipeline_v1: null,
          decision: { reason_code: 'LEGACY_ANSWER' },
        });
      }

      const logs = vi.mocked(console.info).mock.calls.map(([line]) => String(line));
      for (const line of logs) {
        expect(line).not.toContain('CANARY_MESSAGE_7c1b');
        expect(line).not.toContain('CANARY_EMAIL_test@example.com');
        expect(line).not.toContain('+5491100000000');
      }
      if (_mode !== 'legacy') {
        const brainLog = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry.event === 'studyx.turn.agent_a_brain_v1');
        expect(brainLog).toMatchObject({
          brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
          brain_model: 'deepseek-v4-flash',
          brain_source: 'model',
          context_recent_turn_count: 0,
          context_memory_count: 0,
          used_memory_count: 0,
          proposed_action_type: 'none',
        });
      }
    },
  );

  it('returns a canonical course fact instead of a technical reply when the authoritative brain is unavailable', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.sales_context.course_of_interest = 'Redes Informáticas';
    claimed.sales_context.offering_code = 'redes-informaticas';
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockRejectedValue(
      Object.assign(new Error('provider failure'), { code: 'BRAIN_RATE_LIMITED' }),
    );

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('LEGACY_MODEL_MUST_NOT_RUN_AFTER_AUTHORITATIVE_FAILURE');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response: 'El precio de Redes Informáticas es USD 360. ¿Preferís 12 cuotas, 6 cuotas o un pago único?',
        response_type: 'commercial_reply',
        reason_code: 'DETERMINISTIC_COURSE_FACTS',
        business_action: null,
      },
    });
    const brainLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_v1');
    expect(brainLog).toMatchObject({
      rollout_mode: 'authoritative',
      brain_source: 'fallback',
      brain_failure_reason: 'rate_limited',
      failure_code: 'BRAIN_RATE_LIMITED',
      authorized_action_type: 'none',
    });
  });

  it('keeps a canonical course choice moving when DeepSeek rejects the turn', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.context.batch_messages[0].content = 'Quizas comunity manager';
    claimed.catalog_resolution = {
      kind: 'exact', offeringCode: 'community-manager', displayName: 'Community Manager',
      academy: 'Marketing', match: 'unique_typo',
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{
        code: 'community-manager', display_name: 'Community Manager', academy: 'Marketing', aliases: ['comunity manager'],
      }],
      injection_suspected_count: 0,
    };
    const business = paymentBusinessContext();
    business.offerings[0] = {
      ...business.offerings[0],
      code: 'community-manager',
      display_name: 'Community Manager',
      academy: 'Marketing',
      classes: 16,
    };
    claimed.business_context = business;
    claimed.business_context_available = true;
    claimed.contact.name = 'Agustina';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'course_choice', version: 4,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockRejectedValue(
      Object.assign(new Error('invalid proposal'), { code: 'BRAIN_INVALID_SCHEMA' }),
    );

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      authorized_offering_code: 'community-manager',
      decision: {
        kind: 'reply',
        response_type: 'call_offer',
        reason_code: 'DETERMINISTIC_COURSE_DISCOVERY',
        business_action: null,
      },
    });
    const response = String(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision?.response);
    expect(response).toContain('Community Manager');
    expect(response).toMatch(/llamada|llamar/iu);
    expect(response).not.toContain('Hubo un problema');
  });

  it('retries one transient DeepSeek timeout before using the technical fallback', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'ingles_1', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 2,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas', aliases: ['ingles'] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.contact.name = 'Thiago';
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    actionSpies.agentABrainDeepSeek
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'BRAIN_DEEPSEEK_TIMEOUT' }));

    const stepNames: string[] = [];
    const step = Object.assign(
      async (name: string, run: () => Promise<unknown>) => {
        stepNames.push(name);
        return run();
      },
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(stepNames).toContain('retry-agent-a-turn-proposal-v1-deepseek');
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          response: { messages: ['Perfecto, seguimos por chat.', '¿Qué aspecto querés revisar?'] },
        },
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
    const retryLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_retry');
    expect(retryLog).toMatchObject({ reason: 'BRAIN_DEEPSEEK_TIMEOUT', attempt: 2 });
  });

  it('does not use Botpress managed extraction when DeepSeek fails', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.context.batch_messages[0].content = 'Holaa, ¿qué cursos tienen?';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'invalid-deepseek-test-key';
    secrets.OPENAI_API_KEY = 'invalid-openai-test-key';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('DEEPSEEK_REJECTED'));
    actionSpies.agentABrainOpenAI
      .mockRejectedValueOnce(new Error('OPENAI_PRIMARY_REJECTED'))
      .mockRejectedValueOnce(new Error('OPENAI_FALLBACK_REJECTED'));
    const managedProposal = {
      schema_version: 1 as const,
      move: {
        schema_version: 1 as const, move: 'browse_catalog' as const,
        secondary_moves: [], vetoes: [], confidence: 0.97,
      },
      response: {
        messages: ['¡Hola! Tenemos distintas áreas para explorar.', '¿Qué te gustaría aprender?'] as [string, string],
      },
      proposed_action: { type: 'none' as const },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
    };
    vi.spyOn(adk.zai, 'extract').mockResolvedValueOnce(managedProposal);
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('AUTONOMOUS_EXIT_NOT_REACHED');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response: 'Hubo un problema al preparar la respuesta. Envíame el mensaje otra vez en un momento.',
        reason_code: 'MODEL_UNAVAILABLE',
      },
    });
  });

  it('preserves DeepSeek wording but strips every action when the planner rejects it', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.context.batch_messages[0].content = '¿Solo tenés cursos de salud y bienestar?';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: {
          messages: [
            'No, también tenemos opciones en tecnología, diseño y negocios.',
            '¿Qué te gustaría aprender?',
          ],
          call_offer: 'Si querés, te llamo ahora.',
        },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [],
        used_memory_ids: [],
        memory_candidates: [{
          type: 'preference', key: 'unsafe_planner_rejected_memory', value: 'llamada',
          source_quote: 'te llamo', confidence: 0.9,
        }],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 320, attempt_count: 1,
    });
    actionSpies.plan.mockRejectedValueOnce(
      Object.assign(new Error('planner rejected action'), { code: 'CONVERSATION_PLAN_POLICY_REJECTED' }),
    );
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('LEGACY_MODEL_MUST_NOT_RUN_AFTER_DEEPSEEK_SUCCEEDS');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response: 'No, también tenemos opciones en tecnología, diseño y negocios.\n\n¿Qué te gustaría aprender?',
        response_type: 'commercial_reply',
        reason_code: 'BRAIN_ADVISORY_ONLY_PLANNER_REJECTED',
        business_action: null,
        memory_candidates: [],
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input.decision.response).not.toContain('te llamo');
  });

  it('does not use a managed model when DeepSeek is rate limited', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Quiero información sobre algo de salud';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'entrenamiento-funcional', display_name: 'Entrenamiento Funcional', academy: 'Salud y Bienestar', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockRejectedValue(
      Object.assign(new Error('provider failure'), { code: 'BRAIN_RATE_LIMITED' }),
    );

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_area', secondary_moves: [], vetoes: [],
          area_reference: 'Salud y Bienestar', confidence: 0.96,
        },
        response: { messages: ['Claro, te ayudo a encontrar una opción que encaje con lo que buscás.'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      iterations: [],
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response: 'Hubo un problema al preparar la respuesta. Envíame el mensaje otra vez en un momento.',
        reason_code: 'MODEL_UNAVAILABLE',
      },
    });
  });

  it('ignores an OpenAI secret and keeps DeepSeek as the authoritative brain', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Quiero aprender algo relacionado con tecnología';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.OPENAI_API_KEY = 'openai-local-test-only';
    actionSpies.agentABrainOpenAI.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_area', secondary_moves: [], vetoes: [],
          area_reference: 'Tecnología', confidence: 0.98,
        },
        response: { messages: ['Buenísimo. Dentro de tecnología podemos buscar una opción que vaya con tu objetivo.'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'openai-direct', model: 'gpt-5.6-terra', latency_ms: 420, attempt_count: 1,
    });

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('MANAGED_MODEL_MUST_NOT_RUN_WHEN_OPENAI_SUCCEEDS');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'deepseek-local-test-only',
      model: 'deepseek-v4-flash',
    }));
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        composition: { narrative: { opening: 'Perfecto, seguimos por chat.' } },
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
  });

  it('uses DeepSeek Flash before every legacy provider when its production secret exists', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Busco algo para trabajar en tecnología';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    secrets.OPENAI_API_KEY = 'openai-must-not-be-used';
    actionSpies.agentABrainDeepSeek.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_area', secondary_moves: [], vetoes: [],
          area_reference: 'Tecnología', confidence: 0.98,
        },
        response: { messages: ['Dale, veamos una opción de tecnología que te sirva para trabajar.'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 360, attempt_count: 1,
    });

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('LEGACY_PROVIDER_MUST_NOT_RUN_WHEN_DEEPSEEK_SUCCEEDS');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'deepseek-local-test-only',
      model: 'deepseek-v4-flash',
    }));
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        composition: { narrative: { opening: expect.stringContaining('tecnología') } },
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
  });

  it('keeps canonical catalog navigation without invoking a second model when DeepSeek is unavailable', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Quiero información de los cursos';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: [],
      }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    secrets.OPENAI_API_KEY = 'openai-must-not-run';
    secrets.GROQ_API_KEY = 'groq-must-not-run';
    secrets.GEMINI_API_KEY = 'gemini-must-not-run';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(
      Object.assign(new Error('provider failure'), { code: 'BRAIN_RATE_LIMITED' }),
    );
    actionSpies.agentABrainOpenAI.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: { messages: ['Este texto no debe llegar al cliente.'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
      },
      provider: 'openai-direct', model: 'fallback-must-not-run', latency_ms: 1, attempt_count: 1,
    });
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('BOTPRESS_MODEL_MUST_NOT_RUN');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: null,
      decision: {
        kind: 'reply',
        response: 'Podemos orientarte por estas áreas: Tecnología. ¿Cuál te interesa?',
        reason_code: 'DETERMINISTIC_CATALOG_NAVIGATION',
      },
    });
  });

  it('binds the backend-resolved current course before planning a fluent brain reply', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'course_choice', version: 2,
    };
    claimed.context.batch_messages[0].content = 'Especialista en Ventas, ¿me das información?';
    claimed.catalog_resolution = {
      kind: 'exact', offeringCode: 'redes-informaticas', displayName: 'Redes Informáticas',
      academy: 'Tecnología', match: 'canonical',
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: [],
      }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          confidence: 0.98,
        },
        response: { messages: ['Te cuento lo principal para que veas si encaja con vos.'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 300, attempt_count: 1,
    });
    actionSpies.plan.mockResolvedValueOnce({
      plan: {
        schema_version: 1,
        next_stage: 'course_selected', response_goal: 'explain_selected_course',
        canonical_fact_requests: [], allowed_business_action: { type: 'none' },
        missing_information: [], should_offer_call: true,
        next_call_preference: 'unknown', next_call_offer_status: 'offered', next_call_offer_count: 1,
        next_awaiting_reply: 'call_or_chat', payment_reported: false, selected_offering_code: 'redes-informaticas',
        selected_payment_plan: null,
      },
      fact_refs: [], state_version: 2, plan_hash: 'd'.repeat(64),
    });

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute: vi.fn(), client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        move: expect.objectContaining({
          move: 'ask_course_information',
          course_reference: 'redes-informaticas',
        }),
      }),
    }));
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: {
          move: 'ask_course_information',
          course_reference: 'redes-informaticas',
        },
      },
    });
  });

  it('lets the authoritative DeepSeek brain compose a greeting without an optional runtime flag', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'greeting';
    claimed.policy = { may_respond: true, allowed_response_types: ['social_reply'], reason: null };
    claimed.context.batch_messages[0].content = 'Hola, ¿cómo estás?';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['¡Hola! Muy bien, gracias. ¿Qué te gustaría aprender?'] },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 300, attempt_count: 1,
    });
    actionSpies.plan.mockResolvedValueOnce({
      plan: {
        schema_version: 1,
        next_stage: 'exploring', response_goal: 'greet_and_discover', canonical_fact_requests: [],
        allowed_business_action: { type: 'none' }, missing_information: [], should_offer_call: false,
        next_call_preference: 'unknown', next_call_offer_status: 'not_offered', next_call_offer_count: 0,
        next_awaiting_reply: 'none', payment_reported: false, selected_offering_code: null, selected_payment_plan: null,
      },
      fact_refs: [], state_version: 2, plan_hash: 'c'.repeat(64),
    });

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute: vi.fn(), client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: { move: 'greeting' },
        composition: { narrative: { opening: expect.stringContaining('¿Qué te gustaría aprender?') } },
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
  });

  it('never replaces an unavailable authoritative brain with a deterministic greeting', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'greeting';
    claimed.context.batch_messages[0].content = 'Hola';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('DEEPSEEK_UNAVAILABLE'));
    actionSpies.agentABrain.mockRejectedValueOnce(new Error('GROQ_UNAVAILABLE'));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MANAGED_UNAVAILABLE'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response: 'Hubo un problema al preparar la respuesta. Envíame el mensaje otra vez en un momento.',
        reason_code: 'MODEL_UNAVAILABLE',
      },
    });
  });

  it('lets a greeting reach the planner under the V1 pipeline instead of a canned answer', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'greeting';
    claimed.context.batch_messages[0].content = 'Buenas tardes';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'greeting', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['Buenas tardes, ¿en qué te puedo ayudar hoy?'], call_offer: null },
        proposed_action: { type: 'none' },
        used_fact_ids: [],
        used_memory_ids: [],
        memory_candidates: [],
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 210, attempt_count: 1,
    });
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    // El planner corrió: sin eso un saludo no podría cerrar una sesión vieja.
    expect(actionSpies.plan).toHaveBeenCalled();
    const committed = actionSpies.commit.mock.calls[0]?.[0]?.input;
    expect(committed?.conversation_pipeline_v1).not.toBeNull();
    expect(JSON.stringify(committed)).not.toContain('asesora virtual');
  });

  it('ignores a Gemini secret and keeps DeepSeek as the authoritative brain', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Quiero algo vinculado con la salud';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'entrenamiento-funcional', display_name: 'Entrenamiento Funcional', academy: 'Salud y Bienestar', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrain.mockRejectedValue(
      Object.assign(new Error('provider failure'), { code: 'BRAIN_RATE_LIMITED' }),
    );
    actionSpies.agentABrainGemini.mockResolvedValue({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_area', secondary_moves: [], vetoes: [],
          area_reference: 'Salud y Bienestar', confidence: 0.96,
        },
        response: {
          messages: ['Perfecto, busquemos una formación que encaje con lo que querés lograr.'],
        },
        proposed_action: { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      },
      provider: 'google-ai-direct', model: 'gemini-2.5-flash', latency_ms: 180, attempt_count: 1,
    });
    secrets.GEMINI_API_KEY = 'test-gemini-key';

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('MANAGED_MODEL_MUST_NOT_RUN_WHEN_GEMINI_DIRECT_SUCCEEDS');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: expect.objectContaining({ move: 'continue_by_chat' }),
        composition: {
          narrative: expect.objectContaining({
            opening: 'Perfecto, seguimos por chat.',
          }),
        },
      },
      model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  async function runCommittedOutbound(
    outbound: Record<string, unknown>,
    inputOverrides: Record<string, unknown> = {},
    options: {
      outbounds?: Array<Record<string, unknown>>;
      createMessage?: ReturnType<typeof vi.fn>;
      callRequest?: { call_id: string; status: 'requested' } | null;
    } = {},
  ) {
    actionSpies.commit.mockResolvedValue({
      status: 'committed',
      replayed: false,
      trace_id: UUID,
      turn_id: UUID,
      decision_id: UUID,
      next_state: 'completed',
      outbound: {
        id: UUID,
        content: 'Contenido autorizado',
        status: 'pending',
        delivery_attempt: 1,
        ...outbound,
      },
      outbounds: options.outbounds ?? [],
      call_request: options.callRequest ?? null,
    });
    const createMessage = options.createMessage
      ?? vi.fn(async () => ({ message: { id: 'bp-message-1' } }));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 4,
        intent: 'commercial',
        kind: 'reply',
        response: 'Contenido autorizado',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      },
      iterations: [],
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: { ...workflowInput(), ...inputOverrides },
      state: processingState(),
      step,
      execute,
      client: { createMessage },
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    return { createMessage, result };
  }

  it('submits and records the Agent A acknowledgement before dispatching the reserved call', async () => {
    const order: string[] = [];
    const createMessage = vi.fn(async () => {
      order.push('agent-a-ack-submitted');
      return { message: { id: 'bp-call-ack' } };
    });
    actionSpies.delivery.mockImplementationOnce(async () => {
      order.push('agent-a-ack-recorded');
      return { status: 'recorded' };
    });
    actionSpies.dispatch.mockImplementationOnce(async () => {
      order.push('retell-dispatched');
      return { status: 'provider_accepted', provider_call_id: 'retell-call-1' };
    });

    await runCommittedOutbound({
      content: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
      authorized_egress: {
        schema_version: 1,
        content_hash: '305f1762b8455e6e893f353c779db410e3a2cd070d8b493f28f82f1fadd0bc9e',
        authorized_urls: [],
        protected_facts: [],
      },
    }, {}, {
      createMessage,
      callRequest: { call_id: UUID, status: 'requested' },
    });

    expect(order).toEqual([
      'agent-a-ack-submitted',
      'agent-a-ack-recorded',
      'retell-dispatched',
    ]);
  });

  it('does not dispatch the reserved call when the Agent A acknowledgement cannot be submitted', async () => {
    await runCommittedOutbound({
      content: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
      authorized_egress: {
        schema_version: 1,
        content_hash: '305f1762b8455e6e893f353c779db410e3a2cd070d8b493f28f82f1fadd0bc9e',
        authorized_urls: [],
        protected_facts: [],
      },
    }, {}, {
      createMessage: vi.fn(async () => { throw new Error('CHANNEL_UNAVAILABLE'); }),
      callRequest: { call_id: UUID, status: 'requested' },
    });

    expect(actionSpies.dispatch).not.toHaveBeenCalled();
  });

  it('delivers two durable outbound parts in order and reports each part', async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({ message: { id: 'bp-part-1' } })
      .mockResolvedValueOnce({ message: { id: 'bp-part-2' } });
    const manifests = [
      { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
    ];
    const { result } = await runCommittedOutbound({
      authorized_egress: manifests[0],
    }, {}, {
      createMessage,
      outbounds: [
        { id: UUID, content: 'Primero', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[0], part_index: 0, part_count: 2 },
        { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[1], part_index: 1, part_count: 2 },
      ],
    });

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(createMessage.mock.calls.map(([input]) => input.payload.text)).toEqual(['Primero', 'Segundo']);
    expect(actionSpies.delivery.mock.calls.map(([call]) => call.input)).toEqual([
      expect.objectContaining({ outbound_id: UUID, status: 'submitted_to_botpress', botpress_message_id: 'bp-part-1' }),
      expect.objectContaining({ outbound_id: '28a823e8-27c2-4279-9956-058f45f33cd6', status: 'submitted_to_botpress', botpress_message_id: 'bp-part-2' }),
    ]);
    expect(result).toMatchObject({ status: 'completed', delivery_status: 'submitted_to_botpress' });
  });

  it('stops after a failed second part without resending the first', async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({ message: { id: 'bp-part-1' } })
      .mockRejectedValueOnce(Object.assign(new Error('channel failed'), { code: 'CHANNEL_FAILED' }));
    const manifests = [
      { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
    ];
    const { result } = await runCommittedOutbound({
      authorized_egress: manifests[0],
    }, {}, {
      createMessage,
      outbounds: [
        { id: UUID, content: 'Primero', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[0], part_index: 0, part_count: 2 },
        { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[1], part_index: 1, part_count: 2 },
      ],
    });

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(actionSpies.delivery.mock.calls.map(([call]) => call.input.status)).toEqual([
      'submitted_to_botpress', 'failed',
    ]);
    expect(result).toMatchObject({ status: 'paused_error', delivery_status: 'failed' });
  });

  it('never resends submitted or retryable-failed parts without a new delivery lease', async () => {
    const createMessage = vi.fn();
    const manifests = [
      { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
    ];
    const { result } = await runCommittedOutbound({
      authorized_egress: manifests[0],
    }, {}, {
      createMessage,
      outbounds: [
        { id: UUID, content: 'Primero', status: 'submitted_to_botpress', delivery_attempt: 1, authorized_egress: manifests[0], part_index: 0, part_count: 2 },
        { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'failed', delivery_attempt: 2, authorized_egress: manifests[1], part_index: 1, part_count: 2 },
      ],
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(actionSpies.delivery).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'retry_pending',
      delivery_status: 'failed',
      error_code: 'OUTBOUND_RETRY_PENDING',
    });
  });

  it('blocks altered committed content before createMessage and reports a safe failure', async () => {
    const { createMessage, result } = await runCommittedOutbound({
      content: 'Contenido alterado',
      authorized_egress: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
      },
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(actionSpies.delivery).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery.mock.calls[0]?.[0]?.input).toMatchObject({
      status: 'failed',
      botpress_message_id: null,
      error_code: 'EGRESS_HASH_MISMATCH',
    });
    expect(result).toMatchObject({
      status: 'paused_error',
      delivery_status: 'failed',
      error_code: 'EGRESS_HASH_MISMATCH',
    });
  });

  it('blocks a hash-valid but unauthorized URL before createMessage', async () => {
    const unauthorizedUrl = 'https://attacker.example/phish';
    const { createMessage, result } = await runCommittedOutbound({
      content: `Pagá acá: ${unauthorizedUrl}`,
      authorized_egress: {
        schema_version: 1,
        content_hash: '02f4b7150b0623b3f814cfd7585249b57a180bdc4e12e0275bf3e292a525239a',
        authorized_urls: [],
        protected_facts: [],
      },
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(actionSpies.delivery.mock.calls[0]?.[0]?.input).toMatchObject({
      status: 'failed',
      error_code: 'EGRESS_UNAUTHORIZED_URL',
    });
    expect(result).toMatchObject({ error_code: 'EGRESS_UNAUTHORIZED_URL' });
  });

  it('sends exact authorized content once and reports only the successful submission', async () => {
    const claimed = claimedResponse();
    (claimed.context.batch_messages[0] as typeof claimed.context.batch_messages[number] & {
      occurred_at?: string;
    }).occurred_at = new Date(Date.now() - 5_000).toISOString();
    actionSpies.claim.mockResolvedValue(claimed);
    const { createMessage, result } = await runCommittedOutbound({
      authorized_egress: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
      },
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery.mock.calls[0]?.[0]?.input).toMatchObject({
      status: 'submitted_to_botpress',
      botpress_message_id: 'bp-message-1',
      error_code: null,
    });
    expect(result).toMatchObject({
      status: 'completed',
      delivery_status: 'submitted_to_botpress',
    });
    const timingLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.timings');
    expect(timingLog).toMatchObject({
      event_to_visible_outbound_ms: expect.any(Number),
      event_to_visible_outbound_over_budget: expect.any(Number),
      batch_wait_ms: expect.any(Number),
    });
    expect(Number(timingLog?.event_to_visible_outbound_ms)).toBeGreaterThanOrEqual(4_500);
  });

  it('does not apply the WhatsApp canary gate to Telegram sandbox delivery', async () => {
    configuration.whatsappCanaryEnabled = true;
    secrets.WHATSAPP_CANARY_PHONE_E164S = '+5491100000000';

    const { createMessage, result } = await runCommittedOutbound({
      authorized_egress: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
      },
    }, {
      channel: 'whatsapp',
      phone_e164: '+9998464326323',
      sandbox_provider: 'telegram_sandbox',
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'completed',
      delivery_status: 'submitted_to_botpress',
    });
  });

  it('never invokes the standalone catalog action for a normal model turn', async () => {
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 3,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te cuento.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      },
      iterations: [],
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ iterations: 2 }));
    expect(actionSpies.catalog).toHaveBeenCalledTimes(0);
    // No delivery happened (the mocked commit is rejected, `outbound: null`),
    // so the opportunistic Sheets flush must never run either — it is wired
    // strictly after a confirmed delivery, never as part of the common path.
    expect(actionSpies.flush).toHaveBeenCalledTimes(0);

    const timingLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.timings');
    expect(timingLog).toMatchObject({
      batch_wait_actual_ms: expect.any(Number),
      claim_total_ms: 7,
      core_db_ms: 2,
      shared_embedding_ms: 1,
      memory_search_ms: 1,
      knowledge_search_ms: 1,
      business_snapshot_ms: 2,
      model_ms: expect.any(Number),
      event_to_decision_ms: expect.any(Number),
      embedding_calls: 1,
      memory_search_calls: 1,
      knowledge_search_calls: 1,
      business_snapshot_calls: 1,
      catalog_calls: 0,
    });
    const serializedTimingLog = JSON.stringify(timingLog);
    expect(serializedTimingLog).not.toContain('¿Cuánto sale el curso?');
    expect(serializedTimingLog).not.toContain('user-test');
  });

  it('builds the brain context from the claimed memory snapshot without another catalog read', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.conversation_state_v1 = {
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      version: 1,
    };
    claimed.context.selected_memories = [{
      memory_id: 'memory-relevant',
      type: 'study_goal',
      key: 'career_goal',
      value: 'busca salida laboral',
      source_quote: 'Quiero estudiar para conseguir trabajo',
      similarity: 0.93,
      recorded_at: NOW,
    }];
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 4,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te ayudo a encontrar una opción.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
        retrieval_used: null,
      },
      iterations: [],
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    const contextLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_context_built');
    expect(contextLog).toMatchObject({
      context_recent_turn_count: 0,
      context_memory_count: 1,
    });
    expect(actionSpies.catalog).not.toHaveBeenCalled();
  });

  it('commits one deterministic opt-out acknowledgement without invoking a model', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.policy = {
      may_respond: true,
      allowed_response_types: ['opt_out_ack'],
      reason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
    };
    claimed.contact.blocked = true;
    claimed.contact.consent_status = 'revoked';
    claimed.context.batch_messages[0].content = 'Redes Informáticas, dame de baja';
    claimed.context.batch_messages[0].opt_out_ack_eligible = true;
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('MODEL_MUST_NOT_RUN_FOR_OPT_OUT_ACK');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    const input = workflowInput();
    input.message.text = 'Redes Informáticas, dame de baja';

    await handler({
      input,
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      intent: 'opt_out',
      kind: 'reply',
      response_type: 'opt_out_ack',
      reason_code: 'EXPLICIT_OPT_OUT_ACK',
      business_action: null,
      memory_candidates: [],
      next_state: 'completed',
    });
  });

  it('propagates the offering resolved by the deterministic router into the canonical commit', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.context.batch_messages[0].content = '¿Cuántas clases tiene Redes Informáticas?';
    claimed.business_context_available = true;
    claimed.business_context = paymentBusinessContext();
    claimed.sales_context.course_of_interest = null;
    claimed.sales_context.offering_code = null;
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('MODEL_MUST_NOT_RUN_FOR_CANONICAL_COURSE_FACTS');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      authorized_offering_code: 'redes-informaticas',
      decision: { reason_code: 'DETERMINISTIC_COURSE_FACTS' },
    });
  });

  it('propagates an explicit deterministic payment confirmation to backend materialization', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.context.batch_messages[0].content = 'Confirmo pago único';
    claimed.business_context_available = true;
    claimed.business_context = paymentBusinessContext();
    claimed.sales_context.course_of_interest = 'Redes Informáticas';
    claimed.sales_context.offering_code = 'redes-informaticas';
    claimed.sales_context.selected_payment_plan = null;
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => {
      throw new Error('MODEL_MUST_NOT_RUN_FOR_PAYMENT_SELECTION');
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      authorized_offering_code: 'redes-informaticas',
      authorized_payment_plan: 'one_time',
      decision: {
        reason_code: 'DETERMINISTIC_PAYMENT_SELECTION',
        business_action: {
          type: 'send_payment_link',
          plan_code: 'one_time',
          offering_sku: 'redes-informaticas',
        },
        next_state: 'completed',
      },
    });
  });

  it('fails closed instead of invoking the retired Groq/Gemini legacy pipeline', async () => {
    configuration.agentAPlannerlessV2Enabled = false;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: false,
      agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat',
      version: 2,
    };
    claimed.context.batch_messages[0].content = 'Mantengamos este intercambio en formato escrito';
    claimed.catalog_index = {
      as_of: NOW,
      offerings_total: 1,
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: [],
      }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async (request: { instructions: string }) => {
      void request;
      return {
        is: () => true,
        output: {
          schema_version: 1,
          narrative: {
            opening: 'Perfecto, seguimos por chat.',
            explanation: 'Te acompaño por este medio.',
            next_question: '¿Qué aspecto querés revisar?',
          },
          used_fact_ids: [],
        },
      };
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.conversationInterpreter).not.toHaveBeenCalled();
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: { kind: 'reply', reason_code: 'MODEL_UNAVAILABLE' },
    });
  });

  it('does not execute the legacy conversation pipeline when single-route is enabled', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: false,
      agent_a_brain_v1_shadow: false,
      agent_a_context_scoping: false,
      agent_a_repair_enabled: false,
      agent_a_single_route: true,
    };
    claimed.context.batch_messages[0].content = 'Mantengamos este intercambio en formato escrito';
    actionSpies.claim.mockResolvedValue(claimed);

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 4,
        response: { content: 'Respuesta del camino de rollback.', citations: [] },
        response_type: 'commercial_reply',
        confidence: 0.9,
        reason_code: 'MODEL_ADVISORY',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
        retrieval_used: null,
      },
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.conversationInterpreter).not.toHaveBeenCalled();
    expect(actionSpies.plan).not.toHaveBeenCalled();
  });

  it('keeps V1 behind the automation kill switch even when the feature flag is projected', async () => {
    configuration.automationEnabled = false;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: true };
    claimed.context.batch_messages[0].content = 'Necesito orientación comercial';
    actionSpies.claim.mockResolvedValue(claimed);
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.conversationInterpreter).not.toHaveBeenCalled();
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: { reason_code: 'AUTOMATION_DISABLED', business_action: null },
    });
  });

  it('projects an authorized backend call acceptance through the V1 planner without a model call', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: true };
    claimed.deterministic_route = 'call_accepted_offer';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.context.batch_messages[0].content = 'Sí';
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.plan.mockResolvedValueOnce({
      plan: {
        schema_version: 1,
        next_stage: 'handoff',
        response_goal: 'confirm_call_request',
        canonical_fact_requests: [],
        allowed_business_action: { type: 'request_call_now', reason: 'accepted_offer' },
        missing_information: [],
        should_offer_call: false,
        next_call_preference: 'call',
        next_call_offer_status: 'accepted',
        next_awaiting_reply: 'none', payment_reported: false,
        selected_offering_code: 'redes-informaticas',
        selected_payment_plan: null,
      },
      fact_refs: [],
      state_version: 3,
      plan_hash: 'b'.repeat(64),
    });
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.conversationInterpreter).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.plan).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ move: expect.objectContaining({ move: 'request_call' }) }),
    }));
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: { move: { move: 'request_call', confidence: 1 } },
      model: { provider: 'botpress', model: 'backend:call_accepted_offer' },
    });
  });

  it('executes an authorized direct call without waiting for the authoritative brain', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'call_direct_request';
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.context.batch_messages[0].content = 'Llamame';
    claimed.sales_context.allowed_actions = ['request_call_now'];
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('DEEPSEEK_UNAVAILABLE'));
    actionSpies.agentABrain.mockRejectedValueOnce(new Error('GROQ_UNAVAILABLE'));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MANAGED_UNAVAILABLE'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainDeepSeek).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'reply',
        response_type: 'call_confirmation',
        business_action: { type: 'request_call_now', reason: 'direct_request' },
        reason_code: 'CALL_DIRECT_REQUEST',
      },
    });
  });

  it('asks for the missing phone instead of exposing a model failure after a call request', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    (claimed as unknown as { deterministic_route: string }).deterministic_route = 'call_phone_required';
    claimed.context.batch_messages[0].content = 'Quiero que me llamen';
    claimed.sales_context.allowed_actions = ['offer_call'];
    (claimed as unknown as { contact_intake_missing: string[] }).contact_intake_missing = ['telefono'];
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'call', call_offer_status: 'accepted',
      call_offer_count: 1, awaiting_reply: 'none', version: 2,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('BRAIN_DEEPSEEK_TIMEOUT'));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          move: { move: 'request_call' },
          response: { call_offer: null },
          proposed_action: { type: 'none' },
        },
      },
    });
    const response = String(
      actionSpies.commit.mock.calls[0]?.[0]?.input?.agent_turn_v2?.proposal?.response?.messages?.[0],
    );
    expect(response).toMatch(/n[uú]mero/i);
    expect(response).toMatch(/c[oó]digo de pa[ií]s/i);
    expect(response).not.toContain('Hubo un problema');
  });

  it('fails closed on interpreter timeout without invoking the legacy model or planner', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: true };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      awaiting_reply: 'none', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Necesito una orientación específica';
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.conversationInterpreter.mockRejectedValueOnce(new Error('INTERPRETER_TIMEOUT'));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(), state: processingState(), step, execute, client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: { business_action: null },
    });
  });

  it('retries one transient model failure before using the customer-visible fallback', async () => {
    const step = Object.assign(
      async (
        _name: string,
        run: () => Promise<unknown>,
        options?: { maxAttempts?: number },
      ) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < (options?.maxAttempts ?? 1); attempt += 1) {
          try {
            return await run();
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      },
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient model timeout'))
      .mockResolvedValueOnce({
        is: () => true,
        output: {
          schema_version: 3,
          intent: 'commercial',
          kind: 'reply',
          response: 'Tenemos opciones de inglés y marketing. ¿Qué te gustaría aprender?',
          response_type: 'commercial_reply',
          confidence: 1,
          reason_code: 'CATALOG_REPLY',
          business_action: null,
          memory_candidates: [],
          missing_information: [],
          next_state: 'waiting_user',
          retrieval_used: null,
        },
        iterations: [],
      });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'CATALOG_REPLY',
    });
  });

  async function runModelDecision(output: Record<string, unknown>) {
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => ({
      is: () => true,
      output,
      iterations: [],
    }));
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    return actionSpies.commit.mock.calls[0]?.[0]?.input?.decision;
  }

  it('keeps soft call offers advisory even when the backend could offer a call', async () => {
    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: '¿Querés que nuestra asesora virtual te llame y te oriente?',
      response_type: 'call_offer',
      confidence: 0.9,
      reason_code: 'CALL_OFFER',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision).toMatchObject({
      kind: 'reply',
      response_type: 'commercial_reply',
      reason_code: 'MODEL_ADVISORY_ONLY',
      business_action: null,
    });
  });

  it('degrades an unauthorized model response to an allowed text reply instead of silence', async () => {
    const claimed = claimedResponse();
    claimed.sales_context.allowed_actions = [];
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Te llamamos ahora.',
      response_type: 'call_offer',
      confidence: 0.9,
      reason_code: 'UNAUTHORIZED_CALL_OFFER',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision).toMatchObject({
      kind: 'reply',
      response_type: 'commercial_reply',
      reason_code: 'MODEL_ADVISORY_ONLY',
    });
    expect(decision.response).toBeTruthy();
  });

  it('removes a repeated greeting when prior turns prove the conversation already started', async () => {
    const claimed = claimedResponse();
    (claimed.context as { recent_turns: Array<{
      direction: 'inbound' | 'outbound';
      content: string;
      created_at: string;
    }> }).recent_turns = [{
      direction: 'outbound',
      content: 'Hola, ¿qué curso te interesa?',
      created_at: '2026-08-21T11:59:00.000Z',
    }];
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: '¡Hola! Tenemos cursos de salud, tecnología y negocios.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'CATALOG_REPLY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision.response).toBe('Tenemos cursos de salud, tecnología y negocios.');
  });

  // Regresión P0 (informe 2026-08-23): un send_payment_link que el batch no
  // autoriza terminaba en 422 (AMBIGUOUS_OR_ABSENT_CHOICE) y silencio. El
  // workflow debe degradarlo a una clarificación explícita, nunca callar.
  it('downgrades send_payment_link to a clarification when the batch names no plan', async () => {
    const claimed = claimedResponse();
    claimed.policy.allowed_response_types = ['commercial_reply', 'clarification'];
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Te mando el link del plan de 12 cuotas.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'PAYMENT_LINK',
      business_action: { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null },
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      reason_code: 'MODEL_ADVISORY_ONLY',
      next_state: 'waiting_user',
    });
    expect(decision.response).toBeTruthy();
  });

  it('downgrades send_payment_link to a clarification when the model plan contradicts the batch', async () => {
    const claimed = claimedResponse();
    claimed.policy.allowed_response_types = ['commercial_reply', 'clarification'];
    claimed.context.batch_messages[0].content = 'Quiero las 12 cuotas de 30 dólares';
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Perfecto, te paso el plan de 6 cuotas.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'PAYMENT_LINK',
      business_action: { type: 'send_payment_link', plan_code: 'monthly_6', offering_sku: null },
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      reason_code: 'MODEL_ADVISORY_ONLY',
    });
  });

  it('keeps send_payment_link intact when the batch names the plan and explicitly asks for the link', async () => {
    const claimed = {
      ...claimedResponse(),
      sales_context: {
        ...claimedResponse().sales_context,
        course_of_interest: 'Redes Informáticas',
        offering_code: 'redes-informaticas',
      },
      business_context: paymentBusinessContext(),
      business_context_available: true,
    };
    claimed.policy.allowed_response_types = ['commercial_reply', 'clarification'];
    claimed.context.batch_messages[0].content = 'Confirmo pago único de 360 dólares y pasame el link';
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Perfecto, avanzamos con el pago único.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'PAYMENT_LINK',
      business_action: { type: 'send_payment_link', plan_code: 'one_time', offering_sku: null },
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision).toMatchObject({
      kind: 'reply',
      business_action: {
        type: 'send_payment_link',
        plan_code: 'one_time',
        offering_sku: 'redes-informaticas',
      },
    });
  });

  it('keeps a mid-conversation reply intact when "Buenas" starts a sentence but is not a salutation', async () => {
    const claimed = claimedResponse();
    (claimed.context as { recent_turns: Array<{
      direction: 'inbound' | 'outbound';
      content: string;
      created_at: string;
    }> }).recent_turns = [{
      direction: 'outbound',
      content: 'Hola, ¿qué curso te interesa?',
      created_at: '2026-08-21T11:59:00.000Z',
    }];
    actionSpies.claim.mockResolvedValue(claimed);

    const decision = await runModelDecision({
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'Buenas noticias, el diplomado tiene plan en cuotas desde 30 USD.',
      response_type: 'commercial_reply',
      confidence: 0.9,
      reason_code: 'PRICE_REPLY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    });

    expect(decision.response).toBe('Buenas noticias, el diplomado tiene plan en cuotas desde 30 USD.');
  });
});

describe('processInboundTurn — decision provider selection', () => {
  const originalDecisionProvider = configuration.decisionProvider;
  const originalGeminiApiKey = secrets.GEMINI_API_KEY;
  const originalGroqApiKey = secrets.GROQ_API_KEY;

  beforeEach(() => {
    configuration.automationEnabled = true;
    actionSpies.ingest.mockResolvedValue(ingestResponse());
    actionSpies.claim.mockResolvedValue(claimedResponse());
    actionSpies.commit.mockResolvedValue({
      status: 'rejected',
      replayed: false,
      trace_id: UUID,
      turn_id: UUID,
      decision_id: UUID,
      next_state: 'completed',
      outbound: null,
      call_request: null,
    });
    actionSpies.flush.mockResolvedValue({ status: 'unavailable', completed: 0 });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    configuration.decisionProvider = originalDecisionProvider;
    if (originalGeminiApiKey === undefined) {
      delete secrets.GEMINI_API_KEY;
    } else {
      secrets.GEMINI_API_KEY = originalGeminiApiKey;
    }
    if (originalGroqApiKey === undefined) {
      delete secrets.GROQ_API_KEY;
    } else {
      secrets.GROQ_API_KEY = originalGroqApiKey;
    }
  });

  function invokeHandler(execute: ReturnType<typeof vi.fn>) {
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    return handler({
      input: workflowInput(),
      state: processingState(),
      step,
      execute,
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });
  }

  it('gemini_direct: calls the Gemini adapter directly with the same instructions shape and never calls execute', async () => {
    configuration.decisionProvider = 'gemini_direct';
    configuration.geminiDecisionModel = 'gemini-3.6-flash';
    secrets.GEMINI_API_KEY = 'test-gemini-key';
    actionSpies.geminiDecision.mockResolvedValue({
      decision: {
        schema_version: 3,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te cuento.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      },
      provider: 'google-ai-direct',
      model: 'gemini-3.6-flash',
      latencyMs: 123,
    });
    const execute = vi.fn();

    await invokeHandler(execute);

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.geminiDecision).toHaveBeenCalledTimes(1);
    expect(actionSpies.geminiDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-gemini-key',
        model: 'gemini-3.6-flash',
        instructions: expect.any(String),
        signal: expect.any(AbortSignal),
        timeoutMs: expect.any(Number),
      }),
    );
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'ANSWER',
    });

    const logLines = vi.mocked(console.info).mock.calls.map(([line]) => String(line));
    for (const line of logLines) {
      expect(line).not.toContain('test-gemini-key');
    }
  });

  it('botpress_managed: keeps calling execute and never calls the Gemini adapter', async () => {
    configuration.decisionProvider = 'botpress_managed';
    const execute = vi.fn(async () => ({
      is: () => true,
      output: {
        schema_version: 3,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te cuento.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      },
      iterations: [],
    }));

    await invokeHandler(execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(actionSpies.geminiDecision).not.toHaveBeenCalled();
    expect(actionSpies.groqDecision).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'ANSWER',
    });
  });

  it('groq_direct: calls Groq with the same instructions and never calls managed or Gemini', async () => {
    configuration.decisionProvider = 'groq_direct';
    configuration.groqDecisionModel = 'openai/gpt-oss-120b';
    secrets.GROQ_API_KEY = 'test-groq-key';
    actionSpies.groqDecision.mockResolvedValue({
      decision: {
        schema_version: 3,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te cuento.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        retrieval_used: null,
      },
      provider: 'groq-direct',
      model: 'openai/gpt-oss-120b',
      latencyMs: 80,
    });
    const execute = vi.fn();

    await invokeHandler(execute);

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.geminiDecision).not.toHaveBeenCalled();
    expect(actionSpies.groqDecision).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-groq-key',
      model: 'openai/gpt-oss-120b',
      instructions: expect.stringContaining('COMPACT_AGENT_A_V16'),
      signal: expect.any(AbortSignal),
      timeoutMs: expect.any(Number),
    }));
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'ANSWER',
    });
  });

  it('groq_direct: turns one 429 into a bounded contextual fallback', async () => {
    configuration.decisionProvider = 'groq_direct';
    configuration.groqDecisionModel = 'openai/gpt-oss-120b';
    secrets.GROQ_API_KEY = 'test-groq-key';
    actionSpies.groqDecision.mockRejectedValue(
      new StudyxHttpError('GROQ_HTTP_429', false),
    );
    const execute = vi.fn();

    await expect(invokeHandler(execute)).resolves.toBeDefined();

    expect(actionSpies.groqDecision).toHaveBeenCalledTimes(1);
    expect(actionSpies.geminiDecision).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'MODEL_UNAVAILABLE',
      next_state: 'waiting_user',
    });
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision.response)
      .toMatch(/presupuesto|precio/i);
  });

  it('gemini_direct: degrades to a conversational reply when GEMINI_API_KEY is missing', async () => {
    configuration.decisionProvider = 'gemini_direct';
    delete secrets.GEMINI_API_KEY;
    const claimed = claimedResponse();
    claimed.policy.allowed_response_types = ['commercial_reply', 'technical_fallback'];
    actionSpies.claim.mockResolvedValue(claimed);
    const execute = vi.fn();

    await expect(invokeHandler(execute)).resolves.toBeDefined();

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.geminiDecision).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'MODEL_UNAVAILABLE',
      next_state: 'waiting_user',
    });

    // No PII and no key value in any log line — the error code naming the
    // missing secret is fine (it carries no secret material), only the
    // actual key value must never appear.
    const logLines = vi.mocked(console.info).mock.calls.map(([line]) => String(line));
    for (const line of logLines) {
      expect(line).not.toContain('test-gemini-key');
      expect(line).not.toContain('¿Cuánto sale el curso?');
    }
  });
});

describe('requestStudyxJson timeout default', () => {
  const originalTimeout = configuration.requestTimeoutMs;

  afterEach(() => {
    configuration.requestTimeoutMs = originalTimeout;
  });

  // RED: an unset/undefined `configuration.requestTimeoutMs` (a live runtime
  // whose config schema failed to apply, or a stub missing the field) must
  // not translate into `setTimeout(fn, undefined)` — a bare fetch with no
  // effective bound.
  it('falls back to 8000ms when configuration.requestTimeoutMs is missing', () => {
    configuration.requestTimeoutMs = undefined as unknown as number;
    expect(resolveRequestTimeoutMs()).toBe(8000);
    expect(resolveRequestTimeoutMs()).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('uses the configured value when one is present', () => {
    configuration.requestTimeoutMs = 4321;
    expect(resolveRequestTimeoutMs()).toBe(4321);
  });
});

describe('router dispatch — non-message callbacks never reach the workflow dispatcher', () => {
  const conversation = { id: 'conv-1', alias: 'telegram', integration: 'telegram' };

  // RED: an inline keyboard callback, edited-message notification, or any
  // other non-`message` conversation event must be skipped by dispatch()
  // before the router ever calls `processInboundTurn.getOrCreate` — starting
  // a durable workflow for a callback would be a phantom turn with no user
  // message behind it.
  it('skips a non-message event type instead of matching a channel adapter', () => {
    const result = dispatch({
      type: 'callback',
      channel: 'telegram.channel',
      message: { id: 'cb-1' },
      conversation,
      traceId: 'trace-callback-1',
    });
    expect(result).toEqual({
      kind: 'skip',
      adapter: null,
      reason: 'EVENT_TYPE_UNSUPPORTED',
    });
  });

  it('still dispatches an ordinary inbound text message on the same channel', () => {
    const result = dispatch({
      type: 'message',
      channel: 'telegram.channel',
      message: {
        id: 'msg-1',
        createdAt: NOW,
        type: 'text',
        direction: 'incoming',
        userId: 'user-1',
        conversationId: 'conv-1',
        payload: { text: 'hola' },
        tags: { 'telegram:chatId': '123456' },
      },
      conversation: { ...conversation, tags: { 'telegram:fromUserId': '123456' } },
      traceId: 'trace-message-1',
    });
    expect(result.kind).toBe('envelope');
  });
});
