import { deriveCourseBonusLadderV1 } from '../../../src/shared/conversation/bonus-ladder';
import { buildAuthorizedEgress } from '../../../src/features/orchestration/domain/egress-guard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as evidencePersistence from '../../../botpress-agent/src/lib/observability/persist-turn-evidence';

const actionSpies = vi.hoisted(() => ({
  ingest: vi.fn(),
  recovery: vi.fn(),
  captureProfile: vi.fn(),
  claim: vi.fn(),
  plan: vi.fn(),
  catalog: vi.fn(),
  commit: vi.fn(),
  dispatch: vi.fn(),
  delivery: vi.fn(),
  continuation: vi.fn(),
  syncInbound: vi.fn(),
  transcribe: vi.fn(),
  analyzeImage: vi.fn(),
  flush: vi.fn(),
  geminiDecision: vi.fn(),
  groqDecision: vi.fn(),
  agentABrain: vi.fn(),
  agentABrainDeepSeek: vi.fn(),
  agentABrainOpenAI: vi.fn(),
  agentABrainGemini: vi.fn(),
  agentABrainValidate: vi.fn(),
  conversationInterpreter: vi.fn(),
}));

vi.mock('../../../botpress-agent/src/actions/scheduleTurnRecovery', () => ({
  scheduleTurnRecovery: { execute: actionSpies.recovery },
}));
vi.mock('../../../botpress-agent/src/actions/ingestTurn', () => ({
  ingestTurn: { execute: actionSpies.ingest },
}));
vi.mock('../../../botpress-agent/src/actions/captureContactProfile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../botpress-agent/src/actions/captureContactProfile')>(),
  captureContactProfile: { execute: actionSpies.captureProfile },
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
vi.mock('../../../botpress-agent/src/actions/authorizeOutboundContinuation', () => ({
  authorizeOutboundContinuation: { execute: actionSpies.continuation },
}));
vi.mock('../../../botpress-agent/src/lib/inbound/sync-conversation-inbound', () => ({
  synchronizeConversationInbound: actionSpies.syncInbound,
}));
vi.mock('../../../botpress-agent/src/actions/transcribeAudio', () => ({
  transcribeAudio: { execute: actionSpies.transcribe },
}));
vi.mock('../../../botpress-agent/src/actions/analyzeImage', () => ({
  analyzeImage: { execute: actionSpies.analyzeImage },
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
vi.mock('../../../botpress-agent/src/lib/conversation/agent-a-brain', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../botpress-agent/src/lib/conversation/agent-a-brain')>(),
  // La validación real vive en su propio test. Acá se neutraliza para que
  // estos casos midan el ruteo de proveedores, que es lo que afirman: un
  // rechazo real convertiría cada caso en una prueba de la escalera.
  validateAgentATurnProposalV1: (...args: unknown[]) => actionSpies.agentABrainValidate(...args),
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

import { actions as runtimeActions, adk, configuration, secrets } from '../../helpers/botpress-runtime-stub';
import {
  isConfirmedPreSubmissionBlock,
  processInboundTurn,
  whatsappReplyTargetLatencyMs,
} from '../../../botpress-agent/src/workflows/processInboundTurn';
import { buildAgentAContextV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-context';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../../botpress-agent/src/prompts/agent-a-brain-v1';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
  StudyxHttpError,
} from '../../../botpress-agent/src/utils/http';
import { dispatch } from '../../../botpress-agent/src/channels';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const NOW = '2026-08-21T12:00:00.000Z';
const DELIVERY_SUSPENSION = { [Symbol.for('StepSignal')]: true };

it.each([
  'WHATSAPP_BOT_PHONE_ALLOWLIST_INVALID',
  'WHATSAPP_BOT_PHONE_NOT_ALLOWED',
])('treats %s as a confirmed pre-submission block', (reason) => {
  expect(isConfirmedPreSubmissionBlock(reason)).toBe(true);
});

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
    contact_intake_missing: [],
    call_intake_readiness: { status: 'ready', requirements: [] },
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

function technicalContinuityCommitResponse() {
  // Authority prompt line 236: "Ningún faltante, ambigüedad o acción no disponible corta la venta".
  // Provider/repair failure tests reuse this response to assert visible continuity instead of silence.
  const content = 'No quiero suponer algo incorrecto. Dime qué necesitas o a qué curso te refieres y lo resolvemos por aquí.';
  const outbound = {
    id: UUID, content, status: 'pending', delivery_attempt: 1,
    authorized_egress: {
      schema_version: 1,
      content_hash: '7884954416c27f7ad91be3687df387d17579056f0dd294eb2d2b7cf6c88688d2',
      authorized_urls: [], protected_facts: [],
    },
  };
  return {
    status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
    decision_id: UUID, next_state: 'waiting_user', outbound, outbounds: [outbound],
    call_request: null,
  };
}

function technicalContinuityClient() {
  return { createMessage: vi.fn(async () => ({ message: { id: 'bp-technical-continuity' } })) };
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
      occurred_at: new Date().toISOString(),
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
  it('schedules durable recovery when an Agent A decision exhausts database serialization', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {agent_loop_v3_mode:'off',conversation_pipeline_v1_enabled:false,
      agent_a_brain_v1_enabled:true,agent_a_brain_v1_shadow:false};
    claimed.conversation_state_v1 = {selected_offering_code:'redes-informaticas',selected_payment_plan:null,
      stage:'course_selected',call_preference:'unknown',call_offer_status:'not_offered',call_offer_count:0,awaiting_reply:'none',version:2};
    claimed.catalog_index = {as_of:NOW,offerings_total:1,offerings:[{code:'redes-informaticas',
      display_name:'Redes Informáticas',academy:'Tecnología',aliases:['redes']}],injection_suspected_count:0};
    claimed.business_context=paymentBusinessContext();claimed.business_context_available=true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    actionSpies.commit.mockRejectedValue(new StudyxHttpError('INTERNAL_ERROR',true,500,3));
    const getOrCreateWorkflow = vi.fn(async () => ({ workflow: { id: 'serialization-recovery', status: 'pending', tags: {} } }));
    const step = Object.assign(async (_name:string,run:()=>Promise<unknown>)=>run(),{sleep:vi.fn(async()=>undefined)});
    const result = await (processInboundTurn as unknown as {
      definition:{handler:(args:Record<string,unknown>)=>Promise<unknown>};
    }).definition.handler({input:workflowInput(),state:processingState(),step,execute:vi.fn(),client:{ getOrCreateWorkflow },
      signal:new AbortController().signal,workflow:{id:'serialization-test'}});
    expect(result).toMatchObject({status:'retry_pending',delivery_status:null});
    expect(actionSpies.recovery).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery.mock.calls[0]?.[0].input).toMatchObject({reason_code:'AGENT_A_COMMIT_FAILED'});
  });
  it.each([false, true])('finalizes a backend repair that newly enables Rule A, without a third provider request and with the actual origin (complete=%s)', async complete => {
    const paid = 'introduccion_ecommerce';
    const prior = 'fotografia_celulares_tiendas_online';
    const next = 'publicidad_redes_sociales';
    const priorName = 'Fotografía con Celulares para Tiendas Online';
    const completeText = `Te quedan Introducción al Ecommerce + ${priorName} y Publicidad en Redes Sociales sin costo extra. Avanzamos?`;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.context.batch_messages[0].content = 'me sigue pareciendo caro';
    claimed.conversation_state_v1 = { selected_offering_code: paid, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', version: 2 };
    claimed.catalog_index = { as_of: NOW, offerings_total: 3, injection_suspected_count: 0, offerings: [
      { code: paid, display_name: 'Introducción al Ecommerce', academy: 'Marketing', aliases: [] },
      { code: prior, display_name: priorName, academy: 'Marketing', aliases: [] },
      { code: next, display_name: 'Publicidad en Redes Sociales', academy: 'Marketing', aliases: [] },
    ] };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context.offerings[0] = { ...claimed.business_context.offerings[0], code: paid,
      display_name: 'Introducción al Ecommerce', classes: 8 };
    claimed.business_context_available = true;
    claimed.course_bonus_capability = { status: 'offer_available', enabled: true, max_bonus_courses: 3, may_offer_bonus: true,
      may_schedule_checkin: false, may_request_review: false, may_accept_offer: true, may_send_promoted_payment: false,
      package_status: 'offered', promotion_code: 'test-offered', interest_offering_code: paid,
      bonus_offerings: [{ code: prior, display_name: priorName, position: 1 }],
      delivered_bonus_offerings: [{ code: prior, display_name: priorName, position: 1 }],
      ladder: deriveCourseBonusLadderV1({ observed_price_objection_count: 2, call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: false }),
      rule_bonus: { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce', bonus_offering_code: next, display_name: 'Publicidad en Redes Sociales', position: 2 } };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    const generated = (proposal: Record<string, unknown>) => ({ proposal,
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 });
    const base = { schema_version: 1, proposed_action: { type: 'none' }, course_mentions: [],
      profile_updates: [], profile_requests: [], used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null };
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce(generated({ ...base,
      move: { schema_version: 1, move: 'report_payment', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Te cuento las opciones.'], call_offer: null } }))
      .mockImplementationOnce(async ({ context }: { context: AgentAContextV1 }) => generated({ ...base,
        move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], course_reference: paid, confidence: 1 },
        response: { messages: [complete ? completeText : 'Te sumo Publicidad en Redes Sociales sin costo extra.'], call_offer: null },
        proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: next },
        course_mentions: complete ? [{ offering_code: paid, role: 'paid' }, { offering_code: prior, role: 'bonus' },
          { offering_code: next, role: 'bonus' }] : [{ offering_code: next, role: 'bonus' }],
        memory_candidates: [{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'caro', confidence: 1 }],
        repair_of: { rejection_id: context.turn_rejection!.rejection_id, attempt: 1 },
      }));
    actionSpies.commit.mockRejectedValueOnce(new StudyxHttpError('DECISION_REJECTED', false, 422, 1,
      { reason: 'AGENT_TURN_V2_REJECTED:FACT_NOT_AUTHORIZED', subjects: ['course_logistics.classes'] }))
      .mockResolvedValueOnce({ status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user', outbound: null, outbounds: [], call_request: null });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step, execute: vi.fn(),
      client: {}, signal: new AbortController().signal, workflow: { id: 'rule-a-backend-finalization' } });
    expect(result).toMatchObject({ status: 'waiting_user', error_code: null });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit).toHaveBeenCalledTimes(2);
    const final = actionSpies.commit.mock.calls[1][0].input.agent_turn_v2.proposal;
    expect(final.proposed_action).toEqual({ type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: next });
    expect(final.response.messages).toEqual(complete ? [completeText] : [
      'Dejame revisar qué te puedo ofrecer, dame un segundo.',
      `Te sumo también Publicidad en Redes Sociales. Te quedan Introducción al Ecommerce + ${priorName} y Publicidad en Redes Sociales sin costo extra, al mismo precio. Avanzamos?`,
    ]);
    const records = vi.mocked(console.info).mock.calls.flatMap(([line]) => {
      try { const event = JSON.parse(String(line)); return event.event === 'studyx.turn.deterministic_rules' ? [event] : []; }
      catch { return []; }
    });
    expect(records.at(-1)).toMatchObject({ rule_a: complete ? 'rewrite' : 'fixed', phase: 'final_candidate' });
  });

  it('keeps A+B and the original call interpretation at the final commit after the single rewrite invents chat and vetoes call', async () => {
    const paid = 'introduccion_ecommerce';
    const bonus = 'fotografia_celulares_tiendas_online';
    const bonusName = 'Fotografía con Celulares para Tiendas Online';
    const invitation = 'Si querés, podemos verlo en una llamada corta. Te sirve?';
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.context.batch_messages[0].content = 'Sólo el precio me frena, me parece caro. Ofreceme esa promoción para sumar un curso sin costo.';
    claimed.context.recent_turns = [{ direction: 'outbound', content: 'Qué te frena?', created_at: NOW }];
    claimed.conversation_state_v1 = { selected_offering_code: paid, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', version: 2 };
    claimed.catalog_index = { as_of: NOW, offerings_total: 2, injection_suspected_count: 0, offerings: [
      { code: paid, display_name: 'Introducción al Ecommerce', academy: 'Marketing', aliases: [] },
      { code: bonus, display_name: bonusName, academy: 'Marketing', aliases: [] },
    ] };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context.offerings[0] = { ...claimed.business_context.offerings[0], code: paid,
      display_name: 'Introducción al Ecommerce', classes: 8 };
    claimed.business_context_available = true;
    claimed.course_bonus_capability = { status: 'checkin_available', enabled: true, max_bonus_courses: 3, may_offer_bonus: false,
      may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
      package_status: null, promotion_code: null, interest_offering_code: paid, bonus_offerings: [],
      ladder: deriveCourseBonusLadderV1({ observed_price_objection_count: 0, call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: true }),
      rule_bonus: { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce', bonus_offering_code: bonus, display_name: bonusName, position: 1 } };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    const generated = (proposal: Record<string, unknown>) => ({ proposal,
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 });
    const base = { schema_version: 1, proposed_action: { type: 'none' }, course_mentions: [],
      profile_updates: [], profile_requests: [], used_fact_ids: [], used_memory_ids: [], repair_of: null,
      memory_candidates: [{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'caro', confidence: 1 },
        { type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'Sólo el precio me frena', confidence: 1 }] };
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce(generated({ ...base,
      move: { schema_version: 1, move: 'defer_payment', secondary_moves: [], vetoes: [], course_reference: paid, confidence: 1 },
      response: { messages: ['Te cuento las opciones.'], call_offer: null } }))
      .mockImplementationOnce(async ({ context }: { context: AgentAContextV1 }) => generated({ ...base,
        move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: ['decline_call'], vetoes: ['call'], course_reference: paid, confidence: 1 },
        response: { messages: [`Te sumo ${bonusName} sin costo extra. Avanzamos?`], call_offer: invitation },
        proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: bonus },
        course_mentions: [{ offering_code: bonus, role: 'bonus' }],
        repair_of: { rejection_id: context.turn_rejection!.rejection_id, attempt: 1 },
      }));
    actionSpies.commit.mockResolvedValueOnce({ status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'waiting_user', outbound: null, outbounds: [], call_request: null });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    await (processInboundTurn as unknown as { definition: { handler: (args: Record<string, unknown>) => Promise<unknown> } })
      .definition.handler({ input: workflowInput(), state: processingState(), step, execute: vi.fn(),
        client: {}, signal: new AbortController().signal, workflow: { id: 'call-control-rewrite' } });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit).toHaveBeenCalledOnce();
    const final = actionSpies.commit.mock.calls[0][0].input.agent_turn_v2.proposal;
    expect(final.move).toMatchObject({ move: 'defer_payment', secondary_moves: [], vetoes: [] });
    expect(final.response.call_offer).toBe(invitation);
    const records = vi.mocked(console.info).mock.calls.flatMap(([line]) => {
      try { const event = JSON.parse(String(line)); return event.event === 'studyx.turn.deterministic_rules' ? [event] : []; }
      catch { return []; }
    });
    expect(records.at(-1)).toMatchObject({ rule_a: 'rewrite', rule_b: 'rewrite', phase: 'final_candidate' });
  });

  it('uses a stable 8–14 second WhatsApp reply target', () => {
    const first = whatsappReplyTargetLatencyMs('wamid.first');
    const repeated = whatsappReplyTargetLatencyMs('wamid.first');
    const second = whatsappReplyTargetLatencyMs('wamid.second');

    expect(first).toBe(repeated);
    expect(first).toBeGreaterThanOrEqual(8_000);
    expect(first).toBeLessThanOrEqual(14_000);
    expect(second).toBeGreaterThanOrEqual(8_000);
    expect(second).toBeLessThanOrEqual(14_000);
  });
  beforeEach(() => {
    for (const spy of Object.values(actionSpies)) spy.mockReset();
    actionSpies.recovery.mockResolvedValue({ outcome: 'scheduled', attempt: 1, delay_ms: 2000 });
    configuration.automationEnabled = true;
    configuration.whatsappPublicEnabled = false;
    configuration.whatsappCanaryEnabled = false;
    configuration.whatsappAllowedBotPhoneNumberId = '';
    configuration.decisionProvider = 'botpress_managed';
    configuration.agentAPlannerlessV2Enabled = false;
    configuration.agentAAgentLoopV3KillSwitch = false;
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    delete secrets.GROQ_API_KEY;
    delete secrets.OPENAI_API_KEY;
    delete secrets.GEMINI_API_KEY;
    actionSpies.ingest.mockResolvedValue(ingestResponse());
    actionSpies.claim.mockResolvedValue(claimedResponse());
    actionSpies.agentABrainValidate.mockReturnValue(null);
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
    actionSpies.continuation.mockResolvedValue({ outcome: 'authorized', trace_id: UUID, outbound_id: UUID });
    actionSpies.syncInbound.mockResolvedValue(undefined);
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([false, true])('pauses an evidence failure before provider send without claiming ambiguity (multipart=%s)', async multipart => {
    const receipt = technicalContinuityCommitResponse();
    actionSpies.commit.mockResolvedValue({ ...receipt, ...(multipart ? { outbounds: [
      { ...receipt.outbound, part_index: 0, part_count: 1, status: 'pending', delivery_attempt: 1 },
    ] } : {}) });
    vi.spyOn(evidencePersistence, 'persistTurnEvidence').mockImplementation(async (_subject, event) => {
      if (event.kind === 'provider_send_attempt') throw new Error('DB_UNAVAILABLE');
    });
    const client = technicalContinuityClient();
    const state = processingState();
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });
    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state, step, client,
      execute: vi.fn(), signal: new AbortController().signal,
      workflow: { id: 'evidence-before-send', setTimeout: vi.fn() } });
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error_code: 'TURN_EVIDENCE_UNAVAILABLE' });
    expect(state).toMatchObject({ phase: 'paused_error', errorCode: 'TURN_EVIDENCE_UNAVAILABLE' });
  });

  it('abandons a queued WhatsApp turn for a non-allowed business number before ingesting it', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappCanaryEnabled = false;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    const input = {
      ...workflowInput(),
      channel: 'whatsapp',
      message: {
        ...workflowInput().message,
        metadata: { bot_phone_number_id: 'blocked-business-number-72' },
      },
    };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input,
      state: processingState(),
      step,
      execute: vi.fn(),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'blocked-whatsapp-number-test', setTimeout: vi.fn(async () => undefined) },
    });

    expect(result).toMatchObject({
      status: 'abandoned',
      error_code: 'WHATSAPP_BOT_PHONE_NOT_ALLOWED',
    });
    expect(actionSpies.ingest).not.toHaveBeenCalled();
    expect(actionSpies.transcribe).not.toHaveBeenCalled();
  });

  it('does not show typing presence to a blocked contact', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.policy = { may_respond: false, allowed_response_types: [], reason: 'CONTACT_BLOCKED' };
    claimed.contact.blocked = true;
    actionSpies.ingest.mockResolvedValue({
      ...ingestResponse(),
      policy: { may_respond: false, allowed_response_types: [], reason: 'CONTACT_BLOCKED' },
      contact: { ...ingestResponse().contact, blocked: true },
    });
    actionSpies.claim.mockResolvedValue(claimed);
    const startTyping = vi.spyOn(runtimeActions.whatsapp, 'startTypingIndicator');
    const stopTyping = vi.spyOn(runtimeActions.whatsapp, 'stopTypingIndicator');
    const input = {
      ...workflowInput(), channel: 'whatsapp',
      message: {
        ...workflowInput().message,
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
      },
    };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });

    await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input, state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal,
      workflow: { id: 'blocked-contact-typing-test', setTimeout: vi.fn(async () => undefined) },
    });

    expect(startTyping).not.toHaveBeenCalled();
    expect(stopTyping).not.toHaveBeenCalled();
  });

  it('starts and stops WhatsApp typing presence around an authorized turn', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.context.batch_messages[0].content = 'Hola';
    actionSpies.claim.mockResolvedValue(claimed);
    const startTyping = vi.spyOn(runtimeActions.whatsapp, 'startTypingIndicator');
    const stopTyping = vi.spyOn(runtimeActions.whatsapp, 'stopTypingIndicator');
    const input = {
      ...workflowInput(), channel: 'whatsapp', external_message_id: 'wamid.typing-test',
      message: {
        ...workflowInput().message, text: 'Hola',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
      },
    };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });

    await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input, state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal,
      workflow: { id: 'authorized-typing-test', setTimeout: vi.fn(async () => undefined) },
    });

    expect(startTyping).toHaveBeenCalledWith({
      conversationId: 'bp-conversation', messageId: 'wamid.typing-test', timeout: 60_000,
    });
    expect(stopTyping).toHaveBeenCalledWith({
      conversationId: 'bp-conversation', messageId: 'wamid.typing-test',
    });
    expect(startTyping.mock.invocationCallOrder[0]).toBeLessThan(
      actionSpies.claim.mock.invocationCallOrder[0]!,
    );
    expect(startTyping.mock.invocationCallOrder[0]).toBeLessThan(stopTyping.mock.invocationCallOrder[0]!);
  });

  it('keeps the commercial turn alive when WhatsApp typing presence fails', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.context.batch_messages[0].content = 'Hola';
    actionSpies.claim.mockResolvedValue(claimed);
    const startTyping = vi.spyOn(runtimeActions.whatsapp, 'startTypingIndicator')
      .mockRejectedValueOnce(new Error('WHATSAPP_PRESENCE_UNAVAILABLE'));
    const stopTyping = vi.spyOn(runtimeActions.whatsapp, 'stopTypingIndicator');
    const input = {
      ...workflowInput(), channel: 'whatsapp',
      message: {
        ...workflowInput().message, text: 'Hola',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
      },
    };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input, state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal,
      workflow: { id: 'typing-failure-test', setTimeout: vi.fn(async () => undefined) },
    });

    expect(startTyping).toHaveBeenCalledTimes(1);
    expect(stopTyping).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed' });
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
  });

  it.each(['ingest', 'claim', 'syncInbound'] as const)('recovers a transient %s outage durably before accepting a terminal backend result', async stage => {
    actionSpies[stage].mockRejectedValueOnce(new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4));
    actionSpies.claim.mockResolvedValue({ outcome: 'completed', trace_id: UUID, batch_id: UUID, retry_after_ms: 0 });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async (name: string, delayMs: number) => { void name; void delayMs; }) });
    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client: {}, signal: new AbortController().signal,
      workflow: { id: 'recover-test', setTimeout: vi.fn(async () => undefined) } });

    expect(result).toMatchObject({ status: 'completed', error_code: null });
    expect(actionSpies[stage]).toHaveBeenCalledTimes(2);
    const recoveryDelays = step.sleep.mock.calls
      .filter(call => String(call[0]).includes('recovery-wait'))
      .map(call => Number(call[1]));
    expect(recoveryDelays).toHaveLength(1);
    expect(recoveryDelays[0]).toBeGreaterThanOrEqual(2_000);
    expect(recoveryDelays[0]).toBeLessThanOrEqual(15_000);
    expect(actionSpies.commit).not.toHaveBeenCalled();
  });

  it('never schedules multi-minute silence across consecutive transient inbound failures', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      actionSpies.ingest.mockRejectedValueOnce(
        new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4),
      );
    }
    actionSpies.claim.mockResolvedValue({
      outcome: 'completed', trace_id: UUID, batch_id: UUID, retry_after_ms: 0,
    });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async (name: string, delayMs: number) => { void name; void delayMs; }),
    });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client: {}, signal: new AbortController().signal,
      workflow: { id: 'bounded-silence-test', setTimeout: vi.fn(async () => undefined) },
    });

    const recoveryDelays = step.sleep.mock.calls
      .filter(call => String(call[0]).includes('recovery-wait'))
      .map(call => Number(call[1]));
    expect(result).toMatchObject({ status: 'completed', error_code: null });
    expect(actionSpies.ingest).toHaveBeenCalledTimes(7);
    expect(recoveryDelays).toHaveLength(6);
    expect(Math.max(...recoveryDelays)).toBeLessThanOrEqual(15_000);
    expect(actionSpies.commit).not.toHaveBeenCalled();
  });

  it('resumes a persisted transient failure after the ADK durable sleep suspends execution', async () => {
    actionSpies.ingest.mockRejectedValueOnce(new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4));
    actionSpies.claim.mockResolvedValue({ outcome: 'completed', trace_id: UUID, batch_id: UUID, retry_after_ms: 0 });
    const suspension = { [Symbol('adk-step-signal')]: true };
    const persisted = new Map<string, unknown>();
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (persisted.has(name)) {
        const stored = persisted.get(name);
        // ADK reconstructs failed steps as Error, losing custom error fields.
        if (stored instanceof Error) throw new Error(stored.message);
        return structuredClone(stored);
      }
      try { const output = await run(); persisted.set(name, structuredClone(output)); return output; }
      catch (error) { persisted.set(name, error); throw error; }
    }, { sleep: vi.fn(async (name: string, delayMs: number) => { void name; void delayMs; }) });
    step.sleep.mockRejectedValueOnce(suspension);
    const state = processingState();
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    const args = { input: workflowInput(), state, step, execute: vi.fn(), client: {},
      signal: new AbortController().signal,
      workflow: { id: 'recover-resume-test', setTimeout: vi.fn(async () => undefined) } };
    await expect(handler(args)).rejects.toBe(suspension);
    await expect(handler(args)).resolves.toMatchObject({ status: 'completed', error_code: null });
    expect(actionSpies.ingest).toHaveBeenCalledTimes(2);
    // A later replay must reach cached success even after its retry budget
    // expired; it must not reconsider a retry that already completed.
    Object.assign(state, { inboundRecoveryDeadlineAt: Date.now() - 1 });
    await expect(handler(args)).resolves.toMatchObject({ status: 'completed', error_code: null });
    expect(actionSpies.ingest).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit).not.toHaveBeenCalled();
  });

  it('reuses successful ingest and claim steps saved before recovery receipts existed', async () => {
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (name === 'ingest-canonical-turn') return ingestResponse();
      if (name === 'claim-inbound-batch-0') return { outcome: 'completed', trace_id: UUID, batch_id: UUID, retry_after_ms: 0 };
      return run();
    }, { sleep: vi.fn(async (name: string, delayMs: number) => { void name; void delayMs; }) });
    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client: {}, signal: new AbortController().signal, workflow: { id: 'legacy-cache-test' } });
    expect(result).toMatchObject({ status: 'completed', error_code: null });
    expect(actionSpies.ingest).not.toHaveBeenCalled();
    expect(actionSpies.claim).not.toHaveBeenCalled();
    expect(actionSpies.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['transient', new StudyxHttpError('STUDYX_TIMEOUT', true)],
    ['permanent', new StudyxHttpError('INVALID_STUDYX_RESPONSE', false)],
  ] as const)('leaves %s ingest failures durably pending without claim or external effects', async (_kind, failure) => {
    const suspension = { [Symbol.for('StepSignal')]: true };
    actionSpies.ingest.mockRejectedValue(failure);
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => { throw suspension; }) });
    const state = processingState();
    const result = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state, step,
      execute: vi.fn(), client: {}, signal: new AbortController().signal,
      workflow: { id: 'bounded-recover-test', setTimeout: vi.fn(async () => undefined) } });
    await expect(result).rejects.toBe(suspension);
    expect(state).toMatchObject({ phase: 'retry_pending', errorCode: failure.code });
    expect(actionSpies.ingest).toHaveBeenCalledTimes(1);
    expect(step.sleep).toHaveBeenCalledTimes(1);
    expect(actionSpies.claim).not.toHaveBeenCalled();
    expect(actionSpies.commit).not.toHaveBeenCalled();
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
  });

  it('keeps scheduling ingestion after the old eight-minute deadline instead of completing the lost event', async () => {
    const suspension = { [Symbol.for('StepSignal')]: true };
    actionSpies.ingest.mockRejectedValue(new StudyxHttpError('STUDYX_TIMEOUT', true));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => { throw suspension; }) });
    const result = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: { ...processingState(), inboundRecoveryDeadlineAt: Date.now() - 1 }, step,
      execute: vi.fn(), client: {}, signal: new AbortController().signal,
      workflow: { id: 'expired-recovery-test', setTimeout: vi.fn(async () => undefined) } });
    await expect(result).rejects.toBe(suspension);
    expect(actionSpies.ingest).toHaveBeenCalledTimes(1);
    expect(step.sleep).toHaveBeenCalledTimes(1);
    expect(actionSpies.claim).not.toHaveBeenCalled();
  });

  it('preserves an old real-channel event for review without retiming or ingesting it', async () => {
    const suspension = { [Symbol.for('StepSignal')]: true };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => { throw suspension; }) });
    const state = processingState();
    const input = { ...workflowInput(), channel: 'telegram',
      message: { ...workflowInput().message, occurred_at: new Date(Date.now() - 11 * 60_000).toISOString() } };
    actionSpies.claim.mockResolvedValue({ outcome: 'completed', trace_id: UUID, batch_id: UUID, retry_after_ms: 0 });
    const promise = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input, state, step, execute: vi.fn(), client: {},
      signal: new AbortController().signal,
      workflow: { id: 'aged-event-test', setTimeout: vi.fn(async () => undefined) } });
    await expect(promise).rejects.toBe(suspension);
    expect(actionSpies.ingest).not.toHaveBeenCalled();
    expect(actionSpies.claim).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: 'retry_pending', needsOperator: true,
      pendingInboundRecovery: { errorCode: 'INBOUND_EVENT_REQUIRES_REVIEW', needsOperator: true } });
  });

  it('persists independent profile fields before effect validation and repairs from the receipt', async () => {
    configuration.agentAPlannerlessV2Enabled = true;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.deterministic_route = null;
    claimed.contact_intake = { nombre: null, apellido: null, correo: null, telefono: '+5491169004497' };
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo'];
    claimed.conversation_state_v1 = { selected_offering_code: null, selected_payment_plan: null, stage: 'exploring',
      call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', version: 0 };
    claimed.contact_profile = { version: 0, sources: [{ id: UUID, text: 'María José', sequence: 1 }], pending_requests: [] };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.captureProfile.mockResolvedValue({ version: 1,
      values: { nombre: 'María José', apellido: null, correo: null, telefono: '+5491169004497' },
      accepted_fields: ['nombre'], rejections: [],
      contact_profile_snapshot: {
        version: 2,
        values: { nombre: 'María José', apellido: 'Pérez', correo: null, telefono: '+5491169004497' },
        call_intake_readiness: {
          status: 'needs_input',
          intake: { nombre: 'María José', apellido: 'Pérez', correo: null, telefono: '+5491169004497' },
          requirements: [{ field: 'correo', reason: 'missing' }],
        },
      } });
    expect(buildAgentAContextV1(claimed)).not.toBeNull();
    actionSpies.commit.mockRejectedValueOnce(new StudyxHttpError('DECISION_REJECTED', false, 422, 1,
      { reason: 'AGENT_TURN_V2_REJECTED:MISSING_INTAKE', subjects: ['correo'] }));
    const original = { schema_version: 1,
      move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: ['request_call'], vetoes: [], confidence: 1 },
      response: { messages: ['Gracias.'], call_offer: null }, proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      profile_updates: [{ field: 'nombre', value: 'María José', operation: 'set', source_message_id: UUID, source_quote: 'María José' }], profile_requests: [],
    };
    actionSpies.agentABrainDeepSeek.mockReset().mockResolvedValueOnce({ proposal: original,
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 })
      .mockImplementationOnce(async ({ context }: { context: AgentAContextV1 }) => {
        expect(context.customer.contact_intake?.nombre).toBe('María José');
        expect(context.customer.contact_intake?.apellido).toBe('Pérez');
        expect(context.capabilities.intake_missing).not.toContain('nombre');
        expect(context.capabilities.intake_missing).not.toContain('apellido');
        return { proposal: { ...original, move: { ...original.move, move: 'unknown', secondary_moves: [] },
          response: { messages: ['María José, me pasás tu correo?'], call_offer: null },
          proposed_action: { type: 'none' }, profile_updates: [],
          profile_requests: [{ message_index: 0, fields: ['correo'], purpose: 'call', mode: 'collect' }],
          repair_of: context.turn_rejection ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null },
          provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 };
      });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), { sleep: vi.fn(async () => undefined) });
    await (processInboundTurn as unknown as { definition: { handler: (args: Record<string, unknown>) => Promise<unknown> } }).definition.handler({
      input: workflowInput(), state: processingState(), step, execute: vi.fn(), client: {}, signal: new AbortController().signal, workflow: { id: 'profile-test' },
    });
    expect(actionSpies.captureProfile).toHaveBeenCalled();
    expect(actionSpies.captureProfile.mock.invocationCallOrder[0]).toBeLessThan(actionSpies.commit.mock.invocationCallOrder[0]!);
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
  });

  it('keeps the safe Agent A turn when one profile observation is rejected', async () => {
    configuration.agentAPlannerlessV2Enabled = true;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.deterministic_route = null;
    claimed.contact_intake = { nombre: null, apellido: null, correo: null, telefono: '+5491169004497' };
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo'];
    claimed.conversation_state_v1 = { selected_offering_code: null, selected_payment_plan: null, stage: 'exploring',
      call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', version: 0 };
    claimed.contact_profile = { version: 0, sources: [{ id: UUID, text: 'María José 1169004497', sequence: 1 }], pending_requests: [] };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.captureProfile.mockResolvedValue({ version: 1,
      values: { nombre: 'María José', apellido: null, correo: null, telefono: '+5491169004497' },
      accepted_fields: ['nombre'], rejections: [{ field: 'telefono', code: 'INVALID_FORMAT' }],
      contact_profile_snapshot: {
        version: 1,
        values: { nombre: 'María José', apellido: null, correo: null, telefono: '+5491169004497' },
        call_intake_readiness: {
          status: 'needs_input',
          intake: { nombre: 'María José', apellido: null, correo: null, telefono: '+5491169004497' },
          requirements: [
            { field: 'apellido', reason: 'missing' },
            { field: 'correo', reason: 'missing' },
          ],
        },
      } });
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: { schema_version: 1,
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Gracias, María José. ¿Cuál es tu apellido?'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        profile_updates: [
          { field: 'nombre', value: 'María José', operation: 'set', source_message_id: UUID, source_quote: 'María José' },
          { field: 'telefono', value: '1169004497', operation: 'set', source_message_id: UUID, source_quote: '1169004497' },
        ], profile_requests: [{ message_index: 0, fields: ['apellido'], purpose: 'identity', mode: 'collect' }], repair_of: null },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    });
    actionSpies.commit.mockResolvedValueOnce({ status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'waiting_user', outbound: null, call_request: null });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step, execute: vi.fn(), client: {},
      signal: new AbortController().signal, workflow: { id: 'profile-partial-receipt-test' } });

    expect(result).toMatchObject({ status: 'waiting_user', error_code: null });
    expect(actionSpies.captureProfile).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input.agent_turn_v2.proposal.response.messages)
      .toEqual(['Gracias, María José. ¿Cuál es tu apellido?']);
  });

  it('keeps Agent A reply when it accidentally requests an already confirmed profile field', async () => {
    configuration.agentAPlannerlessV2Enabled = true;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.deterministic_route = null;
    claimed.contact_intake = { nombre: 'Agustina', apellido: null, correo: null, telefono: '+5491169004399' };
    claimed.contact_intake_missing = ['apellido', 'correo'];
    claimed.conversation_state_v1 = { selected_offering_code: null, selected_payment_plan: null, stage: 'exploring',
      call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', version: 0 };
    claimed.contact_profile = { version: 3, sources: [], pending_requests: [] };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: { schema_version: 1,
        move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['¿Me recordás tu nombre?'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        profile_updates: [],
        profile_requests: [{ message_index: 0, fields: ['nombre'], purpose: 'identity', mode: 'collect' }],
        repair_of: null },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    });
    actionSpies.commit.mockResolvedValueOnce({ status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'waiting_user', outbound: null, call_request: null });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step, execute: vi.fn(), client: {},
      signal: new AbortController().signal, workflow: { id: 'profile-repeated-request-test' } });

    expect(result).toMatchObject({ status: 'waiting_user', error_code: null });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input.agent_turn_v2.proposal.response.messages)
      .toEqual(['¿Me recordás tu nombre?']);
  });

  it('transcribes a WhatsApp audio before ingesting and never sends its signed URL to the backend', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    actionSpies.transcribe.mockResolvedValueOnce({
      status: 'ok',
      text: 'Quiero información del curso de inglés',
      provider: 'groq/whisper-large-v3-turbo',
      reason: null,
    });
    const input = {
      ...workflowInput(),
      channel: 'whatsapp',
      transport_media_url: 'https://files.bpcontent.cloud/2026/10/02/audio.ogg',
      message: {
        ...workflowInput().message,
        type: 'audio',
        text: '[audio_pendiente_transcripcion]',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
        audio_reference: {
          provider_file_id: 'wamid.audio-1',
          mime_type: 'audio/ogg',
          duration_seconds: null,
          transcription_status: 'skipped',
          transcription_provider: null,
        },
      },
    };
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input,
      state: processingState(),
      step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        provider_source: 'whatsapp_botpress',
        media_download_url: input.transport_media_url,
      }),
    }));
    const ingested = actionSpies.ingest.mock.calls[0]?.[0]?.input;
    expect(ingested.message).toMatchObject({
      type: 'audio',
      text: 'Quiero información del curso de inglés',
      audio_reference: {
        transcription_status: 'ok',
        transcription_provider: 'groq/whisper-large-v3-turbo',
      },
    });
    expect(ingested.transport_media_url).toBeUndefined();
    expect(JSON.stringify(ingested)).not.toContain('files.bpcontent.cloud');
  });

  it('turns an untranscribable audio into recoverable unreadable input instead of crashing', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    actionSpies.transcribe.mockResolvedValueOnce({
      status: 'failed',
      text: '[audio_no_transcrito]',
      provider: 'disabled',
      reason: 'STT_DISABLED',
    });
    const input = {
      ...workflowInput(),
      channel: 'whatsapp',
      transport_media_url: 'https://files.bpcontent.cloud/audio.ogg',
      message: {
        ...workflowInput().message,
        type: 'audio',
        text: '[audio_pendiente_transcripcion]',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
        audio_reference: {
          provider_file_id: 'wamid.audio-2',
          mime_type: 'audio/ogg',
          duration_seconds: null,
          transcription_status: 'skipped',
          transcription_provider: null,
        },
      },
    };
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input,
      state: processingState(),
      step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.transcribe).toHaveBeenCalledTimes(1);
    expect(actionSpies.ingest.mock.calls[0]?.[0]?.input.message).toMatchObject({
      type: 'unsupported',
      text: '[audio_no_transcrito]',
      audio_reference: { transcription_status: 'failed' },
    });
  });

  it('describes a WhatsApp image before ingesting and never sends its signed URL to the backend', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    actionSpies.analyzeImage.mockResolvedValueOnce({
      status: 'ok',
      text: 'La imagen muestra el temario del curso de inglés.',
      provider: 'gemini/gemini-2.5-flash',
      reason: null,
    });
    const input = {
      ...workflowInput(),
      channel: 'whatsapp',
      transport_media_url: 'https://files.bpcontent.cloud/2026/10/07/course.jpg',
      message: {
        ...workflowInput().message,
        type: 'image',
        text: '[imagen_pendiente_descripcion]',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
      },
    };
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input,
      state: processingState(),
      step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.analyzeImage).toHaveBeenCalledWith(expect.objectContaining({
      input: { media_download_url: input.transport_media_url },
    }));
    const ingested = actionSpies.ingest.mock.calls[0]?.[0]?.input;
    expect(ingested.message).toMatchObject({
      type: 'image',
      text: 'La imagen muestra el temario del curso de inglés.',
    });
    expect(ingested.transport_media_url).toBeUndefined();
    expect(JSON.stringify(ingested)).not.toContain('files.bpcontent.cloud');
  });

  it('turns an image that cannot be understood into recoverable unreadable input', async () => {
    configuration.whatsappPublicEnabled = true;
    configuration.whatsappAllowedBotPhoneNumberId = 'allowed-business-number-75';
    actionSpies.analyzeImage.mockResolvedValueOnce({
      status: 'failed',
      text: '[imagen_no_interpretada]',
      provider: 'disabled',
      reason: 'MISSING_GEMINI_API_KEY',
    });
    const input = {
      ...workflowInput(),
      channel: 'whatsapp',
      transport_media_url: 'https://files.bpcontent.cloud/2026/10/07/course.jpg',
      message: {
        ...workflowInput().message,
        type: 'image',
        text: '[imagen_pendiente_descripcion]',
        metadata: { bot_phone_number_id: 'allowed-business-number-75' },
      },
    };
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input,
      state: processingState(),
      step,
      execute: vi.fn(async () => { throw new Error('MODEL_MUST_NOT_RUN'); }),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.ingest.mock.calls[0]?.[0]?.input.message).toMatchObject({
      type: 'unsupported',
      text: '[imagen_no_interpretada]',
    });
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
      proposed_call_offer: true,
      visible_call_offer: true,
      offered_call: true,
      reason: 'FIRST_NOT_YET_USEFUL',
      call_accepted: false,
      call_rejected: false,
      chat_preference: false,
      commit_status: 'committed',
    });
  });

  it.each([
    ['UNSUPPORTED_STATE_ASSERTION', 'state:payment_verified:v1', 'UNSUPPORTED_OPERATIONAL_CLAIM', null],
    ['COURSE_ROLE_UNDECLARED', 'course_mentions:undeclared:ingles_1', 'COURSE_ROLE_UNDECLARED', null],
    ['COMMERCIAL_TRUTH_VIOLATION', 'payment_plan_not_canonical', 'FACT_VALUE_MISMATCH', null],
    ['COMMERCIAL_TRUTH_VIOLATION', 'forbidden_promise', 'FACT_VALUE_MISMATCH', 'direct_bonus:no_price_objection'],
    ['COMMERCIAL_TRUTH_VIOLATION', 'forbidden_promise', 'FACT_VALUE_MISMATCH', 'direct_bonus:bonus_limit_reached'],
    ['COMMERCIAL_TRUTH_VIOLATION', 'forbidden_promise', 'FACT_VALUE_MISMATCH', 'direct_bonus:stale_offer_version'],
    ['COMMERCIAL_TRUTH_VIOLATION', 'forbidden_promise', 'FACT_VALUE_MISMATCH', 'direct_bonus:bonus_without_reply'],
    ['COMMERCIAL_TRUTH_VIOLATION', 'bonus_ladder:missing:call_invitation', 'FACT_VALUE_MISMATCH', 'direct_bonus:ladder_step_pending'],
  ])('returns the exact backend %s to Agent A and commits only its repaired response', async (backendCode, subject, rejectionCode, directReason) => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.contact.name = 'Lucía Pérez';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: ['redes'],
      }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98,
          },
          response: { messages: ['Te cuento los detalles del curso.'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
      })
      .mockImplementationOnce(async (input: {
        context: { turn_rejection: { rejection_id: string } | null };
      }) => ({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98,
          },
          response: { messages: ['Te cuento únicamente la información verificada del curso.'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: {
            rejection_id: input.context.turn_rejection!.rejection_id,
            attempt: 1,
          },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 160, attempt_count: 1,
      }));

    actionSpies.commit
      .mockRejectedValueOnce(new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        {
          error: 'DECISION_REJECTED',
          reason: `AGENT_TURN_V2_REJECTED:${backendCode}`,
          subjects: [subject,...(directReason ? [directReason] : [])],
        },
      ))
      .mockResolvedValueOnce({
        status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user',
        outbound: {
          id: UUID, content: 'Te cuento únicamente la información verificada del curso.', status: 'pending', delivery_attempt: 1,
          authorized_egress: {
            schema_version: 1,
            content_hash: '475afbdaee1fd8588c53b37ae16f80b1c131ab0fb3b38263e5f465179fc1d894',
            authorized_urls: [], protected_facts: [],
          },
        },
        outbounds: [{
          id: UUID, content: 'Te cuento únicamente la información verificada del curso.', status: 'pending', delivery_attempt: 1,
          authorized_egress: {
            schema_version: 1,
            content_hash: '475afbdaee1fd8588c53b37ae16f80b1c131ab0fb3b38263e5f465179fc1d894',
            authorized_urls: [], protected_facts: [],
          },
        }], call_request: null,
      });

    const createMessage = vi.fn(async () => ({ message: { id: 'bp-recovered-message' } }));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.commit).toHaveBeenCalledTimes(2);
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.agentABrainDeepSeek.mock.calls[1]?.[0]?.context.turn_rejection)
      .toMatchObject({
        rejections: [{
          code: rejectionCode,
          subject,
        },...(directReason ? [{code:'FACT_VALUE_MISMATCH',subject:directReason}] : [])],
      });
    if (directReason === 'direct_bonus:ladder_step_pending') {
      expect(actionSpies.agentABrainDeepSeek.mock.calls[1]?.[0]?.context.turn_rejection)
        .toMatchObject({authorized_alternatives:{missing_information:expect.arrayContaining([subject])}});
    }
    expect(actionSpies.commit.mock.calls[1]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          response: { messages: ['Te cuento únicamente la información verificada del curso.'] },
          proposed_action: { type: 'none' },
        },
      },
      turn_diagnostics: {
        generation_attempts: 2,
        failure_stage: 'backend_commit',
        action_status: 'none',
      },
    });
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: { text: 'Te cuento únicamente la información verificada del curso.' },
    }));
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress', error_code: null });
  });

  it('repairs a simple bonus checkout into package acceptance and still sends a reply', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.context.batch_messages[0]!.content = 'Claro, pasame el link y va también Inglés 2';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'ingles_2', selected_payment_plan: 'one_time',
      stage: 'plan_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'payment_confirmation', version: 4,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 2,
      offerings: [
        { code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas', aliases: [] },
        { code: 'ingles_2', display_name: 'Inglés 2', academy: 'Idiomas', aliases: [] },
      ],
      injection_suspected_count: 0,
    };
    const business = paymentBusinessContext();
    business.offerings = [
      { ...business.offerings[0]!, code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas' },
      { ...business.offerings[0]!, code: 'ingles_2', display_name: 'Inglés 2', academy: 'Idiomas' },
    ];
    claimed.business_context = business;
    claimed.business_context_available = true;
    claimed.course_bonus_capability = {
      status: 'offer_available', may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: true, may_send_promoted_payment: false,
      promotion_code: 'ingles_1_mas_ingles_2', interest_offering_code: 'ingles_1',
      bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
    };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
            course_reference: 'ingles_2', confidence: 1 },
          response: { messages: ['Perfecto, te comparto el enlace.'], call_offer: null },
          proposed_action: { type: 'send_payment_link', offering_code: 'ingles_2', payment_plan: 'one_time' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
      })
      .mockImplementationOnce(async (input: { context: AgentAContextV1 }) => ({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 },
          response: { messages: ['Perfecto, queda Inglés 1 con Inglés 2 incluido.'], call_offer: null },
          proposed_action: { type: 'accept_promotion' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: { rejection_id: input.context.turn_rejection!.rejection_id, attempt: 1 },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
      }));

    const outbound = {
      id: UUID, content: 'Perfecto, queda Inglés 1 con Inglés 2 incluido.', status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: '0bd7b88dc667df434a78fb7f54174bd9a17b1c8551e363d56c482f7efe3bc734',
        authorized_urls: [], protected_facts: [] },
    };
    actionSpies.commit
      .mockRejectedValueOnce(new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED',
          subjects: ['promotion_acceptance_required'] },
      ))
      .mockResolvedValueOnce({
        status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user', outbound, outbounds: [outbound], call_request: null,
      });
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-package-accepted-message' } }));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-package-acceptance-repair' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.agentABrainDeepSeek.mock.calls[1]![0]).toMatchObject({
      conversation_only: false,
      context: { turn_rejection: { authorized_alternatives: {
        actions: expect.arrayContaining(['none', 'accept_promotion']),
      } } },
    });
    expect(actionSpies.agentABrainDeepSeek.mock.calls[1]![0]
      .context.turn_rejection.authorized_alternatives.actions).not.toContain('send_payment_link');
    expect(actionSpies.commit).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit.mock.calls[1]![0].input.agent_turn_v2).toMatchObject({
      proposal: { proposed_action: { type: 'accept_promotion' } },
    });
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: { text: 'Perfecto, queda Inglés 1 con Inglés 2 incluido.' },
    }));
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('asks Agent A for one final fenced correction after a twice-rejected backend commit', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.contact.name = 'Lucía Pérez';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: ['redes'],
      }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98,
          },
          response: { messages: ['Te cuento los detalles del curso.'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
      })
      .mockImplementationOnce(async (input: {
        context: { turn_rejection: { rejection_id: string } | null };
      }) => ({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98,
          },
          response: { messages: ['Te cuento únicamente la información verificada del curso.'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: {
            rejection_id: input.context.turn_rejection!.rejection_id,
            attempt: 1,
          },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 160, attempt_count: 1,
      }))
      .mockImplementationOnce(async (input: {
        context: { turn_rejection: { rejection_id: string } | null };
      }) => ({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98,
          },
          response: { messages: ['Dime qué te interesa saber y lo vemos con la información confirmada.'], call_offer: null },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: {
            rejection_id: input.context.turn_rejection!.rejection_id,
            attempt: 1,
          },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 140, attempt_count: 1,
      }));

    actionSpies.commit
      .mockRejectedValueOnce(new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        {
          error: 'DECISION_REJECTED',
          reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
          subjects: ['offering_not_canonical'],
        },
      ))
      .mockRejectedValueOnce(new StudyxHttpError('DECISION_REJECTED', false, 422, 1, {
        error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
        subjects: ['offering_not_canonical'],
      }))
      .mockResolvedValue({
        status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user',
        outbound: {
          id: UUID,
          content: 'Dime qué te interesa saber y lo vemos con la información confirmada.',
          status: 'pending', delivery_attempt: 1,
          authorized_egress: { schema_version: 1,
            content_hash: 'cd2efe47a82adb45e3ae42d0d7ceadc8925f069788e34c4a788560fa35b11398',
            authorized_urls: [], protected_facts: [] },
        },
        call_request: null,
      });

    const createMessage = vi.fn(async () => ({ message: { id: 'bp-recovered-message' } }));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(), {
      sleep: vi.fn(async () => undefined),
    });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const run = () => handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    const result = await run();
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(3);
    expect(actionSpies.commit).toHaveBeenCalledTimes(3);
    expect(actionSpies.commit.mock.calls[2]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          response: { messages: ['Dime qué te interesa saber y lo vemos con la información confirmada.'] },
          proposed_action: { type: 'none' },
        },
      },
      turn_diagnostics: { generation_attempts: 3, failure_stage: 'backend_commit', action_status: 'none' },
    });
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: {
      text: 'Dime qué te interesa saber y lo vemos con la información confirmada.',
    } }));
    expect(result).toMatchObject({ status: 'waiting_user', decision_id: UUID,
      delivery_status: 'submitted_to_botpress', error_code: null });
  });

  async function runRecoveryFeedbackHotPath(
    mismatch?: 'batch_id' | 'turn_id',
    promotionReview = false,
  ) {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.conversation_state_v1 = { selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 2 };
    claimed.contact.name = 'Lucía Pérez';
    claimed.catalog_index = { as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: ['redes'] }], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context.offerings[0]!.modality = 'online';
    claimed.business_context_available = true;
    if (promotionReview) claimed.course_bonus_capability = {
      status: 'review_available',
      may_schedule_checkin: false,
      may_request_review: true,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'redes-informaticas',
      bonus_offerings: [],
    };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    const feedback = { batch_id: UUID, conversation_id: UUID, turn_id: UUID,
      selected_offering_code: 'redes-informaticas', rejection: {
        schema_version: 1 as const, rejection_id: UUID, attempt: 1 as const,
        rejections: [{ code: 'FACT_VALUE_MISMATCH' as const, subject: 'course_logistics.self_paced' }],
        authorized_alternatives: { fact_ids: ['stale:price'], actions: ['send_payment_link'], missing_information: ['nombre'] },
      } };
    if (mismatch) feedback[mismatch] = '00000000-0000-4000-8000-000000000099';
    const safeText = 'Te cuento únicamente la información verificada del curso.';
    actionSpies.agentABrainDeepSeek.mockReset().mockResolvedValue({
      proposal: { schema_version: 1,
        move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 0.98 },
        response: { messages: [safeText], call_offer: null },
        proposed_action: promotionReview
          ? { type: 'request_promotion_review', reason: 'persistent_price_objection' }
          : { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        repair_of: mismatch ? null : { rejection_id: UUID, attempt: 1 } },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    });
    const outbound = { id: UUID, content: safeText, status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: '475afbdaee1fd8588c53b37ae16f80b1c131ab0fb3b38263e5f465179fc1d894',
        authorized_urls: [], protected_facts: [] } };
    actionSpies.commit.mockReset().mockResolvedValue({ status: 'committed', replayed: false,
      trace_id: UUID, turn_id: UUID, decision_id: UUID, next_state: 'waiting_user',
      outbound, outbounds: [outbound], call_request: null,
      commercial_followups: promotionReview
        ? [{ id: UUID, kind: 'promotion_review', due_at: NOW }]
        : [],
    });
    actionSpies.delivery.mockClear();
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-recovery-feedback-message' } }));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    const result = await handler({ input: { ...workflowInput(), recovery_feedback: feedback },
      state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }), client: { createMessage },
      signal: new AbortController().signal, workflow: { id: 'workflow-recovery-feedback' } });
    return { result, feedback, createMessage };
  }

  it('consumes matching recovery feedback in the first generation with fresh facts and delivers its safe proposal', async () => {
    const { result, feedback, createMessage } = await runRecoveryFeedbackHotPath();
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    const generated = actionSpies.agentABrainDeepSeek.mock.calls[0]![0];
    expect(generated).toMatchObject({ conversation_only: true, context: {
      turn_rejection: { rejection_id: UUID, rejections: [
        { code: 'FACT_VALUE_MISMATCH', subject: 'course_logistics.self_paced' },
      ], authorized_alternatives: { actions: ['none'] } },
    } });
    const factIds = generated.context.turn_rejection.authorized_alternatives.fact_ids;
    expect(factIds).toContain('offering:redes-informaticas:modality:v1');
    expect(factIds).not.toContain('stale:price');
    expect(generated.context.catalog.selected_offering.facts).toContainEqual({
      id: 'offering:redes-informaticas:modality:v1', kind: 'offering_modality', value: 'online',
    });
    expect(feedback.rejection.authorized_alternatives).toEqual({
      fact_ids: ['stale:price'], actions: ['send_payment_link'], missing_information: ['nombre'],
    });
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2).toMatchObject({
      conversation_only: true, proposal: { proposed_action: { type: 'none' } },
    });
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress', error_code: null });
  });

  it('re-authorizes a promotion review from the fresh recovery claim and persists the effect with the outbound', async () => {
    const { result, createMessage } = await runRecoveryFeedbackHotPath(undefined, true);

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrainDeepSeek.mock.calls[0]![0]).toMatchObject({
      conversation_only: false,
      context: { turn_rejection: { authorized_alternatives: {
        actions: ['none', 'request_promotion_review'],
      } } },
    });
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2).toMatchObject({
      proposal: { proposed_action: {
        type: 'request_promotion_review', reason: 'persistent_price_objection',
      } },
    });
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2)
      .not.toHaveProperty('conversation_only');
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('ignores recovery feedback from a different origin batch or turn before the first generation', async () => {
    for (const mismatch of ['batch_id', 'turn_id'] as const) {
      const { result, createMessage } = await runRecoveryFeedbackHotPath(mismatch);
      expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
      const generated = actionSpies.agentABrainDeepSeek.mock.calls[0]![0];
      expect(generated).not.toHaveProperty('conversation_only');
      expect(generated.context).not.toHaveProperty('turn_rejection');
      expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2).not.toHaveProperty('conversation_only');
      expect(createMessage).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress', error_code: null });
    }
  });

  it.each([
    ['commits the safe model-authored conversational floor when Agent A continuation times out',
      ['Dale, mientras coordinamos te sigo ayudando por acá.'],
      ['Dale, mientras coordinamos te sigo ayudando por acá.']],
    ['uses technical continuity instead of mistaking a bare acknowledgement for resolution',
      ['Dale. Te llamo ahora.'], null],
    // Authority P:17/236: a failed repair cannot authorize a backend sentence cut.
    ['rejects the complete draft instead of cutting off a call-dispatch claim',
      ['Entiendo, el total sigue en USD 360.\nTe llamo ahora.'],
      null],
    ['rejects the complete draft instead of selecting its later bubble',
      ['Te llamo ahora.', 'El total sigue en USD 360.'],
      null],
    ['rejects the complete draft instead of selecting its later sentence',
      ['Te llamo ahora. El total sigue en USD 360.'],
      null],
    ['persists revoked consent when repair is unavailable', ['Recibí tu solicitud de llamada.'], ['Seguimos por acá.']],
    ['retains every bubble of the closest complete safe draft',
      ['El total sigue en USD 360.', 'Podemos seguir por acá.'],
      ['El total sigue en USD 360.', 'Podemos seguir por acá.']],
  ])('%s', async (_case, modelMessages, expectedCommittedMessages) => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.deterministic_route = 'call_accepted_offer';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'call', call_offer_status: 'accepted',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 1,
    };
    claimed.context.batch_messages[0].content = 'Sí, llamame';
    claimed.sales_context.allowed_actions = ['request_call_now'];
    claimed.sales_context.accepted_call_offer = { decision_id: UUID, expires_at: NOW };
    claimed.contact.name = 'Lucía Pérez';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: ['redes'] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], course_reference: 'redes-informaticas', confidence: 0.98 },
          response: { messages: modelMessages, call_offer: null },
          proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
      })
      .mockRejectedValueOnce(new Error('BRAIN_DEEPSEEK_TIMEOUT'));
    actionSpies.commit
      .mockRejectedValueOnce(new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED',
          subjects: _case === 'persists revoked consent when repair is unavailable' ? ['call_consent_revoked'] : [] },
      ))
      .mockResolvedValueOnce({
        status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user',
        outbound: {
          id: UUID, content: 'No quiero suponer algo incorrecto. Dime qué necesitas o a qué curso te refieres y lo resolvemos por aquí.', status: 'pending', delivery_attempt: 1,
          authorized_egress: {
            schema_version: 1,
            content_hash: '7884954416c27f7ad91be3687df387d17579056f0dd294eb2d2b7cf6c88688d2',
            authorized_urls: [], protected_facts: [],
          },
        },
        outbounds: [{
          id: UUID, content: 'No quiero suponer algo incorrecto. Dime qué necesitas o a qué curso te refieres y lo resolvemos por aquí.', status: 'pending', delivery_attempt: 1,
          authorized_egress: {
            schema_version: 1,
            content_hash: '7884954416c27f7ad91be3687df387d17579056f0dd294eb2d2b7cf6c88688d2',
            authorized_urls: [], protected_facts: [],
          },
        }], call_request: null,
      });

    if (_case === 'persists revoked consent when repair is unavailable') {
      actionSpies.commit.mockReset().mockImplementation(async ({ input }) => {
        if (!input.agent_turn_v2?.operational_continuity) throw new StudyxHttpError(
          'DECISION_REJECTED', false, 422, 1, { error: 'DECISION_REJECTED',
            reason: 'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED', subjects: ['call_consent_revoked'] });
        const content = input.agent_turn_v2.proposal.response.messages.join('\n\n');
        const outbound = { id: UUID, content, status: 'pending', delivery_attempt: 1,
          authorized_egress: buildAuthorizedEgress({ content, authorized_urls: [], protected_facts: [] }) };
        return { status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
          decision_id: UUID, next_state: 'waiting_user', outbound, outbounds: [outbound], call_request: null };
      });
    }

    const createMessage = vi.fn(async () => ({ message: { id: 'bp-safe-floor-message' } }));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    // Authority prompt line 32: "Cada respuesta tuya debe terminar con un avance".
    // A rejected effect cannot erase Agent A's independently safe conversation;
    // only exact model-authored text that crosses both validation boundaries may survive.
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    if (_case === 'persists revoked consent when repair is unavailable') expect(actionSpies.commit.mock.calls.at(-1)![0].input.agent_turn_v2)
      .toMatchObject({ operational_continuity: 'call_consent_revoked', proposal: { move: { move: 'decline_call' } } });
    if (expectedCommittedMessages === null) {
      expect(actionSpies.commit).toHaveBeenCalledTimes(_case === 'persists revoked consent when repair is unavailable' ? 3 : 2);
      expect(actionSpies.commit.mock.calls.at(-1)![0].input).toMatchObject({
        agent_turn_v2: null,
        decision: {
          kind: 'reply', response_type: 'commercial_reply', reason_code: 'MODEL_UNAVAILABLE',
        },
      });
      expect(actionSpies.recovery).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
        error_code: null });
      expect(createMessage).toHaveBeenCalledTimes(1);
    } else {
      expect(actionSpies.commit).toHaveBeenCalledTimes(_case === 'persists revoked consent when repair is unavailable' ? 3 : 2);
      expect(actionSpies.commit.mock.calls.at(-1)![0].input.agent_turn_v2).toMatchObject({
        conversation_only: true,
        proposal: {
          response: { messages: expectedCommittedMessages, call_offer: null },
          proposed_action: { type: 'none' },
        },
      });
      expect(actionSpies.recovery).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
        error_code: null });
      expect(createMessage).toHaveBeenCalledTimes(1);
    }
  });

  it('never cuts the bonus bubble out of a rejected complete draft', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'marketing_digital', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 2, awaiting_reply: 'none', version: 47,
    };
    claimed.context.batch_messages[0].content = 'Me sigue pareciendo caro';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 2,
      offerings: [
        { code: 'marketing_digital', display_name: 'Marketing Digital', academy: 'Marketing', aliases: [] },
        { code: 'community_manager', display_name: 'Community Manager', academy: 'Marketing', aliases: [] },
      ],
      injection_suspected_count: 0,
    };
    const baseBusiness = paymentBusinessContext();
    claimed.business_context = {
      ...baseBusiness,
      offerings: [
        { ...baseBusiness.offerings[0], code: 'marketing_digital', display_name: 'Marketing Digital' },
        { ...baseBusiness.offerings[0], code: 'community_manager', display_name: 'Community Manager' },
      ],
    };
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const safeText = 'Revisemos primero qué te frena del precio.';
    const rejectedBonusText = 'Te llevás también Community Manager.';
    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
            course_reference: 'marketing_digital', confidence: 1 },
          response: { messages: [safeText, rejectedBonusText], call_offer: null },
          proposed_action: { type: 'offer_course_bonus',
            interest_offering_code: 'marketing_digital', bonus_offering_code: 'community_manager' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
      })
      .mockRejectedValueOnce(new Error('BRAIN_DEEPSEEK_TIMEOUT'));
    actionSpies.commit
      .mockRejectedValueOnce(new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
          subjects: ['forbidden_promise'] },
      ))
      .mockResolvedValueOnce({
        status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
        decision_id: UUID, next_state: 'waiting_user',
        outbound: { id: UUID, content: safeText, status: 'pending', delivery_attempt: 1,
          authorized_egress: { schema_version: 1,
            content_hash: 'c748dab62a273cdd2f2e3d8148bf3182ab4368fa31eb810c1688026bce0af039',
            authorized_urls: [], protected_facts: [] } },
        outbounds: [{ id: UUID, content: safeText, status: 'pending', delivery_attempt: 1,
          authorized_egress: { schema_version: 1,
            content_hash: 'c748dab62a273cdd2f2e3d8148bf3182ab4368fa31eb810c1688026bce0af039',
            authorized_urls: [], protected_facts: [] } }],
        call_request: null,
      });

    const createMessage = vi.fn(async () => ({ message: { id: 'bp-bonus-floor-message' } }));
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'rejected-bonus-floor-test' },
    });

    expect(actionSpies.commit).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit.mock.calls[1]![0].input.agent_turn_v2).toBeNull();
    expect(actionSpies.commit.mock.calls[1]![0].input.decision.response)
      .toBe('Qué dato o qué curso revisamos?');
    expect(JSON.stringify(actionSpies.commit.mock.calls[1]![0].input)).not.toContain(rejectedBonusText);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps the full response boundary when precommit repair never removes a bonus promise', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 2,
      offerings: [
        { code: 'redes-informaticas', display_name: 'Redes Informáticas',
          academy: 'Tecnología', aliases: ['redes'] },
        { code: 'community_manager', display_name: 'Community Manager',
          academy: 'Marketing', aliases: [] },
      ], injection_suspected_count: 0 };
    const baseBusiness = paymentBusinessContext();
    claimed.business_context = { ...baseBusiness, offerings: [
      ...baseBusiness.offerings,
      { ...baseBusiness.offerings[0], code: 'community_manager', display_name: 'Community Manager' },
    ] };
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const safeText = 'Revisemos primero qué te frena del precio.';
    const rejectedBonusText = 'Te llevás también Community Manager.';
    actionSpies.agentABrainValidate.mockImplementation(({ proposal }: {
      proposal: { proposed_action: { type: string } };
    }) => proposal.proposed_action.type === 'offer_course_bonus' ? {
      schema_version: 1, rejection_id: UUID, attempt: 1,
      rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'forbidden_promise' }],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] },
    } : null);
    let generation = 0;
    actionSpies.agentABrainDeepSeek.mockImplementation(async (input: {
      context: AgentAContextV1; on_provider_request?: () => void;
    }) => {
      generation += 1;
      input.on_provider_request?.();
      return {
        proposal: { schema_version: 1,
          move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 1 },
          response: { messages: generation === 1
            ? [safeText, rejectedBonusText] : [rejectedBonusText], call_offer: null },
          proposed_action: {
            type: 'offer_course_bonus', interest_offering_code: 'redes-informaticas',
            bonus_offering_code: 'community_manager',
          },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: input.context.turn_rejection
            ? { rejection_id: input.context.turn_rejection.rejection_id, attempt: 1 } : null },
        provider: 'deepseek-direct' as const, model: 'deepseek-v4-flash', latency_ms: 1,
        attempt_count: 1 as const,
      };
    });
    const outbound = { id: UUID, content: safeText, status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: 'c748dab62a273cdd2f2e3d8148bf3182ab4368fa31eb810c1688026bce0af039',
        authorized_urls: [], protected_facts: [] } };
    actionSpies.commit.mockResolvedValueOnce({ status: 'committed', replayed: false,
      trace_id: UUID, turn_id: UUID, decision_id: UUID, next_state: 'waiting_user',
      outbound, outbounds: [outbound], call_request: null });
    const client = { createMessage: vi.fn(async () => ({ message: { id: 'bp-precommit-floor' } })) };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client, signal: new AbortController().signal,
      workflow: { id: 'precommit-floor-test' } });

    // Authority prompt line 236: el rechazo de una acción no puede cortar la venta.
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(3);
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2).toBeNull();
    expect(actionSpies.commit.mock.calls[0]![0].input.decision.response)
      .toBe('Qué dato o qué curso revisamos?');
    expect(JSON.stringify(actionSpies.commit.mock.calls[0]![0].input)).not.toContain(rejectedBonusText);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('uses technical continuity when every precommit bonus fragment remains unauthorized', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: [] }], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    actionSpies.agentABrainValidate.mockReturnValue({ schema_version: 1,
      rejection_id: UUID, attempt: 1,
      rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'forbidden_promise' }],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] } });
    let generation = 0;
    actionSpies.agentABrainDeepSeek.mockImplementation(async (input: {
      context: AgentAContextV1; on_provider_request?: () => void;
    }) => {
      generation += 1;
      input.on_provider_request?.();
      return { proposal: { schema_version: 1,
        move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Te sumo otro curso sin costo extra.'], call_offer: null },
        proposed_action: generation === 1 ? {
          type: 'offer_course_bonus', interest_offering_code: 'redes-informaticas',
          bonus_offering_code: 'fotografia_celulares_tiendas_online',
        } : { type: 'none' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        repair_of: input.context.turn_rejection
          ? { rejection_id: input.context.turn_rejection.rejection_id, attempt: 1 } : null },
      provider: 'deepseek-direct' as const, model: 'deepseek-v4-flash', latency_ms: 1,
      attempt_count: 1 as const };
    });
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });

    const result = await (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(), client, signal: new AbortController().signal,
      workflow: { id: 'precommit-continuity-test' } });

    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]![0].input).toMatchObject({
      agent_turn_v2: null,
      decision: { kind: 'reply', reason_code: 'MODEL_UNAVAILABLE', business_action: null },
    });
    expect(JSON.stringify(actionSpies.commit.mock.calls[0]![0].input)).not.toContain('sin costo extra');
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('never labels a twice-rejected factual answer as MODEL_UNAVAILABLE', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: ['redes'] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const rejection = {
      schema_version: 1, rejection_id: UUID, attempt: 1,
      rejections: [
        { code: 'FACT_VALUE_MISMATCH', subject: 'course_logistics' },
        { code: 'FACT_VALUE_MISMATCH', subject: 'course_logistics.self_paced' },
        { code: 'FACT_VALUE_MISMATCH', subject: 'course_logistics.remote_location' },
      ],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] },
    } as const;
    actionSpies.agentABrainValidate.mockImplementation(({ proposal }: {
      proposal: { response: { messages: string[] } };
    }) => proposal.response.messages[0]?.startsWith('Claro.') ? null : rejection);
    actionSpies.agentABrainDeepSeek.mockReset()
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.98 },
          response: { messages: ['Es online, así que avanzas a tu ritmo desde cualquier lugar.'], call_offer: null },
          proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 100, attempt_count: 1,
      })
      .mockImplementationOnce(async (input: { context: { turn_rejection: { rejection_id: string } } }) => ({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 0.9 },
          response: { messages: ['Puedes estudiar a tu ritmo desde donde estés.'], call_offer: null },
          proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: { rejection_id: input.context.turn_rejection.rejection_id, attempt: 1 },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 90, attempt_count: 1,
      }))
      .mockImplementationOnce(async (input: { context: { turn_rejection: { rejection_id: string } } }) => ({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'redes-informaticas', confidence: 0.95 },
          response: { messages: ['Claro. Dime qué aspecto del curso quieres revisar.'], call_offer: null },
          proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: { rejection_id: input.context.turn_rejection.rejection_id, attempt: 1 },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 80, attempt_count: 1,
      }));

    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }), client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' } });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(3);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          response: { messages: ['Claro. Dime qué aspecto del curso quieres revisar.'] },
          proposed_action: { type: 'none' },
        },
      },
      turn_diagnostics: {
        generation_attempts: 3,
        failure_stage: 'proposal_validation',
        action_status: 'none',
      },
    });
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision?.reason_code)
      .toBe('CONVERSATION_PIPELINE_V1_PENDING_BACKEND');
  });

  it('lets Agent A recover an unreadable input instead of forcing a technical fallback', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.policy = {
      may_respond: true,
      allowed_response_types: ['commercial_reply', 'clarification', 'technical_fallback'],
      reason: 'UNSUPPORTED_MESSAGE_TYPE',
    };
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
    claimed.context.batch_messages = [{
      id: UUID,
      conversation_seq: 1,
      content: '[whatsapp_media_no_soportado]',
      created_at: NOW,
      message_type: 'unsupported',
    }];
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: {
          schema_version: 1,
          move: 'unknown',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.98,
        },
        response: {
          messages: [
            'No pude interpretar ese audio.',
            'Escribime lo principal y seguimos desde donde estábamos.',
          ],
        },
        proposed_action: { type: 'none' },
        used_fact_ids: [],
        used_memory_ids: [],
        memory_candidates: [],
        repair_of: null,
      },
      provider: 'deepseek-direct',
      model: 'deepseek-v4-flash',
      latency_ms: 180,
      attempt_count: 1,
    });
    actionSpies.commit.mockResolvedValueOnce({
      status: 'committed',
      replayed: false,
      trace_id: UUID,
      turn_id: UUID,
      decision_id: UUID,
      next_state: 'completed',
      outbound: null,
      call_request: null,
    });
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    await handler({
      input: {
        ...workflowInput(),
        message: {
          ...workflowInput().message,
          type: 'unsupported',
          text: '[whatsapp_media_no_soportado]',
        },
      },
      state: processingState(),
      step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {},
      signal: new AbortController().signal,
      workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          move: { move: 'unknown' },
          response: {
            messages: [
              'No pude interpretar ese audio.',
              'Escribime lo principal y seguimos desde donde estábamos.',
            ],
          },
          proposed_action: { type: 'none' },
        },
      },
      model: {
        provider: 'deepseek-direct',
        prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
      },
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

  it('does not author a course reply in the backend when the authoritative brain is unavailable', async () => {
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
      Object.assign(new Error('provider failure'), { code: 'BRAIN_DEEPSEEK_HTTP_429' }),
    );
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();

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

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute, client,
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    // Authority prompt line 236: una falla del proveedor no puede cortar la conversación.
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
    const brainLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_v1');
    expect(brainLog).toMatchObject({
      rollout_mode: 'authoritative',
      brain_source: 'fallback',
      brain_failure_reason: 'rate_limited',
      failure_code: 'BRAIN_DEEPSEEK_HTTP_429',
      authorized_action_type: 'none',
    });
  });

  it('reports invalid model structure explicitly without misclassifying it as a provider outage', async () => {
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
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();

    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('keeps a currently authorized promotion review through invalid-schema continuation and delivers it', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.context.batch_messages[0].content = 'No hay ninguna oferta que me puedas hacer?';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'ingles_1', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 3,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas', aliases: ['ingles'] }],
      injection_suspected_count: 0,
    };
    const business = paymentBusinessContext();
    business.offerings[0] = {
      ...business.offerings[0],
      code: 'ingles_1',
      display_name: 'Inglés 1',
      academy: 'Idiomas',
    };
    claimed.business_context = business;
    claimed.business_context_available = true;
    claimed.course_bonus_capability = {
      status: 'review_available',
      may_schedule_checkin: false,
      may_request_review: true,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'ingles_1',
      bonus_offerings: [],
    };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const invalid = Object.assign(new Error('invalid proposal'), { code: 'BRAIN_INVALID_SCHEMA' });
    const replyText = 'Dame un momento y reviso qué alternativa puedo habilitarte.';
    actionSpies.agentABrainDeepSeek
      .mockRejectedValueOnce(invalid)
      .mockImplementationOnce(async ({ context }: { context: AgentAContextV1 }) => ({
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'ingles_1', confidence: 1 },
          response: { messages: [replyText], call_offer: null },
          proposed_action: { type: 'request_promotion_review', reason: 'persistent_price_objection' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: { rejection_id: context.turn_rejection!.rejection_id, attempt: 1 },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
      }));
    const outbound = {
      id: UUID, content: replyText, status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: 'd8ef9ae0302bc639366919e442dfef275997b40106151c50a96408ef3d92e1a0',
        authorized_urls: [], protected_facts: [] },
    };
    actionSpies.commit.mockResolvedValue({
      status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'waiting_user', outbound, call_request: null,
      commercial_followups: [{ id: UUID, kind: 'promotion_review', due_at: NOW }],
    });
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-promotion-review-message' } }));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-promotion-review-after-schema-rejection' },
    });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    const continuationInput = actionSpies.agentABrainDeepSeek.mock.calls[1]![0];
    expect(continuationInput).toMatchObject({
      conversation_only: false,
      context: { turn_rejection: { authorized_alternatives: {
        actions: ['none', 'request_promotion_review'],
      } } },
    });
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2).toMatchObject({
      proposal: { proposed_action: {
        type: 'request_promotion_review', reason: 'persistent_price_objection',
      } },
    });
    expect(actionSpies.commit.mock.calls[0]![0].input.agent_turn_v2)
      .not.toHaveProperty('conversation_only');
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: { text: replyText } }));
    expect(actionSpies.recovery).not.toHaveBeenCalled();
  });

  it.each([
    { finalBackendRejected: false, initialProviderRequests: 1, precommitProviderRequests: 1 },
    { finalBackendRejected: true, initialProviderRequests: 1, precommitProviderRequests: 1 },
    { finalBackendRejected: false, initialProviderRequests: 2, precommitProviderRequests: 1 },
    { finalBackendRejected: false, initialProviderRequests: 1, precommitProviderRequests: 2 },
  ])('uses the remaining third generation after a local repair (final rejection: $finalBackendRejected, initial provider requests: $initialProviderRequests, precommit provider requests: $precommitProviderRequests)', async ({ finalBackendRejected, initialProviderRequests, precommitProviderRequests }) => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.context.batch_messages[0].content = 'No hay ninguna oferta que me puedas hacer?';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'ingles_1', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 3,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas', aliases: ['ingles'] }],
      injection_suspected_count: 0,
    };
    const business = paymentBusinessContext();
    business.offerings[0] = {
      ...business.offerings[0], code: 'ingles_1', display_name: 'Inglés 1', academy: 'Idiomas',
    };
    claimed.business_context = business;
    claimed.business_context_available = true;
    claimed.course_bonus_capability = {
      status: 'review_available', may_schedule_checkin: false, may_request_review: true,
      may_accept_offer: false, may_send_promoted_payment: false, promotion_code: null,
      interest_offering_code: 'ingles_1', bonus_offerings: [],
    };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const unsafeText = 'Te consigo una promoción especial y te confirmo otro curso gratis.';
    const safeText = 'Dame un momento y reviso qué alternativa puedo habilitarte.';
    actionSpies.agentABrainValidate.mockImplementation(({ proposal }: {
      proposal: { response: { messages: string[] } };
    }) => proposal.response.messages.includes(safeText) ? null : {
      schema_version: 1, rejection_id: UUID, attempt: 1,
      rejections: [
        // Authority: exact whole-response duplication remains; sales quality
        // and price reframing are owned by Agent A.
        { code: 'REPEATED_AGENT_REPLY', subject: 'previous_agent_reply' },
      ],
      authorized_alternatives: {
        fact_ids: [], actions: ['none', 'request_promotion_review'], missing_information: [],
      },
    });
    let generation = 0;
    actionSpies.agentABrainDeepSeek.mockImplementation(async (input: {
      context: AgentAContextV1;
      on_provider_request?: () => void;
    }) => {
      generation += 1;
      const providerRequests = generation === 1
        ? initialProviderRequests
        : generation === 2
          ? precommitProviderRequests
          : 1;
      for (let attempt = 0; attempt < providerRequests; attempt += 1) {
        input.on_provider_request?.();
      }
      const corrected = generation === 3;
      return {
        proposal: {
          schema_version: 1,
          move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
            course_reference: 'ingles_1', confidence: 1 },
          response: { messages: [corrected ? safeText : unsafeText], call_offer: null },
          proposed_action: { type: 'request_promotion_review', reason: 'persistent_price_objection' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: input.context.turn_rejection
            ? { rejection_id: input.context.turn_rejection.rejection_id, attempt: 1 }
            : null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
      };
    });

    const outbound = {
      id: UUID, content: safeText, status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: 'd8ef9ae0302bc639366919e442dfef275997b40106151c50a96408ef3d92e1a0',
        authorized_urls: [], protected_facts: [] },
    };
    let persistedFollowups = 0;
    const firstBackendRejection = new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
          subjects: ['forbidden_promise'] },
      );
    actionSpies.commit.mockRejectedValueOnce(firstBackendRejection);
    if (finalBackendRejected) {
      const finalRejection = new StudyxHttpError(
        'DECISION_REJECTED', false, 422, 1,
        { error: 'DECISION_REJECTED', reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
          subjects: ['offering_not_canonical'] },
      );
      actionSpies.commit
        .mockRejectedValueOnce(finalRejection)
        // The conversational floor must cross the authoritative backend too.
        // A factually rejected reply is never delivered just to avoid silence.
        .mockRejectedValueOnce(finalRejection)
        .mockRejectedValueOnce(finalRejection)
        .mockResolvedValueOnce({
          status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
          decision_id: UUID, next_state: 'waiting_user', outbound, outbounds: [outbound],
          call_request: null,
        });
    } else {
      actionSpies.commit.mockImplementationOnce(async () => {
        persistedFollowups += 1;
        return {
          status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
          decision_id: UUID, next_state: 'waiting_user', outbound, outbounds: [outbound],
          call_request: null, commercial_followups: [{ id: UUID, kind: 'promotion_review', due_at: NOW }],
        };
      });
    }
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-third-generation-message' } }));
    const recoveryWorkflow = vi.spyOn(processInboundTurn, 'getOrCreate')
      .mockResolvedValue({ id: 'third-generation-recovery-workflow' });
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: { createMessage }, signal: new AbortController().signal,
      workflow: { id: 'workflow-third-generation-after-backend-rejection' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(3);
    expect(actionSpies.agentABrainDeepSeek.mock.calls[2]![0]).toMatchObject({
      conversation_only: false,
      context: { turn_rejection: {
        rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'forbidden_promise' }],
        authorized_alternatives: { actions: expect.arrayContaining(['request_promotion_review']) },
      } },
    });
    expect(actionSpies.commit).toHaveBeenCalledTimes(finalBackendRejected ? 5 : 2);
    expect(actionSpies.commit.mock.calls[1]![0].input.agent_turn_v2).toMatchObject({
      proposal: {
        response: { messages: [safeText] },
        proposed_action: { type: 'request_promotion_review', reason: 'persistent_price_objection' },
      },
    });
    if (finalBackendRejected) {
      expect(persistedFollowups).toBe(0);
      // Authority prompt line 236: an unavailable action cannot cut the sale.
      // Once every model-authored variant is rejected, the pre-existing
      // technical continuity path still emits a fact-free reply.
      expect(actionSpies.commit.mock.calls[4]![0].input).toMatchObject({
        agent_turn_v2: null,
        decision: {
          kind: 'reply', response_type: 'commercial_reply', reason_code: 'MODEL_UNAVAILABLE',
        },
      });
      expect(createMessage).toHaveBeenCalledTimes(1);
      expect(actionSpies.recovery).not.toHaveBeenCalled();
      expect(recoveryWorkflow).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'waiting_user',
        delivery_status: 'submitted_to_botpress', error_code: null });
    } else {
      expect(persistedFollowups).toBe(1);
      expect(createMessage).toHaveBeenCalledTimes(1);
      expect(actionSpies.recovery).not.toHaveBeenCalled();
      expect(recoveryWorkflow).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
        error_code: null });
    }
  });

  it('retries one transient DeepSeek timeout before committing the model reply', async () => {
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
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { code: 'BRAIN_DEEPSEEK_TIMEOUT' }),
    );

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
      execute: vi.fn(async () => { throw new Error('MANAGED_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(stepNames).toContain('retry-agent-a-turn-proposal-v1-deepseek');
    expect(stepNames).not.toContain('failover-agent-a-turn-proposal-v1-gemini');
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      turn_diagnostics: {
        generation_attempts: 2,
        failure_stage: 'provider_generation',
        failure_codes: ['BRAIN_DEEPSEEK_TIMEOUT'],
      },
      agent_turn_v2: {
        proposal: {
          response: {
            messages: ['Perfecto, seguimos por chat.', '¿Qué aspecto querés revisar?'],
          },
        },
      },
    });
    const retryLog = vi.mocked(console.info).mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'studyx.turn.agent_a_brain_retry');
    expect(retryLog).toMatchObject({
      failure_code: 'BRAIN_DEEPSEEK_TIMEOUT',
      attempt: 2,
    });
  });

  it('keeps DeepSeek as the only conversational provider when it fails', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null, stage: 'exploring',
      call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0,
      awaiting_reply: 'none', version: 1,
    };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    secrets.GEMINI_API_KEY = 'must-not-be-used';
    actionSpies.agentABrainDeepSeek.mockRejectedValue(
      Object.assign(new Error('timeout'), { code: 'BRAIN_DEEPSEEK_TIMEOUT' }),
    );
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
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
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('BRAIN_DEEPSEEK_HTTP_400'));
    actionSpies.agentABrainOpenAI
      .mockRejectedValueOnce(new Error('OPENAI_PRIMARY_REJECTED'))
      .mockRejectedValueOnce(new Error('OPENAI_FALLBACK_REJECTED'));
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
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

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute, client,
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('does not publish a backend-edited subset when the legacy planner rejects Agent A', async () => {
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

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute,
      client: { getOrCreateWorkflow: vi.fn(async () => ({ workflow: { id: 'planner-recovery', status: 'pending', tags: {} } })) },
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit).not.toHaveBeenCalled();
    expect(actionSpies.recovery).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'retry_pending', delivery_status: null,
      error_code: 'AGENT_A_CONTINUATION_REJECTED' });
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
      Object.assign(new Error('provider failure'), { code: 'BRAIN_DEEPSEEK_HTTP_429' }),
    );
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();

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

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute, client,
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('keeps DeepSeek as the only Agent A provider when DeepSeek rejects billing', async () => {
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
    claimed.context.batch_messages[0].content = 'Quiero que me llames para asesorarme sobre otro curso';
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'entrenamiento-funcional', display_name: 'Entrenamiento Funcional', academy: 'Salud y Bienestar', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    secrets.GROQ_API_KEY = 'groq-must-not-be-used';
    actionSpies.agentABrainDeepSeek.mockRejectedValue(
      Object.assign(new Error('billing required'), { code: 'BRAIN_DEEPSEEK_HTTP_402' }),
    );
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('MANAGED_MODEL_MUST_NOT_RUN'); }),
      client, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'waiting_user',
      delivery_status: 'submitted_to_botpress',
      error_code: null,
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

  it('never substitutes backend-authored catalog copy when DeepSeek is unavailable', async () => {
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
    secrets.GEMINI_API_KEY = 'gemini-must-not-run';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(
      Object.assign(new Error('provider failure'), { code: 'BRAIN_DEEPSEEK_HTTP_429' }),
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
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
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

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute, client,
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.agentABrainOpenAI).not.toHaveBeenCalled();
    expect(actionSpies.agentABrain).not.toHaveBeenCalled();
    expect(actionSpies.agentABrainGemini).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
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
    actionSpies.agentABrainDeepSeek.mockRejectedValue(new Error('BRAIN_DEEPSEEK_HTTP_503'));
    actionSpies.agentABrain.mockRejectedValueOnce(new Error('GROQ_UNAVAILABLE'));
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const execute = vi.fn(async () => { throw new Error('MANAGED_UNAVAILABLE'); });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step, execute, client,
      signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
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
      Object.assign(new Error('provider failure'), { code: 'BRAIN_DEEPSEEK_HTTP_429' }),
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
      step?: ((name: string, run: () => Promise<unknown>) => Promise<unknown>) & { sleep: (name: string, ms: number) => Promise<void> };
      state?: ReturnType<typeof processingState>;
      workflow?: { id: string; setTimeout: ReturnType<typeof vi.fn> };
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
    const step = options.step ?? Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async (name: string) => {
        if (name.startsWith('review-ambiguous-submission-')) throw DELIVERY_SUSPENSION;
      }) },
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
      state: options.state ?? processingState(),
      step,
      execute,
      client: { createMessage },
      signal: new AbortController().signal,
      workflow: options.workflow ?? { id: 'workflow-test', setTimeout: vi.fn(async () => undefined) },
    });

    return { createMessage, result };
  }

  it.each([false, true])('honors the backend Rule A pause on a new run and after part 0 was submitted (replay=%s)', async replay => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
    const first = { id: UUID, content: 'Primero', status: replay ? 'submitted_to_botpress' : 'pending', delivery_attempt: 1,
      authorized_egress: buildAuthorizedEgress({ content: 'Primero', authorized_urls: [], protected_facts: [] }),
      part_index: 0, part_count: 2 };
    const second = { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1,
      authorized_egress: buildAuthorizedEgress({ content: 'Segundo', authorized_urls: [], protected_facts: [] }),
      part_index: 1, part_count: 2, minimum_delay_before_ms: 20000,
      ...(replay ? { not_before: new Date(Date.parse(NOW) + 7000).toISOString() } : {}) };
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const { createMessage, result } = await runCommittedOutbound(first, {}, { outbounds: [first, second], step });
    expect(step.sleep).toHaveBeenCalledWith(`rule-a-bonus-pause-${second.id}`, replay ? 7000 : 20000);
    expect(createMessage.mock.calls.map(([input]) => input.payload.text)).toEqual(replay ? ['Segundo'] : ['Primero', 'Segundo']);
    expect(result).toMatchObject({ status: 'completed' });
  });

  it.each([
    { multipart: false, continuation: 'authorized', authorizationOutage: false, expected: ['Primero'], status: 'completed' },
    { multipart: true, continuation: 'authorized', authorizationOutage: false, expected: ['Primero', 'Segundo'], status: 'completed' },
    { multipart: true, continuation: 'superseded', authorizationOutage: false, expected: ['Primero'], status: 'absorbed' },
    { multipart: true, continuation: 'superseded', authorizationOutage: true, expected: ['Primero'], status: 'absorbed' },
  ])('resumes only the receipt and current remaining parts after losing its HTTP response ($multipart/$continuation/$authorizationOutage)', async ({ multipart, continuation, authorizationOutage, expected, status }) => {
    actionSpies.continuation.mockImplementation(async ({ input }: { input: { outbound_id: string } }) => ({
      outcome: input.outbound_id === UUID ? 'authorized' : continuation, trace_id: UUID, outbound_id: input.outbound_id,
    }));
    const suspension = { [Symbol.for('StepSignal')]: true };
    const savedSteps = new Map<string, unknown>();
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (savedSteps.has(name)) return structuredClone(savedSteps.get(name));
      const output = await run();
      savedSteps.set(name, structuredClone(output));
      return output;
    }, { sleep: vi.fn(async (name: string, delayMs: number) => {
      if (name.startsWith('await-batch-window-')) return;
      expect(delayMs).toBeGreaterThanOrEqual(10_000);
      if (savedSteps.has(name)) return;
      savedSteps.set(name, undefined);
      throw suspension;
    }) });
    const submittedTexts: string[] = [];
    const createMessage = vi.fn(async ({ payload }: { payload: { text: string } }) => {
      submittedTexts.push(payload.text);
      return { message: { id: `bp-part-${submittedTexts.length}` } };
    });
    const recorded = new Map<string, string>();
    let loseResponse = true;
    actionSpies.delivery.mockImplementation(async ({ input }: { input: { outbound_id: string; botpress_message_id: string } }) => {
      const existing = recorded.get(input.outbound_id);
      if (existing) expect(input.botpress_message_id).toBe(existing);
      recorded.set(input.outbound_id, input.botpress_message_id);
      if (loseResponse) {
        loseResponse = false;
        throw new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4);
      }
      return { status: existing ? 'duplicate' : 'recorded' };
    });
    const first = { id: UUID, content: 'Primero', status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      part_index: 0, part_count: multipart ? 2 : 1 };
    const second = { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
      part_index: 1, part_count: 2 };
    const state = processingState();
    const workflow = { id: 'receipt-recovery-test', setTimeout: vi.fn(async () => undefined) };
    const run = () => runCommittedOutbound(first, {}, { step, state, workflow, createMessage,
      ...(multipart ? { outbounds: [first, second] } : {}) });

    await expect(run()).rejects.toBe(suspension);
    expect(submittedTexts).toEqual(['Primero']);
    expect(recorded.size).toBe(1);
    expect(state).toMatchObject({ phase: 'retry_pending', errorCode: 'STUDYX_TIMEOUT' });
    expect(workflow.setTimeout).toHaveBeenCalledWith({ in: '30m' });
    if (authorizationOutage) {
      actionSpies.continuation.mockRejectedValueOnce(new StudyxHttpError('STUDYX_TIMEOUT', true));
      await expect(run()).rejects.toBe(suspension);
      expect(submittedTexts).toEqual(['Primero']);
      expect(state).toMatchObject({ pendingDeliveryReport: { stage: 'continuation', outboundId: second.id } });
      // A later inbound invalidates this part while authorization is offline.
      // No successful cached grant can bypass the next fresh backend check.
    }
    await expect(run()).resolves.toMatchObject({ result: { status,
      error_code: continuation === 'superseded' ? 'OUTBOUND_SUPERSEDED' : null } });
    expect(submittedTexts).toEqual(expected);
    expect(recorded.size).toBe(expected.length);
    if (multipart) expect(actionSpies.continuation.mock.calls.find(([call]) => call.input.outbound_id === second.id)?.[0]?.input).toEqual({
      outbound_id: second.id, trace_id: UUID, delivery_attempt: 1,
    });
    await run();
    expect(submittedTexts).toEqual(expected);
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
  });

  it('keeps a possibly accepted createMessage timeout ambiguous instead of authorizing a resend', async () => {
    const accepted: string[] = [];
    const createMessage = vi.fn(async ({ payload }: { payload: { text: string } }) => {
      accepted.push(payload.text);
      throw new DOMException('Response lost after acceptance', 'AbortError');
    });
    const state = processingState();
    await expect(runCommittedOutbound({
      authorized_egress: { schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [], protected_facts: [] },
    }, {}, { createMessage, state })).rejects.toBe(DELIVERY_SUSPENSION);
    expect(accepted).toEqual(['Contenido autorizado']);
    expect(actionSpies.delivery).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: 'retry_pending', deliveryStatus: null,
      errorCode: 'OUTBOUND_SUBMISSION_AMBIGUOUS', needsOperator: true });
  });

  it.each([false, true])('records the provider status and Error ID of an ambiguous send in evidence and log (multipart=%s)', async multipart => {
    // Shape and text observed live on 2026-11-02 (Botpress → WhatsApp integration 502).
    const providerError = Object.assign(new Error('[Create Message] Received error response when sending scheduled message to integration '
      + '"8a7bb148-c95c-4527-a75f-611b4255f53c": [Internal] Request failed with status code 502 (Error ID: err_20261102095847xE9BC49AA)'),
    { isApiError: true, code: 500, type: 'Runtime', id: 'err_20261102095847xE9BC49AA' });
    const createMessage = vi.fn(async () => { throw providerError; });
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    vi.spyOn(evidencePersistence, 'persistTurnEvidence').mockImplementation(async (_subject, event) => {
      events.push(event);
    });
    const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const state = processingState();
    const part = { id: UUID, content: 'Contenido autorizado', status: 'pending', delivery_attempt: 1,
      authorized_egress: { schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [], protected_facts: [] },
      part_index: 0, part_count: 1 };
    await expect(runCommittedOutbound(part, {}, { createMessage, state,
      ...(multipart ? { outbounds: [part] } : {}) })).rejects.toBe(DELIVERY_SUSPENSION);

    const expected = { api_type: 'Runtime', api_code: 500, upstream_type: 'Internal', upstream_status: 502,
      error_id: 'err_20261102095847xE9BC49AA' };
    // Captured before the durable suspension; flushed on the next run (live: 07:03:49).
    const ambiguous = [...events, ...((state as { pendingEvidence?: typeof events }).pendingEvidence ?? [])]
      .find(event => event.kind === 'provider_send_ambiguous');
    expect(ambiguous?.data).toMatchObject({ provider_error: expected });
    const logged = logs.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
      .find(line => line?.event === 'studyx.turn.delivery_submission_ambiguous');
    expect(logged).toMatchObject({ provider_error: { upstream_status: 502, error_id: 'err_20261102095847xE9BC49AA' } });
    expect(JSON.stringify(logged)).not.toContain('Request failed');
    // Behaviour unchanged: still ambiguous, held for an operator, never reported as failed.
    expect(actionSpies.delivery).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: 'retry_pending', deliveryStatus: null,
      errorCode: 'OUTBOUND_SUBMISSION_AMBIGUOUS', needsOperator: true });
  });

  it('holds a committed start with its HTTP response lost for review without invoking the provider', async () => {
    const saved = new Map<string, unknown>();
    const suspension = { [Symbol.for('StepSignal')]: true };
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (saved.has(name)) return structuredClone(saved.get(name));
      const output = await run();
      saved.set(name, structuredClone(output));
      return output;
    }, { sleep: vi.fn(async (name: string) => {
      if (name.startsWith('await-batch-window-') || saved.has(name)) return;
      saved.set(name, undefined);
      throw suspension;
    }) });
    let started = false;
    actionSpies.continuation.mockImplementation(async () => {
      if (!started) {
        started = true;
        throw new StudyxHttpError('STUDYX_TIMEOUT', true, null, 4);
      }
      return { outcome: 'not_owner', reason: 'SEND_ALREADY_STARTED', trace_id: UUID, outbound_id: UUID };
    });
    const createMessage = vi.fn();
    const state = processingState();
    const workflow = { id: 'lost-start-response', setTimeout: vi.fn(async () => undefined) };
    const run = () => runCommittedOutbound({ authorized_egress: { schema_version: 1,
      content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
      authorized_urls: [], protected_facts: [] } }, {}, { step, state, workflow, createMessage });
    await expect(run()).rejects.toBe(suspension);
    await expect(run()).rejects.toBe(suspension);
    await expect(run()).rejects.toBe(suspension);
    expect(createMessage).not.toHaveBeenCalled();
    expect(actionSpies.delivery).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ phase: 'retry_pending', needsOperator: true,
      errorCode: 'SEND_ALREADY_STARTED', pendingDeliveryReport: { stage: 'continuation', needsOperator: true } });
  });

  it('converges an ambiguous send after an operator records positive delivery evidence without repeating the provider', async () => {
    const saved = new Map<string, unknown>();
    const suspension = { [Symbol.for('StepSignal')]: true };
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (saved.has(name)) {
        const cached = saved.get(name);
        if (cached instanceof Error) throw new Error(cached.message);
        return structuredClone(cached);
      }
      try {
        const output = await run();
        saved.set(name, structuredClone(output));
        return output;
      } catch (error) { saved.set(name, error); throw error; }
    }, { sleep: vi.fn(async (name: string) => {
      if (name.startsWith('await-batch-window-') || saved.has(name)) return;
      saved.set(name, undefined);
      throw suspension;
    }) });
    const accepted: string[] = [];
    const createMessage = vi.fn(async () => {
      accepted.push('bp-positive-proof');
      throw new DOMException('Acceptance response lost', 'AbortError');
    });
    const state = processingState();
    const workflow = { id: 'operator-proof', setTimeout: vi.fn(async () => undefined) };
    const run = () => runCommittedOutbound({ authorized_egress: { schema_version: 1,
      content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
      authorized_urls: [], protected_facts: [] } }, {}, { step, state, workflow, createMessage });
    await expect(run()).rejects.toBe(suspension);
    expect(state).toMatchObject({ needsOperator: true, pendingDeliveryReport: { stage: 'submission_review' } });
    actionSpies.continuation.mockResolvedValue({ outcome: 'not_owner', reason: 'ALREADY_SUBMITTED',
      botpress_message_id: 'bp-positive-proof', trace_id: UUID, outbound_id: UUID });
    await expect(run()).resolves.toMatchObject({ result: { status: 'completed', error_code: null } });
    expect(accepted).toEqual(['bp-positive-proof']);
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery.mock.calls[0]?.[0]?.input).toMatchObject({
      status: 'submitted_to_botpress', botpress_message_id: 'bp-positive-proof', delivery_attempt: 1,
    });
    expect(state).toMatchObject({ needsOperator: false, pendingDeliveryReport: null });
  });

  it('propagates the exact durable suspension before Agent A generation without a fallback or effect', async () => {
    const suspension = { [Symbol.for('StepSignal')]: true };
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false, agent_a_repair_enabled: true };
    claimed.conversation_state_v1 = { selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 0 };
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;
    const createMessage = vi.fn();
    const state = processingState();
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (name === 'generate-agent-a-turn-proposal-v1-deepseek') throw suspension;
      return run();
    }, { sleep: vi.fn(async () => undefined) });
    await expect(runCommittedOutbound({}, {}, { step, state, createMessage })).rejects.toBe(suspension);
    expect(actionSpies.agentABrainDeepSeek).not.toHaveBeenCalled();
    expect(actionSpies.commit).not.toHaveBeenCalled();
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
    expect(actionSpies.delivery).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(state.errorCode).toBeNull();
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('"brain_source":"fallback"'));
  });

  it('propagates the exact durable suspension before call dispatch without reporting a failed or completed call', async () => {
    const suspension = { [Symbol.for('StepSignal')]: true };
    const createMessage = vi.fn(async () => ({ message: { id: 'bp-call-ack-before-suspend' } }));
    const state = processingState();
    const step = Object.assign(async (name: string, run: () => Promise<unknown>) => {
      if (name === 'dispatch-voice-call-after-agent-a-ack') throw suspension;
      return run();
    }, { sleep: vi.fn(async () => undefined) });
    await expect(runCommittedOutbound({
      content: 'Perfecto. Registré la llamada; nuestra asesora intenta comunicarse ahora.',
      authorized_egress: { schema_version: 1,
        content_hash: 'f8236674ae25af685196ccb4eecdd2643535544876451529a3be1cf7fa058e9f',
        authorized_urls: [], protected_facts: [] },
    }, {}, { step, state, createMessage, callRequest: { call_id: UUID, status: 'requested' } }))
      .rejects.toBe(suspension);
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(actionSpies.delivery).toHaveBeenCalledTimes(1);
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
    expect(actionSpies.flush).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: 'decision_committed', errorCode: null });
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('"event":"studyx.turn.call_dispatch_unconfirmed"'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('"event":"studyx.turn.completed"'));
  });

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
      content: 'Perfecto. Registré la llamada; nuestra asesora intenta comunicarse ahora.',
      authorized_egress: {
        schema_version: 1,
        content_hash: 'f8236674ae25af685196ccb4eecdd2643535544876451529a3be1cf7fa058e9f',
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
    await expect(runCommittedOutbound({
      content: 'Perfecto. Registré la llamada; nuestra asesora intenta comunicarse ahora.',
      authorized_egress: {
        schema_version: 1,
        content_hash: 'f8236674ae25af685196ccb4eecdd2643535544876451529a3be1cf7fa058e9f',
        authorized_urls: [],
        protected_facts: [],
      },
    }, {}, {
      createMessage: vi.fn(async () => { throw new Error('CHANNEL_UNAVAILABLE'); }),
      callRequest: { call_id: UUID, status: 'requested' },
    })).rejects.toBe(DELIVERY_SUSPENSION);

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

  it('paces model-authored bubbles without rewriting or delaying the first one', async () => {
    const submittedAt: number[] = [];
    const submittedTexts: string[] = [];
    const createMessage = vi.fn(async (input: { payload: { text: string } }) => {
      submittedTexts.push(input.payload.text);
      submittedAt.push(Date.now());
      return { message: { id: `bp-part-${submittedAt.length}` } };
    });
    const manifests = [
      { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
    ];

    await runCommittedOutbound({ authorized_egress: manifests[0] }, {}, {
      createMessage,
      outbounds: [
        { id: UUID, content: 'Primero', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[0], part_index: 0, part_count: 2 },
        { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[1], part_index: 1, part_count: 2 },
      ],
    });

    expect(submittedTexts).toEqual(['Primero', 'Segundo']);
    expect(submittedAt[1] - submittedAt[0]).toBeGreaterThanOrEqual(650);
    expect(submittedAt[1] - submittedAt[0]).toBeLessThanOrEqual(1_100);
  });

  it('stops after an ambiguous second part without authorizing any resend', async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({ message: { id: 'bp-part-1' } })
      .mockRejectedValueOnce(Object.assign(new Error('channel failed'), { code: 'CHANNEL_FAILED' }));
    const manifests = [
      { schema_version: 1, content_hash: '67d02dfce5ef9a0aa49675a19b9f92983e52abb2cceb96e6e932c26f171e68aa', authorized_urls: [], protected_facts: [] },
      { schema_version: 1, content_hash: '2f50e3d71e066e86ebb03e28f5bac2e90cd0de1982f34ecef3f0753b14b27897', authorized_urls: [], protected_facts: [] },
    ];
    const state = processingState();
    await expect(runCommittedOutbound({
      authorized_egress: manifests[0],
    }, {}, {
      createMessage,
      state,
      outbounds: [
        { id: UUID, content: 'Primero', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[0], part_index: 0, part_count: 2 },
        { id: '28a823e8-27c2-4279-9956-058f45f33cd6', content: 'Segundo', status: 'pending', delivery_attempt: 1, authorized_egress: manifests[1], part_index: 1, part_count: 2 },
      ],
    })).rejects.toBe(DELIVERY_SUSPENSION);

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(actionSpies.delivery.mock.calls.map(([call]) => call.input.status)).toEqual([
      'submitted_to_botpress',
    ]);
    expect(state).toMatchObject({ phase: 'retry_pending', deliveryStatus: null,
      errorCode: 'OUTBOUND_SUBMISSION_AMBIGUOUS', needsOperator: true });
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

  it('keeps plannerless Agent A as the sole authority when a stale call acceptance is also projected', async () => {
    configuration.agentAPlannerlessV2Enabled = true;
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.deterministic_route = 'call_accepted_offer';
    claimed.batch.message_count = 3;
    claimed.context.batch_messages = [
      { id: UUID, conversation_seq: 1, content: 'sii', created_at: NOW, message_type: 'text' },
      { id: '28a823e8-27c2-4279-9956-058f45f33cd5', conversation_seq: 2,
        content: 'esta bien', created_at: NOW, message_type: 'text' },
      { id: '38a823e8-27c2-4279-9956-058f45f33cd5', conversation_seq: 3,
        content: 'me anotas?', created_at: NOW, message_type: 'text' },
    ];
    claimed.conversation_state_v1 = {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: 'one_time',
      stage: 'plan_selected', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 1,
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas',
        academy: 'Tecnología', aliases: [] }],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
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

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.plan).not.toHaveBeenCalled();
    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: { proposed_action: { type: 'none' } },
      },
    });
  });

  it('executes an authorized direct call request without depending on a model provider', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'call_direct_request';
    configuration.agentAPlannerlessV2Enabled = true;
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'call', call_offer_status: 'accepted',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    claimed.context.batch_messages[0].content = 'Llamame';
    claimed.sales_context.allowed_actions = ['request_call_now'];
    claimed.contact_intake_missing = [];
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    actionSpies.claim.mockResolvedValue(claimed);
    secrets.DEEPSEEK_API_KEY = 'deepseek-local-test-only';
    actionSpies.agentABrainDeepSeek.mockRejectedValueOnce(new Error('MODEL_PROVIDER_UNAVAILABLE'));
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
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalled();
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2, proposal: {
        response: { messages: ['Recibí tu solicitud de llamada.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      } },
    });
  });

  it.each(['authored', 'missing_action', 'false_progress'] as const)('uses Agent A confirmation and backend consent for availability: %s', async (variant) => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: true,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'call_direct_request';
    configuration.agentAPlannerlessV2Enabled = true;
    claimed.context.batch_messages[0].content = 'si dale';
    claimed.sales_context.allowed_actions = ['request_call_now'];
    claimed.contact_intake_missing = [];
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0,
    };
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'exploring', call_preference: 'call', call_offer_status: 'accepted',
      call_offer_count: 0, awaiting_reply: 'call_or_chat', version: 4,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    const authored = 'Dale, dejamos pedida la llamada para seguir con tu consulta.';
    let requests = 0;
    actionSpies.agentABrainDeepSeek.mockImplementation(async ({ context }) => {
      requests += 1;
      const needsRepair = requests === 1 && variant !== 'authored';
      return { proposal: {
        schema_version: 1,
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: [needsRepair && variant === 'false_progress' ? 'La asesora ya está llamando.' : authored], call_offer: null },
        proposed_action: needsRepair && variant === 'missing_action' ? { type: 'none' }
          : { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [], profile_updates: [], profile_requests: [],
        repair_of: context.turn_rejection ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null,
      }, provider: 'deepseek-direct', model: 'recorded-test-provider', latency_ms: 1, attempt_count: 1 };
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

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(variant === 'authored' ? 1 : 2);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          move: { move: 'request_call' },
          response: { messages: [authored] },
          proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        },
      },
    });
  });

  it('does not invent a missing-phone reply after a model failure', async () => {
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
    actionSpies.agentABrainDeepSeek.mockRejectedValue(new Error('BRAIN_DEEPSEEK_TIMEOUT'));
    actionSpies.commit.mockResolvedValueOnce(technicalContinuityCommitResponse());
    const client = technicalContinuityClient();
    const step = Object.assign(
      async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) },
    );
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(actionSpies.commit).toHaveBeenCalledTimes(1);
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'waiting_user', delivery_status: 'submitted_to_botpress',
      error_code: null });
  });

  it('routes call_accepted_offer through authoritative Agent A before requesting the call', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = 'call_accepted_offer';
    configuration.agentAPlannerlessV2Enabled = true;
    claimed.context.batch_messages[0].content = 'Sí, llamame';
    claimed.sales_context.allowed_actions = ['request_call_now'];
    claimed.sales_context.accepted_call_offer = { decision_id: UUID, expires_at: NOW };
    claimed.contact_intake_missing = [];
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.conversation_state_v1 = {
      selected_offering_code: 'reparacion_celulares', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'call', call_offer_status: 'accepted',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockResolvedValueOnce({
      proposal: {
        schema_version: 1,
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Dale, te llamo ahora.'], call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        profile_updates: [], profile_requests: [], repair_of: null,
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    });
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

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        proposal: {
          response: { messages: ['Dale, te llamo ahora.'] },
          proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
        },
      },
    });
  });

  it('lets Agent A ask for missing data after a policy rejection without a protocol message', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
    };
    claimed.deterministic_route = null;
    claimed.context.batch_messages[0].content = 'Energía solar. Pero me gustaría una llamada por favor';
    claimed.sales_context.allowed_actions = ['offer_call'];
    claimed.contact_intake_missing = ['telefono'];
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.conversation_state_v1 = {
      selected_offering_code: 'energia_solar_fotovoltaica', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 2,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainDeepSeek.mockReset().mockRejectedValueOnce(new Error(
      'PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:candidate_course_detail,ACTION_NOT_AUTHORIZED:request_call_now',
    )).mockImplementationOnce(async ({ context }: { context: AgentAContextV1 }) => ({
      proposal: {
        schema_version: 1,
        move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Sí, podemos coordinarla. Me pasas el teléfono al que quieres que te llame?'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        repair_of: context.turn_rejection ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null,
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 100, attempt_count: 1,
    }));
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
      agent_turn_v2: { proposal: {
        proposed_action: { type: 'none' },
        response: { messages: ['Sí, podemos coordinarla. Me pasas el teléfono al que quieres que te llame?'] },
      } },
      turn_diagnostics: {
        failure_stage: 'proposal_validation',
        failure_codes: [
          'PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:candidate_course_detail',
          'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:request_call_now',
        ],
        action_status: 'none',
      },
    });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
  });

  it('turns a repeated call promise into a data request instead of abandoning the accepted call turn', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: true,
    };
    claimed.deterministic_route = 'call_accepted_offer';
    claimed.batch.message_count = 2;
    claimed.context.batch_messages = [
      { id: UUID, conversation_seq: 1, content: 'Dale, ¿me llamas?', created_at: NOW, message_type: 'text' },
      { id: '00000000-0000-4000-8000-000000000002', conversation_seq: 2,
        content: 'Espero tu llamada', created_at: NOW, message_type: 'text' },
    ];
    claimed.sales_context.allowed_actions = ['offer_call'];
    claimed.contact_intake = { nombre: null, apellido: null, correo: null, telefono: '+5491169004497' };
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo'];
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.conversation_state_v1 = {
      selected_offering_code: null, selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'call_or_chat', version: 2,
    };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainValidate.mockImplementation(({ proposal }: {
      proposal: { response: { messages: string[] } };
    }) => proposal.response.messages.some(message => /te llamo ahora/iu.test(message)) ? {
      schema_version: 1, rejection_id: UUID, attempt: 1,
      rejections: [
        { code: 'UNSUPPORTED_OPERATIONAL_CLAIM', subject: 'call_confirmation' },
        { code: 'COURSE_NOT_RESOLVED', subject: 'call_offer' },
      ],
      authorized_alternatives: {
        fact_ids: [], actions: ['none'], missing_information: ['nombre', 'apellido'],
      },
    } : null);
    actionSpies.agentABrainDeepSeek.mockImplementation(async ({ context }: { context: AgentAContextV1 }) => ({
      proposal: {
        schema_version: 1,
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: [context.turn_rejection
          ? 'Claro. Para poder llamarte, ¿me compartes tu nombre y apellido?'
          : 'Perfecto, te llamo ahora.'], call_offer: null },
        proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
        profile_requests: context.turn_rejection
          ? [{ message_index: 0, fields: ['nombre', 'apellido'], purpose: 'call', mode: 'collect' }]
          : [],
        repair_of: context.turn_rejection
          ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 }
          : null,
      },
      provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1,
    }));
    actionSpies.commit.mockResolvedValueOnce({
      status: 'committed', replayed: false, trace_id: UUID, turn_id: UUID,
      decision_id: UUID, next_state: 'waiting_user', outbound: null, call_request: null,
    });
    configuration.agentAPlannerlessV2Enabled = true;
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;

    const result = await handler({
      input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }),
      client: {}, signal: new AbortController().signal, workflow: { id: 'workflow-test' },
    });

    expect(result).toMatchObject({ status: 'waiting_user', error_code: null });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: { conversation_only: true, proposal: {
        move: { move: 'request_call' },
        proposed_action: { type: 'none' },
        response: { messages: ['Claro. Para poder llamarte, ¿me compartes tu nombre y apellido?'], call_offer: null },
        profile_requests: [{ message_index: 0, fields: ['nombre', 'apellido'], purpose: 'call', mode: 'collect' }],
      } },
    });
    expect(actionSpies.recovery).not.toHaveBeenCalled();
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
  });

  it.each(['policy', 'schema', 'timeout', 'prior_provider_retry'])('keeps safe Agent A prose and semantic state when optional continuation fails: %s', async failure => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true, agent_a_brain_v1_shadow: false };
    claimed.deterministic_route = null;
    claimed.context.batch_messages[0].content = 'Me gustaría una llamada por favor';
    claimed.sales_context.allowed_actions = ['offer_call'];
    claimed.contact_intake_missing = ['telefono'];
    claimed.catalog_index = { as_of: NOW, offerings_total: 0, offerings: [], injection_suspected_count: 0 };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    claimed.conversation_state_v1 = { selected_offering_code: 'energia_solar_fotovoltaica', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none', version: 2 };
    actionSpies.claim.mockResolvedValue(claimed);
    actionSpies.agentABrainValidate.mockImplementation(({ proposal }: { proposal: { proposed_action: { type: string } } }) => proposal.proposed_action.type === 'request_call_now' ? {
      schema_version: 1, rejection_id: UUID, attempt: 1,
      rejections: [{ code: 'ACTION_NOT_AUTHORIZED', subject: 'request_call_now' }],
      authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: ['telefono'] },
    } : null);
    const safeText = 'Podemos coordinarla. Me pasas tu teléfono con código de país?';
    actionSpies.agentABrainDeepSeek.mockReset().mockImplementationOnce(async ({ on_provider_request }: { on_provider_request?: () => void }) => {
      on_provider_request?.();
      if (failure === 'prior_provider_retry') on_provider_request?.();
      return { proposal: { schema_version: 1,
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: [safeText], call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 1,
        attempt_count: failure === 'prior_provider_retry' ? 2 : 1 };
    }).mockRejectedValueOnce(new Error(failure === 'policy'
      ? 'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:continuation'
      : failure === 'schema' ? 'BRAIN_INVALID_SCHEMA' : 'BRAIN_DEEPSEEK_TIMEOUT'));
    const step = Object.assign(async (_name: string, run: () => Promise<unknown>) => run(),
      { sleep: vi.fn(async () => undefined) });
    configuration.agentAPlannerlessV2Enabled = true;
    const handler = (processInboundTurn as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    await handler({ input: workflowInput(), state: processingState(), step,
      execute: vi.fn(async () => { throw new Error('LEGACY_MODEL_MUST_NOT_RUN'); }), client: {},
      signal: new AbortController().signal, workflow: { id: 'workflow-test' } });
    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(2);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: { conversation_only: true,
        proposal: {
        move: { move: 'request_call' }, proposed_action: { type: 'none' }, response: { messages: [safeText] },
      } }, turn_diagnostics: { generation_attempts: 2, action_status: 'needs_input' },
    });
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input.agent_turn_v2)
      .not.toHaveProperty('requested_action');
    expect(actionSpies.dispatch).not.toHaveBeenCalled();
    actionSpies.agentABrainDeepSeek.mockReset();
  });

  it('keeps Agent A multi-course guidance without forcing a second generation', async () => {
    const claimed = claimedResponse() as unknown as ClaimedTurn;
    claimed.features = {
      agent_loop_v3_mode: 'off',
      conversation_pipeline_v1_enabled: false,
      agent_a_brain_v1_enabled: true,
      agent_a_brain_v1_shadow: false,
      agent_a_repair_enabled: false,
    };
    claimed.context.batch_messages[0].content = 'Dale, pero quiero otro curso. Me puedo anotar en dos?';
    claimed.conversation_state_v1 = {
      selected_offering_code: 'community-manager', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'offered',
      call_offer_count: 1, awaiting_reply: 'none', version: 2,
    };
    claimed.catalog_index = {
      as_of: NOW, offerings_total: 2,
      offerings: [
        { code: 'community-manager', display_name: 'Community Manager', academy: 'Marketing', aliases: [] },
        { code: 'marketing-digital', display_name: 'Marketing Digital', academy: 'Marketing', aliases: [] },
      ],
      injection_suspected_count: 0,
    };
    claimed.business_context = paymentBusinessContext();
    claimed.business_context_available = true;
    actionSpies.claim.mockResolvedValue(claimed);
    configuration.agentAPlannerlessV2Enabled = true;

    const multiCourseRejection = {
        schema_version: 1,
        rejection_id: '00000000-0000-4000-8000-0000000000c1',
        attempt: 1,
        rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'candidate_course_detail' }],
        authorized_alternatives: {
          fact_ids: [], actions: ['none'], missing_information: [],
        },
      } as const;
    actionSpies.agentABrainValidate
      .mockReturnValueOnce(multiCourseRejection)
      .mockReturnValueOnce(multiCourseRejection)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);
    actionSpies.agentABrainDeepSeek
      .mockResolvedValueOnce({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.96,
          },
          response: {
            messages: ['Sí, puedes hacer más de un curso.', 'Marketing Digital combina bien con Community Manager.'],
            call_offer: null,
          },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 180, attempt_count: 1,
      })
      .mockImplementationOnce(async (input: {
        context: { turn_rejection: { rejection_id: string } | null };
      }) => ({
        proposal: {
          schema_version: 1,
          move: {
            schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.96,
          },
          response: {
            messages: ['Sí, puedes inscribirte en más de un curso.', 'Quieres que comparemos Community Manager con Marketing Digital?'],
            call_offer: null,
          },
          proposed_action: { type: 'none' },
          used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
          repair_of: {
            rejection_id: input.context.turn_rejection!.rejection_id,
            attempt: 1,
          },
        },
        provider: 'deepseek-direct', model: 'deepseek-v4-flash', latency_ms: 140, attempt_count: 1,
      }));

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

    expect(actionSpies.agentABrainDeepSeek).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input).toMatchObject({
      agent_turn_v2: {
        proposal: {
          response: {
            messages: [
              'Sí, puedes hacer más de un curso.',
              'Marketing Digital combina bien con Community Manager.',
            ],
          },
        },
      },
      turn_diagnostics: {
        failure_stage: 'none',
        action_status: 'none',
      },
    });
    expect(actionSpies.commit.mock.calls[0]?.[0]?.input?.decision?.reason_code)
      .not.toBe('MODEL_UNAVAILABLE');
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

  function invokeHandler(execute: ReturnType<typeof vi.fn>, workflow = { id: 'workflow-test', tags: {} }, client = {}) {
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
      client,
      signal: new AbortController().signal,
      workflow,
    });
  }

  it('retains legacy evidence failures for review instead of falling back or regenerating', async () => {
    configuration.decisionProvider = 'gemini_direct';
    secrets.GEMINI_API_KEY = 'synthetic-key';
    actionSpies.geminiDecision.mockResolvedValue({});
    vi.spyOn(evidencePersistence, 'persistTurnEvidence').mockRejectedValue(new Error('DB_UNAVAILABLE'));
    const workflow = { id: 'legacy-evidence-review', tags: {} };
    const updateWorkflow = vi.fn(async () => ({}));
    const result = await invokeHandler(vi.fn(), workflow, { updateWorkflow });
    expect(result).toMatchObject({ error_code: 'TURN_EVIDENCE_UNAVAILABLE' });
    expect(updateWorkflow).toHaveBeenCalledWith({ id: workflow.id, tags: { studyxEvidenceReview: 'true' } });
    expect(workflow.tags).toEqual({});
    expect(actionSpies.geminiDecision).toHaveBeenCalledTimes(1);
    expect(actionSpies.commit).not.toHaveBeenCalled();
  });

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
