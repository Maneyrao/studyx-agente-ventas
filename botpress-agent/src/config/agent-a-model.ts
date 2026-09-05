/**
 * Versioned model identity for Agent A. Changing it is a release change and
 * requires repeating the provider smoke that validated this exact model.
 */
export const AGENT_A_DEEPSEEK_MODEL = 'deepseek-v4-flash' as const;

/** Rejects a remote/runtime override before any provider request is made. */
export function resolveAgentADeepSeekModelV1(value?: string): typeof AGENT_A_DEEPSEEK_MODEL {
  const configured = value?.trim();
  if (configured && configured !== AGENT_A_DEEPSEEK_MODEL) {
    throw new Error('AGENT_A_DEEPSEEK_MODEL_MISMATCH');
  }
  return AGENT_A_DEEPSEEK_MODEL;
}
