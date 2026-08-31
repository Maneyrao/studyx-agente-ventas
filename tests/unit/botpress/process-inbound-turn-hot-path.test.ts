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
  generateAgentATurnProposalV1: actionSpies.agentABrain,
  generateDeepSeekAgentATurnProposalV1: actionSpies.agentABrainDeepSeek,
  generateOpenAIAgentATurnProposalV1: actionSpies.agentABrainOpenAI,
  generateGeminiAgentATurnProposalV1: actionSpies.agentABrainGemini,
  parseAgentATurnProposalV1: (raw: unknown) => raw,
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

import { configuration, secrets } from '../../helpers/botpress-runtime-stub';
import { processInboundTurn } from '../../../botpress-agent/src/workflows/processInboundTurn';
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
    secrets.GROQ_API_KEY = 'gsk-local-test-only';
    delete secrets.DEEPSEEK_API_KEY;
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
        next_awaiting_reply: 'none',
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
    ['legacy', false, false, 0, 0, 1],
    ['shadow', false, true, 1, 0, 1],
    ['authoritative', true, false, 1, 1, 0],
  ] as const)(
    'routes the %s brain rollout without shadow mutation',
    async (_mode, enabled, shadow, expectedBrainCalls, expectedPlannerCalls, expectedLegacyCalls) => {
      const claimed = claimedResponse() as unknown as ClaimedTurn;
      claimed.features = {
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

      expect(actionSpies.agentABrain).toHaveBeenCalledTimes(expectedBrainCalls);
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
          model: { prompt_version: 'studyx-agent-a-brain-v2' },
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
          brain_prompt_version: 'studyx-agent-a-brain-v2',
          brain_model: 'openai/gpt-oss-120b',
          brain_source: 'model',
          context_recent_turn_count: 0,
          context_memory_count: 0,
          used_memory_count: 0,
          proposed_action_type: 'none',
        });
      }
    },
  );

  it('fails closed silently when the authoritative brain is unavailable', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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
    actionSpies.agentABrain.mockRejectedValue(
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
    expect(execute).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      decision: {
        kind: 'suppress',
        response: null,
        reason_code: 'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK',
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
      authorized_action_type: 'none',
    });
  });

  it('uses the managed model with the same brain contract when Groq is rate limited', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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
    actionSpies.agentABrain.mockRejectedValue(
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

    expect(actionSpies.agentABrain).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const failoverFailure = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_provider_failover_failed');
    expect(failoverFailure).toBeUndefined();
    expect(actionSpies.plan).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        move: expect.objectContaining({ move: 'select_area', area_reference: 'Salud y Bienestar' }),
      }),
    }));
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: expect.objectContaining({ move: 'select_area' }),
      },
      model: { provider: 'botpress' },
    });
  });

  it('uses OpenAI Terra as the primary authoritative brain when its production secret exists', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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

    expect(actionSpies.agentABrainOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'openai-local-test-only',
      model: 'gpt-5.6-terra',
    }));
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        composition: { narrative: { opening: expect.stringContaining('Dentro de tecnología') } },
      },
      model: { provider: 'openai-direct', model: 'gpt-5.6-terra' },
    });
  });

  it('uses DeepSeek Flash before every legacy provider when its production secret exists', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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

  it('lets the authoritative DeepSeek brain compose a greeting without an optional runtime flag', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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
        next_awaiting_reply: 'none', selected_offering_code: null, selected_payment_plan: null,
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
        kind: 'suppress',
        response: null,
        reason_code: 'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK',
      },
    });
  });

  it('keeps the natural brain active through direct Gemini before any canned fallback', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
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

    const failoverFailure = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_provider_failover_failed');
    expect(failoverFailure).toBeUndefined();
    expect(actionSpies.agentABrainGemini).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: expect.objectContaining({ move: 'select_area' }),
        composition: {
          narrative: expect.objectContaining({
            opening: expect.stringContaining('encaje con lo que querés lograr'),
          }),
        },
      },
      model: { provider: 'google-ai-direct', model: 'gemini-2.5-flash' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  async function runCommittedOutbound(
    outbound: Record<string, unknown>,
    inputOverrides: Record<string, unknown> = {},
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
      call_request: null,
    });
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-message-1' } }));
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

  it('runs interpreter → authoritative planner → value-free composition only when V1 is enabled', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { conversation_pipeline_v1_enabled: true };
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

    expect(actionSpies.conversationInterpreter).toHaveBeenCalledTimes(1);
    expect(actionSpies.plan).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]?.instructions).toContain('studyx-sales-behavior-v1');
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: {
        move: { move: 'continue_by_chat' },
        plan_hash: 'a'.repeat(64),
        composition: {
          used_fact_ids: [],
          narrative: {
            opening: 'Perfecto, seguimos por chat.',
            explanation: 'Te acompaño por este medio.',
            next_question: '¿Qué aspecto querés revisar?',
          },
        },
      },
      decision: { reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND' },
      model: {
        prompt_version: 'studyx-conversation-interpreter-v1.5+studyx-conversation-composer-v2+studyx-sales-behavior-v1',
      },
    });
  });

  it('keeps V1 behind the automation kill switch even when the feature flag is projected', async () => {
    configuration.automationEnabled = false;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { conversation_pipeline_v1_enabled: true };
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
    claimed.features = { conversation_pipeline_v1_enabled: true };
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
        next_awaiting_reply: 'none',
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

  it('does not execute a canned call route when the authoritative brain is unavailable', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'call_accepted_offer';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.context.batch_messages[0].content = 'Sí, llamame';
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('DEEPSEEK_UNAVAILABLE'));
    actionSpies.agentABrain.mockRejectedValueOnce(new Error('GROQ_UNAVAILABLE'));
    actionSpies.plan.mockResolvedValueOnce({
      plan: {
        schema_version: 1, next_stage: 'handoff', response_goal: 'confirm_call_request',
        canonical_fact_requests: [],
        allowed_business_action: { type: 'request_call_now', reason: 'accepted_offer' },
        missing_information: [], should_offer_call: false,
        next_call_preference: 'call', next_call_offer_status: 'accepted', next_call_offer_count: 1,
        next_awaiting_reply: 'none', selected_offering_code: 'redes-informaticas',
        selected_payment_plan: null,
      },
      fact_refs: [], state_version: 3, plan_hash: 'b'.repeat(64),
    });
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
        kind: 'suppress',
        response: null,
        business_action: null,
        reason_code: 'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK',
      },
    });
  });

  it('fails closed on interpreter timeout without invoking the legacy model or planner', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { conversation_pipeline_v1_enabled: true };
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
