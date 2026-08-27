import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMoveV1Schema } from '../../../botpress-agent/src/schemas/conversation-pipeline';
import {
  DEFAULT_CONVERSATION_INTERPRETER_MODEL,
  CONVERSATION_INTERPRETER_TIMEOUT_MS,
  ConversationInterpreterError,
  generateGroqConversationMoveV1,
  interpretConversationMoveV1,
} from '../../../botpress-agent/src/lib/conversation/conversation-interpreter';
import {
  CONVERSATION_INTERPRETER_PROMPT_VERSION,
  buildConversationInterpreterInstructionsV1,
} from '../../../botpress-agent/src/prompts/conversation-interpreter-v1';

type Heldout = {
  id: string;
  message: string;
  awaiting_reply: 'none' | 'area_choice' | 'course_choice' | 'call_or_chat' | 'payment_plan' | 'payment_confirmation';
  call_offer_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
  expected_move: string;
  expected_secondary_moves?: string[];
  expected_vetoes?: string[];
  expected_payment_plan?: string;
};

const heldout = JSON.parse(readFileSync(
  'botpress-agent/evals/conversation-pipeline-v1-heldout.json', 'utf8',
)) as Heldout[];

const baseInput = {
  batch_messages: [{ id: 'message-1', text: 'Necesito orientación' }],
  last_agent_question: '¿Preferís una llamada o continuar por chat?',
  sales_context: {
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_6' as const,
    stage: 'course_selected' as const,
    call_preference: 'unknown' as const,
    call_offer_status: 'offered' as const,
    awaiting_reply: 'call_or_chat' as const,
  },
  catalog: {
    areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
    offerings: [{
      code: 'redes-informaticas', display_name: 'Redes Informáticas',
      area_code: 'tecnologia', aliases: ['Infraestructura de redes'],
    }],
    payment_plans: [
      { code: 'monthly_12' as const, position: 1 },
      { code: 'monthly_6' as const, position: 2 },
      { code: 'one_time' as const, position: 3 },
    ],
  },
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('conversation interpreter V1', () => {
  it('keeps all held-out utterances outside the prompt source', () => {
    expect(heldout).toHaveLength(12);
    const source = readFileSync('botpress-agent/src/prompts/conversation-interpreter-v1.ts', 'utf8');
    for (const testCase of heldout) expect(source).not.toContain(testCase.message);
  });

  it('builds bounded instructions from complete batch and structured context', () => {
    const instructions = buildConversationInterpreterInstructionsV1(baseInput);
    expect(CONVERSATION_INTERPRETER_PROMPT_VERSION).toBe('studyx-conversation-interpreter-v1.3');
    expect(instructions).toContain('Necesito orientación');
    expect(instructions).toContain('call_or_chat');
    expect(instructions).toContain('redes-informaticas');
    expect(instructions).not.toContain('https://');
    expect(instructions.length).toBeLessThan(12_000);
  });

  it('validates injected model output before returning semantic meaning', async () => {
    const move = await interpretConversationMoveV1(baseInput, {
      generate: async () => ({
        schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'], confidence: 0.94,
      }),
    });
    expect(move).toEqual(ConversationMoveV1Schema.parse(move));

    await expect(interpretConversationMoveV1(baseInput, {
      generate: async () => ({ move: 'send_any_link' }),
    })).rejects.toMatchObject({ code: 'INTERPRETER_SCHEMA_INVALID' });
  });

  it('derives vetoes from structured decline and deferral moves without phrase matching', async () => {
    const declined = await interpretConversationMoveV1(baseInput, {
      generate: async () => ({
        schema_version: 1, move: 'decline_call', secondary_moves: [], vetoes: [], confidence: 0.94,
      }),
    });
    expect(declined.vetoes).toEqual(['call']);

    const deferred = await interpretConversationMoveV1({
      ...baseInput,
      sales_context: { ...baseInput.sales_context, awaiting_reply: 'payment_confirmation' as const },
    }, {
      generate: async () => ({
        schema_version: 1, move: 'defer_payment', secondary_moves: [], vetoes: [], confidence: 0.94,
      }),
    });
    expect(deferred.vetoes).toEqual(['payment_link']);
  });

  it('preserves a primary call decline when written continuation is also compatible', async () => {
    const move = await interpretConversationMoveV1(baseInput, {
      generate: async () => ({
        schema_version: 1,
        move: 'decline_call',
        secondary_moves: ['continue_by_chat'],
        vetoes: [],
        confidence: 0.94,
      }),
    });
    expect(move).toMatchObject({
      move: 'decline_call', secondary_moves: ['continue_by_chat'], vetoes: ['call'],
    });
  });

  it('uses one Groq strict-schema request with the fast model and no retries', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(200, {
      choices: [{ message: { content: JSON.stringify({
        schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [], confidence: 0.92,
      }) } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGroqConversationMoveV1({
      instructions: 'contract', context: baseInput,
      apiKey: 'test-key', signal: new AbortController().signal,
    });

    expect(result.move.move).toBe('continue_by_chat');
    expect(result.move.vetoes).toContain('call');
    expect(result.model).toBe(DEFAULT_CONVERSATION_INTERPRETER_MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.response_format).toMatchObject({
      type: 'json_schema', json_schema: { name: 'studyx_conversation_move_v1', strict: true },
    });
    expect(body.reasoning_effort).toBe('medium');
    expect(body.max_completion_tokens).toBe(1_024);
  });

  it('times out at the bounded interpreter budget without retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = generateGroqConversationMoveV1({
      instructions: 'contract', apiKey: 'test-key', signal: new AbortController().signal,
    });
    const assertion = expect(pending).rejects.toEqual(expect.objectContaining<Partial<ConversationInterpreterError>>({
      code: 'INTERPRETER_TIMEOUT',
    }));
    expect(CONVERSATION_INTERPRETER_TIMEOUT_MS).toBe(5_000);
    await vi.advanceTimersByTimeAsync(CONVERSATION_INTERPRETER_TIMEOUT_MS + 1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry provider or schema failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(503, { error: 'unavailable' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateGroqConversationMoveV1({
      instructions: 'contract', apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INTERPRETER_HTTP_503' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
