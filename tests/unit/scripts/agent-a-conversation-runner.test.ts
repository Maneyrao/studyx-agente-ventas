import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSuitePromptVersion,
  buildAdkChatArgs,
  composeAgentARegressionSuite,
  runConversationCase,
  runConversationSuite,
  validateSuiteCaseInvariants,
  type ConversationSuite,
} from '../../../scripts/lib/agent-a-conversation-runner';
import { createLocalTurnSender } from '../../../scripts/run-agent-a-conversations';
import { AGENT_A_PROMPT_VERSION } from '../../../botpress-agent/src/prompts/agent-a-sales-bridge';

const LOCAL_TRANSPORT_UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const LOCAL_TRANSPORT_NOW = '2026-08-21T12:00:00.000Z';
const V15_GREEN_CASE_IDS = JSON.parse(readFileSync(
  resolve(__dirname, '../../fixtures/agent-a-v15-green-case-ids.json'),
  'utf8',
)) as string[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function localIngestResponse() {
  return {
    status: 'accepted',
    replayed: false,
    trace_id: LOCAL_TRANSPORT_UUID,
    turn_id: LOCAL_TRANSPORT_UUID,
    conversation_id: LOCAL_TRANSPORT_UUID,
    batch: {
      id: LOCAL_TRANSPORT_UUID,
      state: 'waiting',
      joined_existing: false,
      due_at: LOCAL_TRANSPORT_NOW,
      hard_deadline_at: LOCAL_TRANSPORT_NOW,
      conversation_seq: 1,
      message_count: 1,
    },
    policy: { may_respond: true, allowed_response_types: ['social_reply'], reason: null },
    contact: {
      id: LOCAL_TRANSPORT_UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
    },
    existing_result: null,
  };
}

function localClaimedTurn() {
  return {
    outcome: 'claimed',
    trace_id: LOCAL_TRANSPORT_UUID,
    batch: {
      id: LOCAL_TRANSPORT_UUID,
      claim_token: LOCAL_TRANSPORT_UUID,
      conversation_id: LOCAL_TRANSPORT_UUID,
      contact_id: LOCAL_TRANSPORT_UUID,
      lease_until: LOCAL_TRANSPORT_NOW,
      hard_deadline_at: LOCAL_TRANSPORT_NOW,
      message_count: 1,
      stolen: false,
    },
    turn_id: LOCAL_TRANSPORT_UUID,
    policy: { may_respond: true, allowed_response_types: ['social_reply'], reason: null },
    contact: {
      id: LOCAL_TRANSPORT_UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: LOCAL_TRANSPORT_NOW,
    },
    context: {
      batch_messages: [{
        id: LOCAL_TRANSPORT_UUID,
        conversation_seq: 1,
        content: 'hola',
        created_at: LOCAL_TRANSPORT_NOW,
        message_type: 'text',
      }],
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: false,
      knowledge_base: [],
      knowledge_base_available: false,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'advising',
      course_of_interest: 'Redes Informáticas',
      offering_code: 'redes_informaticas',
      open_call_offer: null,
      accepted_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    },
    catalog_resolution: {
      kind: 'exact',
      offeringCode: 'redes_informaticas',
      displayName: 'Redes Informáticas',
      academy: 'Tecnología',
      match: 'canonical',
    },
    deterministic_route: 'greeting',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Agent A conversation runner', () => {
  it('runs every turn in order and keeps the conversation id', async () => {
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: 'conv-1',
        responses: [{ type: 'text', text: 'Respuesta 1' }],
      })
      .mockResolvedValueOnce({
        conversationId: 'conv-1',
        responses: [{ type: 'text', text: 'Respuesta 2' }],
      });

    const result = await runConversationCase(
      {
        id: 'happy_test',
        name: 'Caso feliz',
        course: 'Curso Test',
        turns: ['Hola {{run_id}}', 'Quiero seguir'],
        ideal_result: {},
      },
      { runId: 'run123', sendTurn },
    );

    expect(sendTurn).toHaveBeenNthCalledWith(1, 'Hola run123', null);
    expect(sendTurn).toHaveBeenNthCalledWith(2, 'Quiero seguir', 'conv-1');
    expect(result.conversation_id).toBe('conv-1');
    expect(result.transcript).toEqual([
      { role: 'user', text: 'Hola run123' },
      { role: 'assistant', text: 'Respuesta 1' },
      { role: 'user', text: 'Quiero seguir' },
      { role: 'assistant', text: 'Respuesta 2' },
    ]);
  });

  it('records runtime parity evidence without transcript or PII fields', async () => {
    const result = await runConversationCase(
      { id: 'runtime_evidence', name: 'Runtime', course: 'Curso Test', turns: ['Hola'], ideal_result: {} },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-runtime',
          responses: [{ type: 'text', text: 'Respuesta.' }],
          runtime: {
            git_sha: 'f7f2fcf', transport: 'local', provider: 'gemini', model: 'gemini-test',
            prompt_version: 'studyx-agent-a-sales-v16', route_origin: 'advisory_model',
            route_reason: 'OPEN_CATALOG_REQUIRES_SALES_MODEL', raw_response_hash: 'a'.repeat(64),
            committed_response_hash: 'b'.repeat(64), fallback_reason: null,
          },
        }),
      },
    );
    expect(result.runtime).toEqual(expect.objectContaining({
      git_sha: expect.stringMatching(/^[0-9a-f]{7,40}$/),
      transport: 'local', provider: expect.any(String), model: expect.any(String),
      prompt_version: 'studyx-agent-a-sales-v16', route_origin: expect.any(String), route_reason: expect.any(String),
    }));
    expect(result.runtime).not.toHaveProperty('transcript');
  });

  it('persists the successful turn authority chain beside the transcript', async () => {
    const result = await runConversationCase(
      {
        id: 'authority_chain_success',
        name: 'Autoridad de turno exitosa',
        course: 'Redes Informáticas',
        turns: ['Quiero Redes Informáticas'],
        ideal_result: {},
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-authority-success',
          responses: [{ type: 'text', text: 'Redes Informáticas tiene 16 clases.' }],
          turnDiagnostic: {
            catalogResolution: {
              kind: 'exact',
              offeringCode: 'redes_informaticas',
              displayName: 'Redes Informáticas',
            },
            selectedOfferingCode: 'redes_informaticas',
            decisionBusinessAction: { type: 'course_interest', offering_code: 'redes_informaticas' },
            authorizedProtectedFacts: [{ kind: 'duration', value: '16 clases' }],
            authorizedUrls: ['https://buy.stripe.com/redes'],
            commitError: null,
          },
        }),
      },
    );

    expect(result.turn_diagnostics).toEqual([{
      catalogResolution: {
        kind: 'exact',
        offeringCode: 'redes_informaticas',
        displayName: 'Redes Informáticas',
      },
      selectedOfferingCode: 'redes_informaticas',
      decisionBusinessAction: { type: 'course_interest', offering_code: 'redes_informaticas' },
      authorizedProtectedFacts: [{ kind: 'duration', value: '16 clases' }],
      authorizedUrls: ['https://buy.stripe.com/redes'],
      commitError: null,
    }]);
  });

  it('persists an HTTP 422 commit rejection with its claim-time authority chain', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, localIngestResponse()))
      .mockResolvedValueOnce(jsonResponse(200, localClaimedTurn()))
      .mockResolvedValueOnce(jsonResponse(422, {
        error: 'DECISION_REJECTED',
        reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT',
      })));
    const sendTurn = createLocalTurnSender({
      apiBaseUrl: 'http://127.0.0.1:3000',
      orchestratorKey: 'test-orchestrator-key',
      orchestratorKeyId: 'test-key-id',
      signingSecret: 'test-signing-secret',
      cronSecret: null,
      geminiApiKey: 'test-gemini-key',
      geminiModel: 'test-gemini-model',
      groqApiKey: 'test-groq-key',
      groqModel: 'test-groq-model',
    }, 'authority-422', 'groq', 0);
    const result = await runConversationCase(
      {
        id: 'authority_chain_rejected',
        name: 'Autoridad de turno rechazada',
        course: 'Redes Informáticas',
        turns: ['Quiero Redes Informáticas'],
        ideal_result: {},
      },
      {
        runId: 'run123',
        sendTurn,
      },
    );

    expect(result.failures).toContain('turn_1_error:LOCAL_STUDYX_DECISION_REJECTED');
    expect(result.turn_diagnostics).toEqual([
      {
        catalogResolution: {
          kind: 'exact',
          offeringCode: 'redes_informaticas',
          displayName: 'Redes Informáticas',
          academy: 'Tecnología',
          match: 'canonical',
        },
        selectedOfferingCode: 'redes_informaticas',
        decisionBusinessAction: null,
        authorizedProtectedFacts: [],
        authorizedUrls: [],
        commitError: {
          status: 422,
          error: 'DECISION_REJECTED',
          reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT',
        },
      },
    ]);
  });

  it('runs the caller pacing gate immediately before every external turn', async () => {
    const events: string[] = [];
    const result = await runConversationCase(
      {
        id: 'paced_test',
        name: 'Caso con cuota externa',
        course: 'Curso Test',
        turns: ['Primero', 'Segundo'],
        ideal_result: {},
      },
      {
        runId: 'run123',
        beforeTurn: async ({ turnNumber }) => {
          events.push(`gate:${turnNumber}`);
        },
        sendTurn: async (_message, conversationId) => {
          events.push(`send:${conversationId ?? 'new'}`);
          return {
            conversationId: 'conv-paced',
            responses: [{ type: 'text', text: 'Respuesta válida' }],
          };
        },
      },
    );

    expect(result.status).toBe('passed');
    expect(events).toEqual([
      'gate:1',
      'send:new',
      'gate:2',
      'send:conv-paced',
    ]);
  });

  it('marks a happy path failed when a turn has no single text response', async () => {
    const result = await runConversationCase(
      {
        id: 'happy_silent',
        name: 'Caso silencioso',
        course: 'Curso Test',
        turns: ['Hola'],
        ideal_result: {},
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({ conversationId: 'conv-2', responses: [] }),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.failures).toContain('turn_1_expected_one_text_response_got_0');
  });

  it('accepts an explicitly expected silent turn after opt-out', async () => {
    const result = await runConversationCase(
      {
        id: 'opt_out_silence',
        name: 'Silencio durable después de baja',
        course: 'Curso Test',
        turns: ['Dame de baja', '¿Seguís ahí?'],
        ideal_result: { expected_response_count_by_turn: [1, 0] },
      },
      {
        runId: 'run123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({
            conversationId: 'conv-opt-out',
            responses: [{ type: 'text', text: 'Listo, no te enviaremos más mensajes.' }],
          })
          .mockResolvedValueOnce({ conversationId: 'conv-opt-out', responses: [] }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks.response_counts_by_turn).toEqual([1, 0]);
    expect(result.transcript).toEqual([
      { role: 'user', text: 'Dame de baja' },
      { role: 'assistant', text: 'Listo, no te enviaremos más mensajes.' },
      { role: 'user', text: '¿Seguís ahí?' },
    ]);
  });

  it('fails the exact silent turn when an outbound appears after opt-out', async () => {
    const result = await runConversationCase(
      {
        id: 'opt_out_leak',
        name: 'Outbound ilegal después de baja',
        course: 'Curso Test',
        turns: ['Dame de baja', '¿Seguís ahí?'],
        ideal_result: { expected_response_count_by_turn: [1, 0] },
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-opt-out-leak',
          responses: [{ type: 'text', text: 'Respuesta visible.' }],
        }),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.failures).toContain('turn_2_expected_text_response_count_0_got_1');
  });

  it('checks the expected payment link exactly once', async () => {
    const paymentUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
    const result = await runConversationCase(
      {
        id: 'happy_payment',
        name: 'Pago 12 meses',
        course: 'Curso Test',
        turns: ['Quiero pagar', 'Mis datos'],
        ideal_result: { plan_code: 'monthly_12', payment_link_count: 1 },
      },
      {
        runId: 'run123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({
            conversationId: 'conv-3',
            responses: [{ type: 'text', text: 'Pasame tus datos.' }],
          })
          .mockResolvedValueOnce({
            conversationId: 'conv-3',
            responses: [{ type: 'text', text: `Listo: ${paymentUrl}` }],
            authorizedUrls: [paymentUrl],
          }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks.payment_link_count).toBe(1);
  });

  it('checks that an informational conversation sends no payment link', async () => {
    const result = await runConversationCase(
      {
        id: 'happy_information_only',
        name: 'Consulta sin compra',
        course: 'Excel Integral',
        turns: ['Quiero información'],
        ideal_result: { payment_link_count: 0 },
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-info',
          responses: [{ type: 'text', text: 'Excel tiene 17 clases.' }],
        }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks.payment_link_count).toBe(0);
  });

  it('enforces a chat-first intent switch and delays the link until the selected turn', async () => {
    const result = await runConversationCase(
      {
        id: 'matia_switch',
        name: 'Cambio de interés por chat',
        course: 'Marketing Digital',
        turns: ['Cursos de inglés', 'No me llames; quiero Marketing Digital por chat', 'Plan 6 cuotas'],
        ideal_result: {
          current_course: 'Marketing Digital',
          no_call_after_turn: 2,
          no_payment_link_before_turn: 3,
          must_not_echo: 'matidamonte@inventado.com',
          no_technical_fallback: true,
        },
      },
      {
        runId: 'suite123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({ conversationId: 'conv-switch', responses: [{ type: 'text', text: 'Tenemos Inglés 1 e Inglés 2.' }] })
          .mockResolvedValueOnce({ conversationId: 'conv-switch', responses: [{ type: 'text', text: 'Marketing Digital tiene 16 clases y seguimos por chat.' }] })
          .mockResolvedValueOnce({
            conversationId: 'conv-switch',
            responses: [{ type: 'text', text: '6 pagos: https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a' }],
            authorizedUrls: ['https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a'],
          }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks).toMatchObject({
      current_course_present: true,
      call_mentioned_after_decline: false,
      payment_links_before_selected_turn: 0,
      identity_echoed: false,
      technical_fallback_used: false,
    });
  });

  it('allows the payment link immediately after an explicit plan choice', async () => {
    const paymentUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
    const result = await runConversationCase(
      {
        id: 'happy_selected_payment',
        name: 'Link elegido',
        course: 'Curso Test',
        turns: ['Quiero el plan', 'Soy Ana, ana@example.com, Miami, ZIP 33101'],
        ideal_result: { plan_code: 'monthly_12', payment_link_count: 1 },
      },
      {
        runId: 'run123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({
            conversationId: 'conv-early',
            responses: [{ type: 'text', text: `Pagá acá: ${paymentUrl}` }],
            authorizedUrls: [paymentUrl],
          })
          .mockResolvedValueOnce({
            conversationId: 'conv-early',
            responses: [{ type: 'text', text: 'Datos registrados.' }],
          }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.failures).not.toContain('payment_link_sent_before_final_turn');
  });

  it('runs all selected cases and returns a suite tally', async () => {
    const sendTurn = vi.fn().mockResolvedValue({
      conversationId: 'conv-suite',
      responses: [{ type: 'text', text: 'Respuesta válida' }],
    });
    const report = await runConversationSuite(
      {
        schema_version: '1.0',
        prompt_version: AGENT_A_PROMPT_VERSION,
        suite: 'happy-path-sales',
        cases: [
          { id: 'one', name: 'Uno', course: 'A', turns: ['Hola'], ideal_result: {} },
          { id: 'two', name: 'Dos', course: 'B', turns: ['Buenas'], ideal_result: {} },
        ],
      },
      { runId: 'suite123', sendTurn },
    );

    expect(report.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(report.run_id).toBe('suite123');
    expect(report.results).toHaveLength(2);
  });

  it('enforces turn-scoped brevity, questions and required or forbidden phrases', async () => {
    const result = await runConversationCase(
      {
        id: 'turn_scoped_quality',
        name: 'Calidad por turno',
        course: 'Excel Integral',
        turns: ['¿Qué cursos tienen?', 'Quiero Excel'],
        ideal_result: {
          turn_assertions: [
            {
              max_chars: 80,
              max_questions: 1,
              must_include: ['áreas'],
              must_include_any: ['academias', 'áreas'],
              must_not_include: ['Excel Integral'],
            },
            {
              max_lines: 2,
              must_include: ['17 clases'],
              must_not_include: ['https://'],
            },
          ],
        },
      },
      {
        runId: 'run123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({
            conversationId: 'conv-quality',
            responses: [{ type: 'text', text: 'Podemos orientarte por áreas. ¿Cuál te interesa?' }],
          })
          .mockResolvedValueOnce({
            conversationId: 'conv-quality',
            responses: [{ type: 'text', text: 'Excel Integral tiene 17 clases.\nSeguimos por chat.' }],
          }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks.turn_quality).toEqual([
      expect.objectContaining({ chars: 48, questions: 1, lines: 1 }),
      expect.objectContaining({ questions: 0, lines: 2 }),
    ]);
  });

  it('fails the exact turn that violates content and latency budgets', async () => {
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(3_501);
    const result = await runConversationCase(
      {
        id: 'turn_scoped_violation',
        name: 'Violación por turno',
        course: 'Curso Test',
        turns: ['Hola'],
        ideal_result: {
          max_turn_latency_ms: 2_000,
          turn_assertions: [{
            max_chars: 20,
            max_questions: 0,
            must_include: ['áreas'],
            must_include_any: ['academias', 'categorías'],
            must_not_include: ['catálogo'],
          }],
        },
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-violation',
          responses: [{ type: 'text', text: 'Te paso todo el catálogo. ¿Qué querés?' }],
        }),
      },
    );
    now.mockRestore();

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      'turn_1_max_chars_20_got_38',
      'turn_1_max_questions_0_got_1',
      'turn_1_required_phrase_missing:áreas',
      'turn_1_required_any_phrase_missing:academias|categorías',
      'turn_1_forbidden_phrase_present:catálogo',
      'turn_1_latency_over_2000ms_got_2501',
    ]));
  });

  it('excludes evaluator-imposed provider pacing from customer latency', async () => {
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(3_501);
    const result = await runConversationCase(
      {
        id: 'paced_latency', name: 'Pacing externo', course: 'Curso Test', turns: ['Hola'],
        ideal_result: { max_turn_latency_ms: 2_000 },
      },
      {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-paced',
          responses: [{ type: 'text', text: 'Respuesta.' }],
          evaluationPacingMs: 1_000,
        }),
      },
    );
    now.mockRestore();

    expect(result.status).toBe('passed');
    expect(result.checks.turn_latencies_ms).toEqual([1_501]);
  });

  it('aborts a suite run with PROMPT_VERSION_MISMATCH before sending any turn when the suite declares a stale prompt_version', async () => {
    const sendTurn = vi.fn();

    await expect(
      runConversationSuite(
        {
          schema_version: '1.0',
          prompt_version: 'studyx-agent-a-sales-v10',
          suite: 'stale-suite',
          cases: [
            { id: 'one', name: 'Uno', course: 'A', turns: ['Hola'], ideal_result: {} },
          ],
        },
        { runId: 'suite123', sendTurn },
      ),
    ).rejects.toThrow(/PROMPT_VERSION_MISMATCH/);

    expect(sendTurn).not.toHaveBeenCalled();
  });

  describe('assertSuitePromptVersion', () => {
    it('throws a PROMPT_VERSION_MISMATCH error when the suite version does not match the active prompt', () => {
      expect(() => assertSuitePromptVersion('studyx-agent-a-sales-v10', AGENT_A_PROMPT_VERSION)).toThrow(
        /PROMPT_VERSION_MISMATCH/,
      );
    });

    it('does not throw when the suite version matches the active prompt', () => {
      expect(() =>
        assertSuitePromptVersion(AGENT_A_PROMPT_VERSION, AGENT_A_PROMPT_VERSION),
      ).not.toThrow();
    });
  });

  it('marks the case failed when durable registration evidence is missing', async () => {
    const afterTurn = vi.fn().mockResolvedValue(undefined);
    const verifyPersistence = vi.fn().mockResolvedValue({
      checks: {
        contact_registered: true,
        inbound_messages: 1,
        outbound_messages: 1,
        decisions: 0,
      },
      failures: ['expected_decisions_1_got_0'],
    });

    const result = await runConversationCase(
      {
        id: 'persistent_customer',
        name: 'Cliente persistente',
        course: 'Excel Integral',
        turns: ['Quiero aprender Excel'],
        ideal_result: { registered_contact: true },
      },
      {
        runId: 'persist123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-persist',
          responses: [{ type: 'text', text: 'Excel tiene 17 clases.' }],
        }),
        afterTurn,
        verifyPersistence,
      },
    );

    expect(afterTurn).toHaveBeenCalledWith({
      testCase: expect.objectContaining({ id: 'persistent_customer' }),
      conversationId: 'conv-persist',
      turnNumber: 1,
    });
    expect(verifyPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'persistent_customer' }),
      'conv-persist',
    );
    expect(result.checks).toMatchObject({ contact_registered: true, decisions: 0 });
    expect(result.failures).toContain('expected_decisions_1_got_0');
    expect(result.status).toBe('failed');
  });

  it('builds the ADK command and preserves an existing conversation', async () => {
    expect(buildAdkChatArgs('Seguimos', null, '1m')).toEqual([
      'chat',
      '--single',
      'Seguimos',
      '--format',
      'json',
      '--timeout',
      '1m',
    ]);
    expect(buildAdkChatArgs('Seguimos', 'conv-1', '1m')).toContain('conv-1');
  });

  describe('exactly one text response per turn (task-5)', () => {
    it('passes when every turn returns exactly one text response', async () => {
      const result = await runConversationCase(
        {
          id: 'one_response_ok',
          name: 'Una respuesta por turno',
          course: 'Curso Test',
          turns: ['Hola'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-single',
            responses: [{ type: 'text', text: 'Una sola respuesta.' }],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.failures).not.toContain(
        'turn_1_expected_one_text_response_got_2',
      );
    });

    it('fails a turn that returns more than one text response', async () => {
      const result = await runConversationCase(
        {
          id: 'one_response_violation',
          name: 'Dos respuestas en un turno',
          course: 'Curso Test',
          turns: ['Hola'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-double',
            responses: [
              { type: 'text', text: 'Primera respuesta.' },
              { type: 'text', text: 'Segunda respuesta partida.' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_expected_one_text_response_got_2');
    });
  });

  describe('customer email is never echoed back (task-5)', () => {
    it('passes when the reply never repeats the customer email', async () => {
      const result = await runConversationCase(
        {
          id: 'email_ok',
          name: 'No hace eco del email',
          course: 'Curso Test',
          customer: { first_name: 'Ana', last_name: 'Lopez', email: 'ana.lopez+{{run_id}}@example.test' },
          turns: ['Soy Ana Lopez, ana.lopez+{{run_id}}@example.test'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-email-ok',
            responses: [{ type: 'text', text: 'Perfecto Ana, ya registré tus datos.' }],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.customer_email_echoed).toBe(false);
    });

    it('fails when the reply repeats the customer email verbatim', async () => {
      const result = await runConversationCase(
        {
          id: 'email_violation',
          name: 'Hace eco del email',
          course: 'Curso Test',
          customer: { first_name: 'Ana', last_name: 'Lopez', email: 'ana.lopez+{{run_id}}@example.test' },
          turns: ['Soy Ana Lopez, ana.lopez+{{run_id}}@example.test'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-email-bad',
            responses: [
              { type: 'text', text: 'Perfecto, registré ana.lopez+run123@example.test en el sistema.' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.checks.customer_email_echoed).toBe(true);
      expect(result.failures).toContain('customer_email_echoed');
    });
  });

  describe('no non-canonical links (task-5)', () => {
    it('passes when the only link sent is the canonical Stripe payment link', async () => {
      const paymentUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
      const result = await runConversationCase(
        {
          id: 'link_ok',
          name: 'Sólo link canónico',
          course: 'Curso Test',
          turns: ['Confirmo el plan'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-link-ok',
            responses: [{ type: 'text', text: `Pagá acá: ${paymentUrl}` }],
            authorizedUrls: [paymentUrl],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.non_canonical_links).toEqual([]);
    });

    it('fails when the reply includes a link outside the canonical payment domain', async () => {
      const result = await runConversationCase(
        {
          id: 'link_violation',
          name: 'Link no canónico',
          course: 'Curso Test',
          turns: ['Mandame el link'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-link-bad',
            responses: [
              { type: 'text', text: 'Mirá esto: https://paypal.me/studyx-fake-link' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.checks.non_canonical_links).toEqual([
        'https://paypal.me/studyx-fake-link',
      ]);
      expect(result.failures).toContain(
        'non_canonical_link_detected:https://paypal.me/studyx-fake-link',
      );
    });

    it('fails closed when a canonical-looking URL has no turn snapshot allowlist evidence', async () => {
      const paymentUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
      const result = await runConversationCase(
        {
          id: 'link_without_snapshot_evidence',
          name: 'Link sin evidencia del snapshot',
          course: 'Curso Test',
          turns: ['Mandame el link'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-link-no-evidence',
            responses: [{ type: 'text', text: `Pagá acá: ${paymentUrl}` }],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_authorized_url_evidence_missing');
    });

    it('rejects another real plan URL when it is not in this turn snapshot allowlist', async () => {
      const authorizedUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
      const wrongPlanUrl = 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a';
      const result = await runConversationCase(
        {
          id: 'link_wrong_plan',
          name: 'Link de otro plan',
          course: 'Curso Test',
          turns: ['Quiero 12 pagos'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-link-wrong-plan',
            responses: [{ type: 'text', text: `Pagá acá: ${wrongPlanUrl}` }],
            authorizedUrls: [authorizedUrl],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain(`turn_1_url_not_in_snapshot_allowlist:${wrongPlanUrl}`);
    });

    it('trusts an exact URL from the captured turn snapshot even if a static fixture is stale', async () => {
      const snapshotUrl = 'https://buy.stripe.com/new-snapshot-link';
      const result = await runConversationCase(
        {
          id: 'link_new_snapshot',
          name: 'Link nuevo autorizado por snapshot',
          course: 'Curso Test',
          turns: ['Mandame el link vigente'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-link-new-snapshot',
            responses: [{ type: 'text', text: `Pagá acá: ${snapshotUrl}` }],
            authorizedUrls: [snapshotUrl],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.non_canonical_links).toEqual([]);
    });
  });

  describe('structured hard-fail oracle for an absent catalog offering', () => {
    const absenceCase = (
      overrides: Record<string, unknown> = {},
    ): ConversationSuite['cases'][number] => ({
      id: 'g35_22_course_absent',
      name: 'Python no existe en el catálogo',
      course: 'Python',
      turns: ['¿Tienen Python?'],
      ideal_result: {
        catalog_absence_oracle: {
          requested_terms: ['Python', 'programación', 'desarrollo web'],
          allowed_alternative_codes: [],
          require_complete_snapshot: true,
        },
        ...overrides,
      },
    });

    const commercialEvidence = (overrides: Record<string, unknown> = {}) => ({
      catalogResolution: {
        kind: 'not_found' as const,
        requestedText: 'Python',
        requestedArea: null,
        alternativeCodes: ['excel-integral', 'armado-reparacion-pc'],
      },
      snapshotOfferings: [
        { code: 'excel-integral', displayName: 'Excel Integral' },
        { code: 'armado-reparacion-pc', displayName: 'Armado y Reparación de PC' },
      ],
      offeringsTruncated: 0,
      selectedOfferingCode: null,
      decisionBusinessAction: null,
      authorizedProtectedFacts: [],
      authorizedUrls: [],
      ...overrides,
    });

    const runAbsentCase = (
      response: string,
      evidence: ReturnType<typeof commercialEvidence> | 'missing' = commercialEvidence(),
      testCase = absenceCase(),
    ) => runConversationCase(testCase, {
      runId: 'run123',
      sendTurn: vi.fn().mockResolvedValue({
        conversationId: 'conv-python-absent',
        responses: [{ type: 'text', text: response }],
        commercialEvidence: evidence === 'missing' ? undefined : evidence,
      }),
    });

    it('passes a denial grounded in a complete snapshot and a not-found resolution', async () => {
      const result = await runAbsentCase(
        'No tenemos un curso de Python en el catálogo verificado. No puedo confirmar clases, precio ni planes.',
      );

      expect(result.status).toBe('passed');
      expect(result.checks.catalog_absence_oracle).toEqual([
        expect.objectContaining({ evidence_present: true, snapshot_complete: true }),
      ]);
    });

    it('fails closed when the turn did not expose structured snapshot and claim evidence', async () => {
      const result = await runAbsentCase(
        'No tenemos un curso de Python.',
        'missing',
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_catalog_absence_evidence_missing');
    });

    it('fails even with safe copy when the supposedly absent offering exists in the snapshot', async () => {
      const result = await runAbsentCase(
        'No puedo confirmar ese curso.',
        commercialEvidence({
          snapshotOfferings: [
            { code: 'python', displayName: 'Programación en Python' },
          ],
        }),
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_forbidden_offering_present_in_snapshot:python');
    });

    it('fails when claim state resolves or selects an offering for the absent request', async () => {
      const result = await runAbsentCase(
        'No puedo confirmar ese curso.',
        commercialEvidence({
          catalogResolution: {
            kind: 'exact',
            offeringCode: 'ghost-python',
            displayName: 'Oferta fantasma',
          },
          selectedOfferingCode: 'ghost-python',
        }),
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toEqual(expect.arrayContaining([
        'turn_1_catalog_absence_resolution_exact:ghost-python',
        'turn_1_catalog_absence_selected_offering:ghost-python',
      ]));
    });

    it('fails an affirmative availability claim contradicted by not-found evidence', async () => {
      const result = await runAbsentCase('Sí, StudyX ofrece Programación en Python.');

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_unsupported_availability_claim:python');
    });

    it('fails a deictic availability confirmation that omits the requested course name', async () => {
      const result = await runAbsentCase('Sí, está disponible y podés hacerlo con nosotros.');

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_unsupported_availability_claim:python');
    });

    it.each([
      ['classes', 'Python tiene 24 clases.'],
      ['price', 'Cuesta USD 360.'],
      ['payment_plan', 'Podés pagarlo en 12 cuotas.'],
    ])('fails an invented %s fact when no offering is selected', async (kind, response) => {
      const result = await runAbsentCase(response);

      expect(result.status).toBe('failed');
      expect(result.failures).toContain(`turn_1_unsupported_commercial_fact:${kind}`);
    });

    it('fails an alternative proposal whose canonical code was not authorized', async () => {
      const result = await runAbsentCase(
        'Como alternativa te recomiendo Armado y Reparación de PC.',
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain(
        'turn_1_unapproved_catalog_alternative:armado-reparacion-pc',
      );
    });

    it('does not confuse internal snapshot-backed candidates with rendered recommendations', async () => {
      const result = await runAbsentCase(
        'No tenemos una alternativa respaldada para recomendarte.',
        commercialEvidence({
          catalogResolution: {
            kind: 'not_found',
            requestedText: 'Python',
            requestedArea: null,
            alternativeCodes: ['armado-reparacion-pc'],
          },
        }),
      );

      expect(result.failures).toEqual([]);
      expect(result.status).toBe('passed');
    });

    it('allows a real snapshot alternative only when its canonical code is explicitly authorized', async () => {
      const testCase = absenceCase({
        catalog_absence_oracle: {
          requested_terms: ['Python'],
          allowed_alternative_codes: ['armado-reparacion-pc'],
          require_complete_snapshot: true,
        },
      });
      const result = await runAbsentCase(
        'No tenemos Python. Como alternativa te recomiendo Armado y Reparación de PC.',
        commercialEvidence({
          catalogResolution: {
            kind: 'not_found',
            requestedText: 'Python',
            requestedArea: null,
            alternativeCodes: ['armado-reparacion-pc'],
          },
        }),
        testCase,
      );

      expect(result.status).toBe('passed');
    });

    it('fails a structured payment action or protected fact even when the visible copy looks safe', async () => {
      const result = await runAbsentCase(
        'No puedo confirmar ese curso.',
        commercialEvidence({
          decisionBusinessAction: {
            type: 'send_payment_link',
            plan_code: 'monthly_12',
            offering_sku: 'python',
          },
          authorizedProtectedFacts: [{ kind: 'price', value: 'usd 360' }],
        }),
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toEqual(expect.arrayContaining([
        'turn_1_catalog_absence_business_action:send_payment_link',
        'turn_1_catalog_absence_authorized_fact:price',
      ]));
    });

    it('fails a payment URL authorized for an offering that structured evidence says is absent', async () => {
      const result = await runAbsentCase(
        'No puedo confirmar ese curso.',
        commercialEvidence({
          authorizedUrls: ['https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f'],
        }),
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_catalog_absence_authorized_url');
    });

    it('fails when the snapshot is missing or truncated instead of treating absence as proven', async () => {
      const result = await runAbsentCase(
        'No puedo verificar el catálogo ahora.',
        commercialEvidence({ offeringsTruncated: 2 }),
      );

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_1_catalog_snapshot_incomplete');
    });
  });

  describe('at most one call offer after a decline (task-5, case-15 semantics)', () => {
    it('passes when the agent never re-offers a call after the customer declined it', async () => {
      const result = await runConversationCase(
        {
          id: 'call_offer_ok',
          name: 'Sin insistencia tras rechazo',
          course: 'Excel Integral',
          turns: ['No quiero llamada, prefiero texto', '¿Cuántas clases tiene?'],
          ideal_result: { no_call_after_turn: 1 },
        },
        {
          runId: 'run123',
          sendTurn: vi
            .fn()
            .mockResolvedValueOnce({
              conversationId: 'conv-offer-ok',
              responses: [{ type: 'text', text: 'Dale, seguimos por acá sin drama.' }],
            })
            .mockResolvedValueOnce({
              conversationId: 'conv-offer-ok',
              responses: [{ type: 'text', text: 'Excel Integral tiene 17 clases.' }],
            }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.call_offers_after_decline_count).toBe(0);
    });

    it('fails when the agent proposes a call more than once after the customer declined it', async () => {
      const result = await runConversationCase(
        {
          id: 'call_offer_violation',
          name: 'Insiste con la llamada tras rechazo',
          course: 'Excel Integral',
          turns: ['No quiero llamada, prefiero texto', '¿Seguro?', 'Bueno, ¿cuántas clases tiene?'],
          ideal_result: { no_call_after_turn: 1 },
        },
        {
          runId: 'run123',
          sendTurn: vi
            .fn()
            .mockResolvedValueOnce({
              conversationId: 'conv-offer-bad',
              responses: [{ type: 'text', text: '¿Querés que te llame igual en un rato?' }],
            })
            .mockResolvedValueOnce({
              conversationId: 'conv-offer-bad',
              responses: [{ type: 'text', text: 'Te puedo llamar cuando quieras, avisame.' }],
            })
            .mockResolvedValueOnce({
              conversationId: 'conv-offer-bad',
              responses: [{ type: 'text', text: 'Excel Integral tiene 17 clases.' }],
            }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.checks.call_offers_after_decline_count).toBe(2);
      expect(result.failures).toContain('call_offer_repeated_after_decline');
    });
  });

  describe('CALL_OFFER_PATTERN widened to "la llamada" phrasing (task-5 fix round 1)', () => {
    it('fails when the agent repeats "coordinamos la llamada" more than once after a decline', async () => {
      const result = await runConversationCase(
        {
          id: 'call_offer_la_violation',
          name: 'Insiste con "la llamada" tras rechazo',
          course: 'Excel Integral',
          turns: ['No quiero llamada, prefiero texto', '¿Seguro?', 'Bueno, ¿cuántas clases tiene?'],
          ideal_result: { no_call_after_turn: 1 },
        },
        {
          runId: 'run123',
          sendTurn: vi
            .fn()
            .mockResolvedValueOnce({
              conversationId: 'conv-la-bad',
              responses: [{ type: 'text', text: '¿Coordinamos la llamada para más tarde?' }],
            })
            .mockResolvedValueOnce({
              conversationId: 'conv-la-bad',
              responses: [{ type: 'text', text: 'Dale, coordinamos la llamada cuando quieras.' }],
            })
            .mockResolvedValueOnce({
              conversationId: 'conv-la-bad',
              responses: [{ type: 'text', text: 'Excel Integral tiene 17 clases.' }],
            }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.checks.call_offers_after_decline_count).toBe(2);
      expect(result.failures).toContain('call_offer_repeated_after_decline');
    });
  });

  describe('no prohibited promises (task-5 fix round 1, suite-wide)', () => {
    it('fails when the agent guarantees a job outcome', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_job_violation',
          name: 'Promete salida laboral garantizada',
          course: 'Energía Solar Fotovoltaica',
          turns: ['¿Me garantizan trabajo?'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-job',
            responses: [
              { type: 'text', text: 'Tranquilo, te garantizo salida laboral apenas termines el curso.' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.checks.prohibited_promises_detected).toEqual([
        'te garantizo salida laboral',
      ]);
      expect(result.failures).toContain('prohibited_promise_detected:te garantizo salida laboral');
    });

    it('fails when the agent invents a discount', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_discount_violation',
          name: 'Inventa un descuento',
          course: 'Curso Test',
          turns: ['¿Hay descuento?'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-discount',
            responses: [
              { type: 'text', text: 'Dale, te hago un 50% de descuento si te anotás hoy mismo.' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.failures.some((f) => f.startsWith('prohibited_promise_detected:'))).toBe(true);
    });

    it('fails when the agent promises an unconfirmed refund', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_refund_violation',
          name: 'Promete devolución no confirmada',
          course: 'Curso Test',
          turns: ['¿Y si no me gusta?'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-refund',
            responses: [
              { type: 'text', text: 'Si no te gusta, te devolvemos la plata sin problema.' },
            ],
          }),
        },
      );

      expect(result.status).toBe('failed');
      expect(result.failures.some((f) => f.startsWith('prohibited_promise_detected:'))).toBe(true);
    });

    it('passes real price/plan claims, real course facts and neutral guidance without a false positive', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_legit_catalog',
          name: 'Hechos reales del catálogo, sin promesas',
          course: 'Excel Integral',
          turns: ['¿Cuántas clases tiene y cómo pago?'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-legit',
            responses: [
              {
                type: 'text',
                text:
                  'Excel Integral tiene 17 clases. Podés pagarlo en 12 cuotas de 30 dólares, ' +
                  '6 cuotas de 60 o un pago único de 360 dólares.',
              },
            ],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.prohibited_promises_detected).toEqual([]);
    });

    it('passes a mention of the canonical completion certificate without a false positive', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_legit_certificate',
          name: 'Certificado de finalización canónico',
          course: 'Excel Integral',
          turns: ['¿Dan certificado?'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-cert',
            responses: [
              {
                type: 'text',
                text: 'Este curso entrega un certificado de finalización de StudyX al terminar el programa.',
              },
            ],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.prohibited_promises_detected).toEqual([]);
    });

    it('passes neutral guidance with no catalog facts or promises', async () => {
      const result = await runConversationCase(
        {
          id: 'promise_legit_neutral',
          name: 'Guía neutral',
          course: 'Curso Test',
          turns: ['Hola'],
          ideal_result: {},
        },
        {
          runId: 'run123',
          sendTurn: vi.fn().mockResolvedValue({
            conversationId: 'conv-promise-neutral',
            responses: [
              {
                type: 'text',
                text: 'Contame qué te gustaría aprender y te oriento con las opciones disponibles.',
              },
            ],
          }),
        },
      );

      expect(result.status).toBe('passed');
      expect(result.checks.prohibited_promises_detected).toEqual([]);
    });
  });

  describe('validateSuiteCaseInvariants (task-5)', () => {
    const baseCase = (overrides: Partial<ConversationSuite['cases'][number]> = {}) => ({
      id: 'case_1',
      name: 'Caso 1',
      course: 'Curso Test',
      persona: { segment: 'segmento_a', traits: ['t1'] },
      customer: { first_name: 'A', last_name: 'B', email: 'a@example.test' },
      turns: ['t1', 't2', 't3', 't4'],
      ideal_result: {},
      ...overrides,
    });

    it('returns no violations for a suite with unique ids, emails, personas and valid turn counts', () => {
      const suite: ConversationSuite = {
        schema_version: '1.0',
        prompt_version: AGENT_A_PROMPT_VERSION,
        suite: 'ok-suite',
        cases: [
          baseCase(),
          baseCase({
            id: 'case_2',
            persona: { segment: 'segmento_b', traits: ['t2'] },
            customer: { first_name: 'C', last_name: 'D', email: 'c@example.test' },
          }),
        ],
      };

      expect(validateSuiteCaseInvariants(suite)).toEqual([]);
    });

    it('flags duplicate ids, duplicate emails, duplicate personas and out-of-range turn counts', () => {
      const suite: ConversationSuite = {
        schema_version: '1.0',
        prompt_version: AGENT_A_PROMPT_VERSION,
        suite: 'broken-suite',
        cases: [
          baseCase({ turns: ['solo un turno'] }),
          baseCase({ turns: ['solo un turno'] }),
        ],
      };

      const violations = validateSuiteCaseInvariants(suite);
      expect(violations).toContain('duplicate_case_id:case_1');
      expect(violations).toContain('duplicate_customer_email:a@example.test');
      expect(violations).toContain('duplicate_persona:case_1');
      expect(violations).toContain('turn_count_out_of_range:case_1:1');
    });

    it('flags ideal_result keys that the runner would otherwise ignore', () => {
      const suite: ConversationSuite = {
        schema_version: '1.0',
        prompt_version: AGENT_A_PROMPT_VERSION,
        suite: 'unknown-assertion-suite',
        cases: [baseCase({
          ideal_result: { final_state: 'payment_link_sent' },
        })],
      };

      expect(validateSuiteCaseInvariants(suite)).toContain(
        'unknown_ideal_result_key:case_1:final_state',
      );
    });

    it('flags response-cardinality and turn-assertion arrays that do not cover every turn', () => {
      const suite: ConversationSuite = {
        schema_version: '1.0',
        prompt_version: AGENT_A_PROMPT_VERSION,
        suite: 'incomplete-turn-oracles',
        cases: [baseCase({
          ideal_result: {
            expected_response_count_by_turn: [1, 0],
            turn_assertions: [{ max_questions: 1 }],
          },
        })],
      };

      expect(validateSuiteCaseInvariants(suite)).toEqual(expect.arrayContaining([
        'expected_response_count_length_mismatch:case_1:2:4',
        'turn_assertions_length_mismatch:case_1:1:4',
      ]));
    });
  });

  describe('35 + 15 regression composition evidence', () => {
    const regressionCase = (id: string): ConversationSuite['cases'][number] => ({
      id,
      name: id,
      course: 'Curso Test',
      persona: { id },
      customer: { first_name: id, last_name: 'Test', email: `${id}@example.test` },
      turns: ['t1', 't2', 't3', 't4'],
      ideal_result: {},
    });

    const baseSuite = (): ConversationSuite => ({
      schema_version: '1.0',
      prompt_version: AGENT_A_PROMPT_VERSION,
      suite: 'base-35',
      cases: Array.from({ length: 35 }, (_, index) => regressionCase(`g35_${index + 1}`)),
    });

    const extensionSuite = (): ConversationSuite => ({
      schema_version: '1.0',
      prompt_version: AGENT_A_PROMPT_VERSION,
      suite: 'council-50',
      base_suite: './base.json',
      cases: Array.from({ length: 15 }, (_, index) => regressionCase(`c50_${index + 36}`)),
    });

    it('composes exactly 35 + 15 unique cases and preserves auditable hashes', () => {
      const suite = composeAgentARegressionSuite({
        baseSuite: baseSuite(),
        extensionSuite: extensionSuite(),
        baseSha256: 'a'.repeat(64),
        extensionSha256: 'b'.repeat(64),
      });

      expect(suite.cases).toHaveLength(50);
      expect(suite.composition).toEqual({
        base_cases: 35,
        extension_cases: 15,
        effective_cases: 50,
        base_sha256: 'a'.repeat(64),
        extension_sha256: 'b'.repeat(64),
        effective_case_ids: [
          ...Array.from({ length: 35 }, (_, index) => `g35_${index + 1}`),
          ...Array.from({ length: 15 }, (_, index) => `c50_${index + 36}`),
        ],
      });
    });

    it('includes composition counts, hashes and all 50 ids in the final report', async () => {
      const suite = composeAgentARegressionSuite({
        baseSuite: baseSuite(),
        extensionSuite: extensionSuite(),
        baseSha256: 'a'.repeat(64),
        extensionSha256: 'b'.repeat(64),
      });
      const report = await runConversationSuite(suite, {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-regression',
          responses: [{ type: 'text', text: 'Respuesta.' }],
        }),
      });

      expect(report).toMatchObject({
        base_cases: 35,
        extension_cases: 15,
        effective_cases: 50,
        executed_cases: 50,
        regression_gate_complete: true,
        base_sha256: 'a'.repeat(64),
        extension_sha256: 'b'.repeat(64),
        effective_case_ids: expect.arrayContaining(['g35_1', 'g35_35', 'c50_36', 'c50_50']),
      });
      expect(report.effective_case_ids).toHaveLength(50);
      expect(report.executed_case_ids).toHaveLength(50);
    });

    it('marks a selected debug subset as incomplete instead of presenting it as a 50-case gate', async () => {
      const composed = composeAgentARegressionSuite({
        baseSuite: baseSuite(),
        extensionSuite: extensionSuite(),
        baseSha256: 'a'.repeat(64),
        extensionSha256: 'b'.repeat(64),
      });
      const selectedSuite = { ...composed, cases: [composed.cases[0]!] };
      const report = await runConversationSuite(selectedSuite, {
        runId: 'run123',
        sendTurn: vi.fn().mockResolvedValue({
          conversationId: 'conv-debug',
          responses: [{ type: 'text', text: 'Respuesta.' }],
        }),
      });

      expect(report).toMatchObject({
        effective_cases: 50,
        executed_cases: 1,
        executed_case_ids: ['g35_1'],
        regression_gate_complete: false,
      });
    });

    it('rejects a raw 15-case extension before spending any turn', async () => {
      const sendTurn = vi.fn();

      await expect(runConversationSuite(
        extensionSuite(),
        { runId: 'run123', sendTurn },
      )).rejects.toThrow('REGRESSION_COMPOSITION_EVIDENCE_MISSING');
      expect(sendTurn).not.toHaveBeenCalled();
    });

    it('rejects a duplicate ID across base and extension', () => {
      const extension = extensionSuite();
      extension.cases[0] = regressionCase('g35_1');

      expect(() => composeAgentARegressionSuite({
        baseSuite: baseSuite(),
        extensionSuite: extension,
        baseSha256: 'a'.repeat(64),
        extensionSha256: 'b'.repeat(64),
      })).toThrow('REGRESSION_CASE_IDS_NOT_UNIQUE');
    });
  });

  describe('the real 35-case suite file (task-5)', () => {
    const loadRealSuite = () => {
      const suitePath = resolve(
        __dirname,
        '../../../botpress-agent/evals/personas/studyx-internal-gemini-35-v1.json',
      );
      return JSON.parse(readFileSync(suitePath, 'utf8')) as ConversationSuite;
    };

    const pythonEvidence = () => ({
      catalogResolution: {
        kind: 'not_found' as const,
        requestedText: 'Python',
        requestedArea: null,
        alternativeCodes: ['excel-integral', 'armado-reparacion-pc'],
      },
      snapshotOfferings: [
        { code: 'excel-integral', displayName: 'Excel Integral' },
        { code: 'armado-reparacion-pc', displayName: 'Armado y Reparación de PC' },
      ],
      offeringsTruncated: 0,
      selectedOfferingCode: null,
      decisionBusinessAction: null,
      authorizedProtectedFacts: [],
      authorizedUrls: [],
    });

    it('declares the current prompt_version and satisfies every suite-level invariant', () => {
      const suite = loadRealSuite();

      expect(suite.prompt_version).toBe(AGENT_A_PROMPT_VERSION);
      expect(suite.cases).toHaveLength(35);
      expect(new Set(suite.cases.map((c) => c.id)).size).toBe(35);
      expect(validateSuiteCaseInvariants(suite)).toEqual([]);
      expect(suite.cases.find((testCase) => testCase.id === 'g35_22_curso_inexistente_python'))
        .toMatchObject({
          ideal_result: {
            catalog_absence_oracle: {
              requested_terms: ['Python', 'programación', 'desarrollo web'],
              allowed_alternative_codes: [],
              require_complete_snapshot: true,
            },
          },
        });
    });

    it('keeps every approved v15 case in the effective 35 + 15 regression suite', () => {
      const base = loadRealSuite();
      const extension = JSON.parse(readFileSync(resolve(
        __dirname,
        '../../../botpress-agent/evals/personas/studyx-council-50-v1.json',
      ), 'utf8')) as ConversationSuite;
      const effectiveIds = new Set([...base.cases, ...extension.cases].map(({ id }) => id));
      expect(V15_GREEN_CASE_IDS).toHaveLength(20);
      expect(new Set(V15_GREEN_CASE_IDS).size).toBe(20);
      for (const id of V15_GREEN_CASE_IDS) expect(effectiveIds.has(id)).toBe(true);
    });

    it('executes all four g35_22 turns against structured not-found evidence', async () => {
      const testCase = loadRealSuite().cases.find(
        (candidate) => candidate.id === 'g35_22_curso_inexistente_python',
      )!;
      const replies = [
        'No tenemos un curso de Python en el catálogo verificado.',
        'No puedo confirmar duración ni clases para una oferta inexistente.',
        'No tengo una alternativa respaldada para recomendarte.',
        'No puedo confirmar precio ni planes de pago para Python.',
      ];
      let turnIndex = 0;

      const result = await runConversationCase(testCase, {
        runId: 'run123',
        sendTurn: vi.fn().mockImplementation(async () => ({
          conversationId: 'conv-real-python',
          responses: [{ type: 'text', text: replies[turnIndex++]! }],
          commercialEvidence: pythonEvidence(),
        })),
        verifyPersistence: vi.fn().mockResolvedValue({ checks: {}, failures: [] }),
      });

      expect(result.failures).toEqual([]);
      expect(result.status).toBe('passed');
      expect(result.checks.catalog_absence_oracle).toHaveLength(4);
    });

    it('pinpoints the malicious turn if g35_22 claims Python availability', async () => {
      const testCase = loadRealSuite().cases.find(
        (candidate) => candidate.id === 'g35_22_curso_inexistente_python',
      )!;
      const replies = [
        'No tenemos un curso de Python.',
        'No puedo confirmar duración ni clases.',
        'Sí, StudyX ofrece Desarrollo Web como alternativa.',
        'No puedo confirmar precio ni planes.',
      ];
      let turnIndex = 0;

      const result = await runConversationCase(testCase, {
        runId: 'run123',
        sendTurn: vi.fn().mockImplementation(async () => ({
          conversationId: 'conv-real-python-red',
          responses: [{ type: 'text', text: replies[turnIndex++]! }],
          commercialEvidence: pythonEvidence(),
        })),
        verifyPersistence: vi.fn().mockResolvedValue({ checks: {}, failures: [] }),
      });

      expect(result.status).toBe('failed');
      expect(result.failures).toContain('turn_3_unsupported_availability_claim:desarrollo_web');
    });
  });
});
