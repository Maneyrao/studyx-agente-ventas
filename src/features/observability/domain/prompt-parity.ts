const SHA256 = /^[a-f0-9]{64}$/u;

export interface PromptParityV1 {
  readonly required: boolean;
  readonly status: 'legacy' | 'match' | 'mismatch' | 'unavailable';
  readonly expected_template_sha256: string | null;
  readonly last_observed_template_sha256: string | null;
  readonly last_observed_prompt_sha256: string | null;
  readonly matches: boolean | null;
  readonly detail: string | null;
}

function digest(value: string | null): string | null {
  return value !== null && SHA256.test(value) ? value : null;
}

export function evaluatePromptParityV1(input: {
  readonly agent_loop_active: boolean;
  readonly expected_template_sha256: string | null;
  readonly observed_template_sha256: string | null;
  readonly observed_prompt_sha256: string | null;
  readonly query_failed?: boolean;
}): PromptParityV1 {
  const expected = digest(input.expected_template_sha256);
  const observedTemplate = digest(input.observed_template_sha256);
  const observedPrompt = digest(input.observed_prompt_sha256);
  if (!input.agent_loop_active) {
    return {
      required: false,
      status: 'legacy',
      expected_template_sha256: expected,
      last_observed_template_sha256: observedTemplate,
      last_observed_prompt_sha256: observedPrompt,
      matches: null,
      detail: null,
    };
  }
  if (input.query_failed || !expected || !observedTemplate || !observedPrompt) {
    return {
      required: true,
      status: 'unavailable',
      expected_template_sha256: expected,
      last_observed_template_sha256: observedTemplate,
      last_observed_prompt_sha256: observedPrompt,
      matches: null,
      detail: input.query_failed
        ? 'prompt_parity_query_failed'
        : !expected
          ? 'expected_template_not_configured'
          : 'observed_turn_manifest_incomplete',
    };
  }
  const matches = expected === observedTemplate;
  return {
    required: true,
    status: matches ? 'match' : 'mismatch',
    expected_template_sha256: expected,
    last_observed_template_sha256: observedTemplate,
    last_observed_prompt_sha256: observedPrompt,
    matches,
    detail: matches ? null : 'deployed_template_differs_from_observed_turn',
  };
}
