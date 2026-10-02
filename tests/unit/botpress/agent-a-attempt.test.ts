import { describe, expect, it, vi } from 'vitest';

import {
  classifyAgentAAttemptFailure,
  runAgentADeepSeekAttemptV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-attempt';

describe('Agent A DeepSeek attempt boundary', () => {
  it.each([
    ['BRAIN_DEEPSEEK_TIMEOUT', true, 'provider_transport'],
    ['BRAIN_DEEPSEEK_NETWORK_ERROR', true, 'provider_transport'],
    ['BRAIN_DEEPSEEK_HTTP_503', true, 'provider_transport'],
    ['BRAIN_DEEPSEEK_HTTP_429', false, 'provider_rejected'],
    ['BRAIN_INVALID_SCHEMA', false, 'schema'],
    [
      'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:request_call_now',
      false,
      'policy',
    ],
  ] as const)('classifies %s', (code, retryable, stage) => {
    expect(classifyAgentAAttemptFailure(Object.assign(new Error(code), { code })))
      .toMatchObject({ code, retryable, stage });
  });

  it('retries one transient timeout and returns the second result', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), {
        code: 'BRAIN_DEEPSEEK_TIMEOUT',
      }))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    await expect(runAgentADeepSeekAttemptV1({ generate, onRetry })).resolves.toEqual({
      value: 'ok',
      attempts: 2,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      code: 'BRAIN_DEEPSEEK_TIMEOUT',
      retryable: true,
    }));
  });

  it('does not retry a provider rejection or policy rejection', async () => {
    for (const code of [
      'BRAIN_DEEPSEEK_HTTP_400',
      'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:send_payment_link',
    ]) {
      const error = Object.assign(new Error(code), { code });
      const generate = vi.fn().mockRejectedValue(error);

      await expect(runAgentADeepSeekAttemptV1({ generate, onRetry: vi.fn() }))
        .rejects.toBe(error);
      expect(generate).toHaveBeenCalledTimes(1);
    }
  });

  it('throws the second transport error after exactly two attempts', async () => {
    const first = Object.assign(new Error('first timeout'), {
      code: 'BRAIN_DEEPSEEK_TIMEOUT',
    });
    const second = Object.assign(new Error('second timeout'), {
      code: 'BRAIN_DEEPSEEK_TIMEOUT',
    });
    const generate = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);

    await expect(runAgentADeepSeekAttemptV1({ generate, onRetry: vi.fn() }))
      .rejects.toBe(second);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
