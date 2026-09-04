import { describe, expect, it } from 'vitest';
import { observeWorkflowFetchV1, workflowCommitSucceededV1, type WorkflowHttpExchangeV1 } from '../helpers/agent-a-workflow-http-evidence';

describe('evidencia de las fronteras HTTP del workflow', () => {
  it('una acción HTTP 200 con status rejected o el commit de otro turno no es commit exitoso', () => {
    const exchange: WorkflowHttpExchangeV1 = {
      boundary: 'backend', url: 'http://127.0.0.1:3217/api/agent/turns/turn-1/decision',
      requestBody: {}, responseBody: { status: 'rejected', turn_id: 'turn-1' },
      status: 200, error: null, elapsedMs: 5,
    };
    expect(workflowCommitSucceededV1(true, 'turn-1', [exchange])).toBe(false);
    expect(workflowCommitSucceededV1(true, 'turn-2', [{ ...exchange, responseBody: { status: 'committed', turn_id: 'turn-1' } }])).toBe(false);
    expect(workflowCommitSucceededV1(true, 'turn-1', [{ ...exchange, responseBody: { status: 'committed', turn_id: 'turn-1' } }])).toBe(true);
  });
  it('conserva el contexto, propuesta y usage de un HTTP 200 inválido y del reintento sin registrar headers secretos', async () => {
    const exchanges: WorkflowHttpExchangeV1[] = [];
    let calls = 0;
    const source: typeof fetch = async () => new Response(JSON.stringify({
      output: ++calls === 1 ? 'not-json' : '{"response":"hola"}',
      usage: { input_tokens: 100, output_tokens: 12 },
    }));
    const observed = observeWorkflowFetchV1(source, exchanges, 'http://127.0.0.1:3217');
    for (let i = 0; i < 2; i++) {
      const response = await observed('https://api.deepseek.com/responses', {
        method: 'POST', headers: { Authorization: 'Bearer DO_NOT_RECORD' },
        body: JSON.stringify({ model: 'deepseek-v4-flash', input: 'contexto sintético' }),
      });
      expect((await response.json()).usage.output_tokens).toBe(12);
    }
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]).toMatchObject({ boundary: 'deepseek', requestBody: { input: 'contexto sintético' }, responseBody: { output: 'not-json', usage: { input_tokens: 100 } }, status: 200 });
    expect(JSON.stringify(exchanges)).not.toContain('DO_NOT_RECORD');
  });

  it('retiene fallos HTTP, respuesta efectiva del commit y el error de transporte sin suprimirlo', async () => {
    const exchanges: WorkflowHttpExchangeV1[] = [];
    const source: typeof fetch = async (url) => {
      if (String(url).includes('deepseek')) throw new Error('network-unavailable');
      return new Response(JSON.stringify({ status: 'rejected', reason: 'NOT_AUTHORIZED' }), { status: 409 });
    };
    const observed = observeWorkflowFetchV1(source, exchanges, 'http://127.0.0.1:3217');
    expect((await observed('http://127.0.0.1:3217/api/botpress/decision')).status).toBe(409);
    await expect(observed('https://api.deepseek.com/responses')).rejects.toThrow('network-unavailable');
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]).toMatchObject({ boundary: 'backend', status: 409, responseBody: { status: 'rejected' } });
    expect(exchanges[1]).toMatchObject({ boundary: 'deepseek', status: null, error: 'network-unavailable' });
  });
});
