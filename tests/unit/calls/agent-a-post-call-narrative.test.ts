import { describe, expect, it, vi } from 'vitest';
import { createAgentAPostCallComposer } from '@/features/calls/adapters/agent-a-post-call-narrative';
import type { ComposePostCallFollowupInput } from '@/features/calls/ports/post-call-followup-composer';
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '@/shared/prompts/studyx-agent-a-canonical.generated';

const input: ComposePostCallFollowupInput = {
  brief: { schema_version: 1, scenario: 'temporarily_unavailable', objective: 'recover_call_or_continue_chat', payment_state: 'not_applicable', allowed_next_steps: ['retry_call_later', 'continue_chat'] },
  call: { call_id: 'call-test', status: 'failed', result: null, analysis_status: 'pending', disconnection_reason: null },
  context: {
    academy_name: 'Canonical StudyX',
    customer: { contact_intake: { nombre: 'Lucas', apellido: 'Pérez', correo: 'lucas@example.test', telefono: '+5491123456789' } },
    selected_course: { code: 'python', name: 'Python' }, selected_payment_plan: null,
    history: [{ direction: 'inbound', text: 'Llámame para hablar de Python' }],
    call_context: { course_interest: 'Python', conversation_summary: 'Quiere aprender a programar.' },
    analysis: null, failure_code: 'XENDRA_CREATE_REJECTED_400',
  },
};
const environment = { DEEPSEEK_API_KEY: 'test-key', AGENT_A_ADVISOR_NAME: 'María', AGENT_A_ACADEMY_NAME: 'Stale environment academy' };
const prose = 'Lucas, la llamada no llegó a iniciarse. Podemos seguir con Python por aquí.';
function modelResponse(text = prose) { return Response.json({ output_text: JSON.stringify({ schema_version: 1, text }) }); }

describe('Agent A post-call narrative', () => {
  it('uses the exact canonical voice and configured identity with actual facts, preserves model prose', async () => {
    let body: Record<string, unknown> | undefined;
    const compose = createAgentAPostCallComposer({ environment, fetch: async (url, options) => {
      expect(url).toBe('https://api.deepseek.com/responses');
      body = JSON.parse(String(options?.body));
      return modelResponse();
    } });
    expect(await compose(input)).toBe(prose);
    expect(body?.model).toBe('deepseek-v4-flash');
    expect(body?.instructions).not.toMatch(/\{\{[^}]+\}\}/u);
    expect(body?.instructions).toContain(STUDYX_AGENT_A_CANONICAL_PROMPT.replaceAll('{{NOMBRE_ASESOR}}', 'María').replaceAll('{{NOMBRE_ACADEMIA}}', 'Canonical StudyX'));
    const prompt = String(body?.input);
    expect(prompt).toContain('XENDRA_CREATE_REJECTED_400');
    expect(prompt).toContain('Lucas');
    expect(prompt).toContain('python');
    expect(prompt).toContain('Llámame para hablar de Python');
    expect(prompt).not.toContain('No pudimos completar la llamada');
  });

  it('records successful A authorship with provider/model/prompt attribution and no customer text or secrets', async () => {
    const events: Record<string, unknown>[] = [];
    const compose = createAgentAPostCallComposer({
      environment,
      fetch: async () => modelResponse(),
      log: (fields) => { events.push(fields); },
    });
    expect(await compose(input)).toBe(prose);
    expect(events).toEqual([{
      event: 'calls.agent_a_post_call_narrative.composed',
      call_id: 'call-test', provider: 'deepseek-direct', model: 'deepseek-v4-flash',
      canonical_prompt_version: 'studyx-agent-a-canonical-v101', attempt: 1,
    }]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Lucas');
    expect(serialized).not.toContain('test-key');
    expect(serialized).not.toContain('lucas@example.test');
    expect(serialized).not.toContain(prose);
  });

  it('fails before model contact when configured identity leaves a canonical placeholder unresolved', async () => {
    let contacted = false;
    const compose = createAgentAPostCallComposer({
      environment: { ...environment, AGENT_A_ADVISOR_NAME: '{{NOMBRE_ASESOR}}' },
      fetch: async () => { contacted = true; return modelResponse(); },
    });
    await expect(compose(input)).rejects.toThrow('AGENT_A_FOLLOWUP_CONFIG_UNAVAILABLE');
    expect(contacted).toBe(false);
  });

  it('fails closed when canonical workspace identity is missing even if the environment has an academy name', async () => {
    let contacted = false;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { contacted = true; return modelResponse(); } });
    await expect(compose({ ...input, context: { ...input.context, academy_name: '' } })).rejects.toThrow('AGENT_A_FOLLOWUP_CONFIG_UNAVAILABLE');
    expect(contacted).toBe(false);
  });

  it.each(['DEEPSEEK_API_KEY', 'AGENT_A_ADVISOR_NAME'])('fails closed without %s before provider contact', async (key) => {
    const env: Record<string, string | undefined> = { ...environment, [key]: undefined };
    let contacted = false;
    const compose = createAgentAPostCallComposer({ environment: env, fetch: async () => { contacted = true; return modelResponse(); } });
    await expect(compose(input)).rejects.toThrow('AGENT_A_FOLLOWUP_CONFIG_UNAVAILABLE');
    expect(contacted).toBe(false);
  });

  it.each([429, 400])('does not retry HTTP %s', async (status) => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; return Response.json({}, { status }); } });
    await expect(compose(input)).rejects.toThrow(`AGENT_A_FOLLOWUP_HTTP_${status}`);
    expect(attempts).toBe(1);
  });

  it('retries an actual HTTP 503 once within the same DeepSeek provider', async () => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; return attempts === 1 ? Response.json({}, { status: 503 }) : modelResponse(); } });
    expect(await compose(input)).toBe(prose);
    expect(attempts).toBe(2);
  });

  it('retries a transport failure once and remains pending after the bounded second failure', async () => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; throw new TypeError('fetch failed with private detail'); } });
    await expect(compose(input)).rejects.toThrow('AGENT_A_FOLLOWUP_TRANSPORT_UNAVAILABLE');
    expect(attempts).toBe(2);
  });

  it('bounds timeout retries to two attempts and never emits fallback text', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const compose = createAgentAPostCallComposer({ environment, fetch: async (_url, options) => {
        attempts += 1;
        return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      } });
      const result = expect(compose(input)).rejects.toThrow('AGENT_A_FOLLOWUP_TRANSPORT_UNAVAILABLE');
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(attempts).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not retry an unexpected programming error at the transport boundary', async () => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; throw new Error('Unexpected internal adapter error'); } });
    await expect(compose(input)).rejects.toThrow('AGENT_A_FOLLOWUP_TRANSPORT_UNAVAILABLE');
    expect(attempts).toBe(1);
  });

  it('does not describe a voicemail outcome as a successful conversation', async () => {
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => modelResponse('Ya conversamos sobre Python y resolvimos tus dudas.') });
    await expect(compose({ ...input, call: { ...input.call, status: 'completed', result: 'buzon_de_voz', analysis_status: 'completed' } }))
      .rejects.toThrow('AGENT_A_FOLLOWUP_UNSUPPORTED_CALL_CLAIM');
  });

  it.each([
    'El pago quedó confirmado, si querés seguimos por aquí.',
    'Ya conversamos sobre Python, si querés seguimos por aquí.',
    'Tu inscripción está confirmada, cuando quieras seguimos por aquí.',
    'No pudimos llamarte y el pago quedó confirmado.',
    'El pago todavía está confirmado.',
  ])('rejects the unsupported claim even when a different clause is conditional or negated: %s', async (text) => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; return modelResponse(text); } });
    await expect(compose(input)).rejects.toThrow(/AGENT_A_FOLLOWUP_UNSUPPORTED_/u);
    expect(attempts).toBe(1);
  });

  it.each([
    'El pago no quedó confirmado, cuando quieras seguimos por aquí.',
    'Aún no conversamos sobre Python; podemos seguir por aquí.',
    'Tu inscripción todavía no está confirmada.',
    'Si el pago queda confirmado, continuamos con tu inscripción.',
    'Cuando el pago quede verificado, te aviso.',
    'Si lo prefieres, hablamos de Python por aquí.',
  ])('preserves a genuinely negated or conditional statement without rewriting it: %s', async (text) => {
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => modelResponse(text) });
    expect(await compose(input)).toBe(text);
  });

  it('preserves a known selected-course availability fact and rejects an unknown course or extra commercial claim', async () => {
    const text = 'El curso de Python está disponible. Podemos seguir por aquí.';
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => modelResponse(text) });
    expect(await compose(input)).toBe(text);
    await expect(compose({ ...input, context: { ...input.context, selected_course: null } })).rejects.toThrow('AGENT_A_FOLLOWUP_UNSUPPORTED_NARRATIVE');
    const unknown = createAgentAPostCallComposer({ environment, fetch: async () => modelResponse('El curso de Yoga está disponible. Podemos seguir por aquí.') });
    await expect(unknown(input)).rejects.toThrow('AGENT_A_FOLLOWUP_UNSUPPORTED_NARRATIVE');
    const invented = createAgentAPostCallComposer({ environment, fetch: async () => modelResponse('El curso de Python está disponible por USD 5.') });
    await expect(invented(input)).rejects.toThrow('AGENT_A_FOLLOWUP_UNSUPPORTED_NARRATIVE');
  });

  it.each([
    { output_text: 'invalid-json' },
    { output_text: JSON.stringify({ schema_version: 1, text: '' }) },
    { output_text: JSON.stringify({ schema_version: 1, text: 'El pago quedó verificado y tu inscripción está confirmada.' }) },
    { output_text: JSON.stringify({ schema_version: 1, text: 'Ya te llamamos y conversamos sobre Python.' }) },
    { output_text: JSON.stringify({ schema_version: 1, text: 'Sígueme en https://example.test' }) },
    { output_text: JSON.stringify({ schema_version: 1, text: 'El precio es USD 5.' }) },
  ])('rejects an invalid or unauthorized narrative without semantic retry or fallback: %j', async (payload) => {
    let attempts = 0;
    const compose = createAgentAPostCallComposer({ environment, fetch: async () => { attempts += 1; return Response.json(payload); } });
    await expect(compose(input)).rejects.toThrow(/AGENT_A_FOLLOWUP_(INVALID|UNSUPPORTED)/u);
    expect(attempts).toBe(1);
  });
});
