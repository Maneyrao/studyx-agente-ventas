import { describe, expect, it } from 'vitest';
import { evaluatePromptParityV1 } from '@/features/observability/domain/prompt-parity';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);

describe('Agent Loop prompt parity', () => {
  it('is informational while the new loop is off', () => {
    expect(evaluatePromptParityV1({
      agent_loop_active: false,
      expected_template_sha256: null,
      observed_template_sha256: null,
      observed_prompt_sha256: null,
    })).toMatchObject({ required: false, status: 'legacy', matches: null });
  });

  it('matches a deployed template while retaining the exact latest turn hash', () => {
    expect(evaluatePromptParityV1({
      agent_loop_active: true,
      expected_template_sha256: a,
      observed_template_sha256: a,
      observed_prompt_sha256: b,
    })).toEqual({
      required: true,
      status: 'match',
      expected_template_sha256: a,
      last_observed_template_sha256: a,
      last_observed_prompt_sha256: b,
      matches: true,
      detail: null,
    });
  });

  it.each([
    [{ expected_template_sha256: b }, 'mismatch'],
    [{ expected_template_sha256: null }, 'unavailable'],
    [{ observed_template_sha256: null }, 'unavailable'],
    [{ observed_prompt_sha256: null }, 'unavailable'],
    [{ query_failed: true }, 'unavailable'],
  ])('fails visibly in active mode for %j', (override, status) => {
    expect(evaluatePromptParityV1({
      agent_loop_active: true,
      expected_template_sha256: a,
      observed_template_sha256: a,
      observed_prompt_sha256: b,
      ...override,
    })).toMatchObject({ required: true, status });
  });
});
