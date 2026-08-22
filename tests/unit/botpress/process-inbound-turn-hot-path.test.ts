import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionSpies = vi.hoisted(() => ({
  ingest: vi.fn(),
  claim: vi.fn(),
  catalog: vi.fn(),
  commit: vi.fn(),
  dispatch: vi.fn(),
  delivery: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock('../../../botpress-agent/src/actions/ingestTurn', () => ({
  ingestTurn: { execute: actionSpies.ingest },
}));
vi.mock('../../../botpress-agent/src/actions/claimBatch', () => ({
  claimBatch: { execute: actionSpies.claim },
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

import { configuration } from '../../helpers/botpress-runtime-stub';
import { processInboundTurn } from '../../../botpress-agent/src/workflows/processInboundTurn';
import { DEFAULT_REQUEST_TIMEOUT_MS, resolveRequestTimeoutMs } from '../../../botpress-agent/src/utils/http';
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
      open_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    },
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
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    expect(actionSpies.catalog).toHaveBeenCalledTimes(0);

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
    expect(result.kind).toBe('skip');
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
