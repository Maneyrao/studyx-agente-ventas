import { describe, expect, it, vi } from 'vitest';
import {
  buildAdkChatArgs,
  runConversationCase,
  runConversationSuite,
} from '../../../scripts/lib/agent-a-conversation-runner';

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
          }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks.payment_link_count).toBe(1);
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
        },
      },
      {
        runId: 'suite123',
        sendTurn: vi
          .fn()
          .mockResolvedValueOnce({ conversationId: 'conv-switch', responses: [{ type: 'text', text: 'Tenemos Inglés 1 e Inglés 2.' }] })
          .mockResolvedValueOnce({ conversationId: 'conv-switch', responses: [{ type: 'text', text: 'Marketing Digital tiene 16 clases y seguimos por chat.' }] })
          .mockResolvedValueOnce({ conversationId: 'conv-switch', responses: [{ type: 'text', text: '6 pagos: https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a' }] }),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.checks).toMatchObject({
      current_course_present: true,
      call_mentioned_after_decline: false,
      payment_links_before_selected_turn: 0,
      identity_echoed: false,
    });
  });

  it('fails when the payment link is sent before the final data turn', async () => {
    const paymentUrl = 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f';
    const result = await runConversationCase(
      {
        id: 'happy_early_payment',
        name: 'Link prematuro',
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
          })
          .mockResolvedValueOnce({
            conversationId: 'conv-early',
            responses: [{ type: 'text', text: 'Datos registrados.' }],
          }),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.failures).toContain('payment_link_sent_before_final_turn');
  });

  it('runs all selected cases and returns a suite tally', async () => {
    const sendTurn = vi.fn().mockResolvedValue({
      conversationId: 'conv-suite',
      responses: [{ type: 'text', text: 'Respuesta válida' }],
    });
    const report = await runConversationSuite(
      {
        schema_version: '1.0',
        prompt_version: 'v6',
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
});
